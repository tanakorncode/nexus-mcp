const { app, Tray, Menu, BrowserWindow, ipcMain, dialog, nativeImage, Notification } = require("electron");
const path = require("path");
const store = require("./lib/store");
const { ReconnectingClient } = require("./lib/ws-client");
const { summarize } = require("./lib/summarize");
const { runJob } = require("./lib/runner");
const { resolveIdentity } = require("./lib/nexus-identity");
const history = require("./lib/history");
const log = require("./lib/log");

// Running more than one instance means more than one WebSocket connects to
// notify-server with the same memberId (it allows multiple sockets per
// member on purpose, for multiple devices) — so a real event can land on
// whichever instance happens to receive it, but recentJobs isn't shared
// across instances, so a *different* instance's Activity window can show
// nothing even though the job is genuinely running elsewhere. Hit this for
// real (repeated npm start without Quit-ing the previous run first) —
// requestSingleInstanceLock() returns false on every launch after the
// first, so those just quit immediately instead of opening a second tray
// icon silently competing for the same connection.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let tray = null;
let settingsWindow = null;
let progressWindow = null;
let client = null;
let connectionStatus = "disconnected";
let connectionDetail = "";
const recentJobs = []; // { id, prompt, lines: [], done: null } — plain data only, sent over IPC as-is
// kill() handles live here, NOT on the job objects — functions can't cross
// IPC (Electron's structured clone throws "An object could not be cloned"
// the moment anything holding one gets sent, e.g. jobs:recent's response).
const jobKillHandles = new Map();

function getSettings() {
  return store.load(app.getPath("userData"));
}

function saveSettings(next) {
  store.save(app.getPath("userData"), next);
  // Re-applies retention immediately (e.g. lowering it from 7 to 1 day)
  // instead of waiting for the next app restart.
  history.loadHistory(app.getPath("userData"), next.historyRetentionDays);
  reconnect();
}

// The tray icon itself carries the status color — someone glancing at the
// menu bar shouldn't have to open Settings to tell connected from broken.
const STATUS_ICONS = {
  connected: "icon-status-connected.png",
  connecting: "icon-status-connecting.png",
  unauthorized: "icon-status-error.png",
  error: "icon-status-error.png",
};

function trayIcon(status) {
  const file = STATUS_ICONS[status] ?? "icon-status-idle.png";
  return nativeImage.createFromPath(path.join(__dirname, "assets", file));
}

// Deliberately separate from config completeness (see currentConfig()) —
// "haven't filled in the form yet" and "filled it in but can't reach the
// server" are different problems with different fixes, and showing them
// as the same gray dot made that impossible to tell apart.
function currentStatus() {
  const settings = getSettings();
  if (!store.canConnect(settings)) return "idle";
  if (!settings.enabled) return "paused";
  return connectionStatus;
}

function currentConfig() {
  const missing = store.missingFields(getSettings());
  return { complete: missing.length === 0, missing };
}

function updateTrayTitle() {
  if (!tray) return;
  const status = currentStatus();
  const badge = recentJobs.some((j) => j.done === null) ? " ●" : "";
  tray.setToolTip(`Nexus Agent — ${status}${badge}`);
  tray.setImage(trayIcon(status));
}

function broadcastStatus() {
  settingsWindow?.webContents.send("status:update", {
    status: currentStatus(),
    detail: connectionDetail,
    config: currentConfig(),
  });
}

function openSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 560,
    resizable: false,
    title: "Nexus Agent — Settings",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  settingsWindow.loadFile(path.join(__dirname, "windows", "settings.html"));
  settingsWindow.on("closed", () => { settingsWindow = null; });
}

function openProgressWindow() {
  if (progressWindow) {
    progressWindow.focus();
    return;
  }
  progressWindow = new BrowserWindow({
    width: 560,
    height: 420,
    title: "Nexus Agent — Activity",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  progressWindow.loadFile(path.join(__dirname, "windows", "progress.html"));
  progressWindow.on("closed", () => { progressWindow = null; });
}

function pushLine(job, line) {
  job.lines.push(line);
  progressWindow?.webContents.send("job:line", { id: job.id, line });
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const time = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const n = new Notification({ title, body: `[${time}] ${body}` });
  n.on("click", () => openProgressWindow());
  n.show();
}

// Shared by both a real Nexus event (handleEvent) and a manual re-run of a
// past job (jobs:retry IPC) — same job lifecycle either way.
function startJob(prompt, workDir) {
  const settings = getSettings();
  const job = { id: `${Date.now()}`, prompt, workDir, lines: [], done: null };
  recentJobs.unshift(job);
  if (recentJobs.length > 20) recentJobs.pop();
  progressWindow?.webContents.send("job:new", job);
  updateTrayTitle();

  const taskLine = prompt.split("\n")[0];
  notify("Nexus Agent — เริ่มทำงานใหม่", taskLine);

  const handle = runJob({
    command: settings.command,
    workDir,
    prompt,
    onLine: (line) => pushLine(job, line),
    onDone: (result) => {
      job.done = result;
      jobKillHandles.delete(job.id);
      progressWindow?.webContents.send("job:done", { id: job.id, result });
      updateTrayTitle();
      history.appendJob(app.getPath("userData"), job);
      const title = result.cancelled
        ? "Nexus Agent — ยกเลิกแล้ว"
        : result.ok
          ? "Nexus Agent — เสร็จแล้ว"
          : "Nexus Agent — ล้มเหลว";
      notify(title, taskLine);
    },
  });
  jobKillHandles.set(job.id, handle.kill);
  return job;
}

function handleEvent(msg) {
  const prompt = summarize(msg.event, msg.payload);
  const settings = getSettings();
  if (!settings.enabled) {
    log.log(`event received but agent is paused, skipping: ${msg.event}`);
    return;
  }

  const repoName = msg.payload?.task?.repository?.name ?? null;
  const workDir = store.resolveWorkDir(settings, repoName);
  if (!workDir) {
    log.log(`event for repo "${repoName ?? "(none)"}" has no local folder mapped, skipping: ${msg.event}`);
    return;
  }

  log.log(`${msg.event} matched repo "${repoName}" -> running in ${workDir}`);
  startJob(prompt, workDir);
}

function reconnect() {
  client?.stop();
  const settings = getSettings();
  if (!store.canConnect(settings)) {
    connectionStatus = "idle";
    connectionDetail = "";
    log.log(`not connecting — missing: ${store.missingFields(settings).join(", ")}`);
    updateTrayTitle();
    broadcastStatus();
    return;
  }
  if (!store.isConfigured(settings)) {
    log.log(`connecting anyway despite incomplete work config (${store.missingFields(settings).join(", ")}) — socket only needs server/memberId/secret, events just won't have anywhere to route yet`);
  }
  log.log(`connecting to ${settings.serverUrl} as memberId=${settings.memberId}`);
  client = new ReconnectingClient({
    url: settings.serverUrl,
    memberId: settings.memberId,
    secret: settings.secret,
    onEvent: handleEvent,
    onStatus: (status, detail) => {
      connectionStatus = status;
      if (status === "unauthorized") {
        connectionDetail = "Server rejected memberId/secret — check both match what notify-server expects";
      } else if (status === "error") {
        connectionDetail = detail ?? "unknown error";
      } else {
        connectionDetail = "";
      }
      log.log(`connection status: ${status}${connectionDetail ? ` — ${connectionDetail}` : ""}`);
      updateTrayTitle();
      broadcastStatus();
    },
  });
  client.start();
}

function buildTrayMenu() {
  const settings = getSettings();
  return Menu.buildFromTemplate([
    { label: "Settings…", click: openSettingsWindow },
    { label: "Activity…", click: openProgressWindow },
    { type: "separator" },
    {
      label: "Enabled",
      type: "checkbox",
      checked: settings.enabled,
      click: (item) => {
        saveSettings({ ...settings, enabled: item.checked });
        buildAndSetMenu();
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
}

function buildAndSetMenu() {
  tray?.setContextMenu(buildTrayMenu());
  updateTrayTitle();
}

// --- IPC for the settings/progress windows ---
ipcMain.handle("settings:get", () => getSettings());
ipcMain.handle("settings:presets", () => store.PRESETS);
ipcMain.handle("settings:save", (_e, next) => {
  saveSettings(next);
  buildAndSetMenu();
  return getSettings();
});
ipcMain.handle("settings:chooseFolder", async () => {
  const result = await dialog.showOpenDialog(settingsWindow, { properties: ["openDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("settings:test", (_e, { command, workDir }) => {
  return new Promise((resolve) => {
    const lines = [];
    runJob({
      command,
      workDir,
      prompt: "This is a test prompt from Nexus Agent's settings screen — no real task, just checking the command runs.",
      onLine: (line) => lines.push(line),
      onDone: (result) => resolve({ ...result, lines }),
    });
  });
});
ipcMain.handle("jobs:recent", () => recentJobs);
ipcMain.handle("jobs:cancel", (_e, id) => {
  const job = recentJobs.find((j) => j.id === id);
  if (!job || job.done !== null) return { ok: false };
  jobKillHandles.get(id)?.();
  return { ok: true };
});
ipcMain.handle("jobs:retry", (_e, id) => {
  const job = recentJobs.find((j) => j.id === id);
  // Only makes sense for a job that's actually finished, and only
  // possible if we know which folder it ran in — jobs persisted before
  // history.js started saving workDir won't have one.
  if (!job || job.done === null || !job.workDir) return { ok: false };
  const newJob = startJob(job.prompt, job.workDir);
  return { ok: true, id: newJob.id };
});
ipcMain.handle("identity:resolve", async () => {
  const settings = getSettings();
  return resolveIdentity(settings.pmSystemUrl);
});
ipcMain.handle("status:get", () => ({ status: currentStatus(), detail: connectionDetail, config: currentConfig() }));
ipcMain.handle("log:open", () => {
  require("electron").shell.showItemInFolder(log.path());
});

// Fires on the *first* (already-running) instance when a second launch
// attempt is blocked by requestSingleInstanceLock() above — surface that
// instead of the second launch just silently vanishing with no feedback.
app.on("second-instance", () => {
  log.log("blocked a second instance from launching — already running");
  openSettingsWindow();
});

app.whenReady().then(() => {
  log.init(app.getPath("userData"));
  if (process.platform === "darwin") app.dock?.hide();
  app.setLoginItemSettings({ openAtLogin: true });

  const settingsAtStartup = getSettings();
  const pastJobs = history.loadHistory(app.getPath("userData"), settingsAtStartup.historyRetentionDays);
  // Newest first, matching recentJobs' own ordering (unshift on new jobs).
  for (const entry of pastJobs.slice().reverse()) {
    recentJobs.push({ id: entry.id, prompt: entry.prompt, workDir: entry.workDir, lines: entry.lines, done: entry.done });
  }

  tray = new Tray(trayIcon("idle"));
  buildAndSetMenu();
  tray.on("click", () => tray.popUpContextMenu());

  const settings = getSettings();
  if (!store.canConnect(settings)) {
    openSettingsWindow();
  } else {
    // Connects even if repoMap/command aren't set yet — those only affect
    // what happens once an event arrives, not whether the socket can open.
    reconnect();
  }

  // Required lazily, after app.whenReady() — electron-updater's autoUpdater
  // getter needs the real electron.app singleton fully up, and importing
  // it at module-load time (before whenReady) crashes on some platforms.
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      log.error(`auto-update check failed: ${err.message}`);
    });
  } catch (err) {
    log.error(`auto-updater unavailable: ${err.message}`);
  }
});

// Tray app — deliberately no window-all-closed handler that calls
// app.quit(). Electron's default on macOS is already to keep running;
// on Windows/Linux, simply not quitting here is what keeps it alive too.
app.on("window-all-closed", () => {});
