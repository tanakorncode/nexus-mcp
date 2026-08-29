const { app, Tray, Menu, BrowserWindow, ipcMain, dialog, nativeImage, Notification } = require("electron");
const path = require("path");
const store = require("./lib/store");
const { ReconnectingClient } = require("./lib/ws-client");
const { summarize } = require("./lib/summarize");
const { runJob } = require("./lib/runner");
const nexusLogin = require("./lib/nexus-login");
const nexusCatalog = require("./lib/nexus-catalog");
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
const recentJobs = []; // { id, prompt, lines: [], done: null, queued: false } — plain data only, sent over IPC as-is
// kill() handles live here, NOT on the job objects — functions can't cross
// IPC (Electron's structured clone throws "An object could not be cloned"
// the moment anything holding one gets sent, e.g. jobs:recent's response).
const jobKillHandles = new Map();

// Two Nexus events for the same repo can land close together — a status
// change firing twice, or two different tasks in one repo both getting
// assigned around the same time. Spawning claude concurrently against the
// same working directory means two processes reading/editing/committing in
// the same tree at once — real conflict risk, not hypothetical, since
// nothing here uses git worktrees the way a multi-agent orchestrator would
// to give each run its own tree. A simple per-workDir queue gets the same
// guarantee (never more than one job touching a given folder at a time) far
// cheaper than worktree management would be for a single-job-at-a-time app.
const workDirLocks = new Map(); // workDir -> job id currently running there
const workDirQueues = new Map(); // workDir -> array of job objects waiting their turn

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

// summarize.js prepends an unattended-run header before the actual
// "[Nexus] ..." line now (see lib/summarize.js) — plain split("\n")[0]
// would grab that header instead of anything recognizable as the task.
// Fall back to the raw first line for prompts that never had the header
// (e.g. the Settings window's own "Test" button prompt).
function taskLineOf(prompt) {
  return prompt.split("\n").find((l) => l.startsWith("[Nexus]")) ?? prompt.split("\n")[0];
}

// Shared by both a real Nexus event (handleEvent) and a manual re-run of a
// past job (jobs:retry IPC) — same job lifecycle either way. Creates the job
// immediately either way (so it always shows up in Activity right away) —
// whether it starts running now or waits behind another job in the same
// workDir is decided below.
function startJob(prompt, workDir) {
  const job = { id: `${Date.now()}`, prompt, workDir, lines: [], done: null, queued: false };
  recentJobs.unshift(job);
  if (recentJobs.length > 20) recentJobs.pop();

  if (workDir && workDirLocks.has(workDir)) {
    job.queued = true;
    const queue = workDirQueues.get(workDir) ?? [];
    queue.push(job);
    workDirQueues.set(workDir, queue);
    progressWindow?.webContents.send("job:new", job);
    updateTrayTitle();
    notify("Nexus Agent — เข้าคิว", `${taskLineOf(prompt)}\nกำลังรอ — มีงานอื่นทำอยู่ในโฟลเดอร์นี้แล้ว`);
    return job;
  }

  progressWindow?.webContents.send("job:new", job);
  updateTrayTitle();
  notify("Nexus Agent — เริ่มทำงานใหม่", taskLineOf(prompt));
  runNow(job);
  return job;
}

// Actually spawns a job that's clear to run now — called either straight
// from startJob (workDir was free) or from dequeueNext (workDir just freed
// up). Takes the lock for job.workDir for the duration of the run.
function runNow(job) {
  const settings = getSettings();
  const { workDir } = job;
  if (workDir) workDirLocks.set(workDir, job.id);

  const handle = runJob({
    command: settings.command,
    workDir,
    prompt: job.prompt,
    onLine: (line) => pushLine(job, line),
    onDone: (result) => {
      // Guards against acting twice if the underlying child process ever
      // fires both "error" and "close" for the same failure (runner.js
      // calls onDone from both) — without this, the workDir lock could get
      // released and the next queued job started twice over.
      if (job.done !== null) return;
      job.done = result;
      jobKillHandles.delete(job.id);
      if (workDir) workDirLocks.delete(workDir);
      progressWindow?.webContents.send("job:done", { id: job.id, result });
      updateTrayTitle();
      history.appendJob(app.getPath("userData"), job);
      const taskLine = taskLineOf(job.prompt);
      if (result.cancelled) {
        notify("Nexus Agent — ยกเลิกแล้ว", taskLine);
      } else if (result.blockedTools?.length) {
        // Distinct from a plain failure: the run *reported* success
        // (claude often exits 0 and talks around a denied tool call
        // instead of erroring) but never actually did the Nexus-side
        // work, because nobody was present to approve a tool call that
        // wasn't in --allowedTools. "ล้มเหลว" alone doesn't say why;
        // this is the whole point of parsing --output-format json's
        // permission_denials instead of trusting the exit code.
        notify("Nexus Agent — ถูกบล็อกสิทธิ์", `${taskLine}\nไม่ได้รับอนุญาตให้ใช้: ${result.blockedTools.join(", ")}`);
      } else {
        notify(result.ok ? "Nexus Agent — เสร็จแล้ว" : "Nexus Agent — ล้มเหลว", taskLine);
      }
      if (workDir) dequeueNext(workDir);
    },
  });
  jobKillHandles.set(job.id, handle.kill);
}

// Pops and starts the next job waiting on workDir, if any — called right
// after that folder's lock is released.
function dequeueNext(workDir) {
  const queue = workDirQueues.get(workDir);
  if (!queue || queue.length === 0) return;
  const next = queue.shift();
  if (queue.length === 0) workDirQueues.delete(workDir);
  next.queued = false;
  progressWindow?.webContents.send("job:started", { id: next.id });
  updateTrayTitle();
  notify("Nexus Agent — เริ่มทำงานแล้ว", taskLineOf(next.prompt));
  runNow(next);
}

// A queued job never got a jobKillHandles entry (nothing's spawned yet) —
// jobs:cancel below routes here instead of the kill() path so "cancel"
// still does something for a job that's just waiting in line.
function cancelQueuedJob(job) {
  const queue = workDirQueues.get(job.workDir);
  if (queue) {
    const idx = queue.indexOf(job);
    if (idx !== -1) queue.splice(idx, 1);
    if (queue.length === 0) workDirQueues.delete(job.workDir);
  }
  job.queued = false;
  job.done = { ok: false, cancelled: true };
  progressWindow?.webContents.send("job:done", { id: job.id, result: job.done });
  updateTrayTitle();
  history.appendJob(app.getPath("userData"), job);
  notify("Nexus Agent — ยกเลิกแล้ว (ยังไม่ทันเริ่ม)", taskLineOf(job.prompt));
}

function handleEvent(msg) {
  const prompt = summarize(msg.event, msg.payload);
  const settings = getSettings();
  if (!settings.enabled) {
    log.log(`event received but agent is paused, skipping: ${msg.event}`);
    return;
  }

  const task = msg.payload?.task;
  const workDir = store.resolveWorkDir(settings, task);
  if (!workDir) {
    const label = task?.repository?.name ?? task?.project?.name ?? "(none)";
    log.log(`event for repo/project "${label}" has no local folder mapped, skipping: ${msg.event}`);
    return;
  }

  const label = task?.repository?.name ?? task?.project?.name;
  log.log(`${msg.event} matched "${label}" -> running in ${workDir}`);
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
    log.log(`connecting anyway despite incomplete work config (${store.missingFields(settings).join(", ")}) — socket only needs server + login, events just won't have anywhere to route yet`);
  }
  log.log(`connecting to ${settings.serverUrl}`);
  client = new ReconnectingClient({
    url: settings.serverUrl,
    getToken: () => nexusLogin.getValidAccessToken(settings.pmSystemUrl),
    onEvent: handleEvent,
    onStatus: (status, detail) => {
      connectionStatus = status;
      if (status === "unauthorized" || status === "error") {
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
  if (job.queued) {
    cancelQueuedJob(job);
    return { ok: true };
  }
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
ipcMain.handle("auth:status", () => ({ user: nexusLogin.currentUser() }));
ipcMain.handle("auth:login", async () => {
  const settings = getSettings();
  const result = await nexusLogin.login(settings.pmSystemUrl);
  if (result.ok) reconnect(); // a login while disconnected/unauthorized should start using it immediately
  return result;
});
ipcMain.handle("auth:logout", () => {
  nexusLogin.logout();
  reconnect(); // drops the socket now that getValidAccessToken() will return needsLogin
  return { ok: true };
});
ipcMain.handle("catalog:listProjects", () => {
  const settings = getSettings();
  return nexusCatalog.listProjects(settings.pmSystemUrl);
});
ipcMain.handle("catalog:listRepositories", (_e, projectId) => {
  const settings = getSettings();
  return nexusCatalog.listRepositories(settings.pmSystemUrl, projectId);
});
ipcMain.handle("status:get", () => ({ status: currentStatus(), detail: connectionDetail, config: currentConfig() }));
ipcMain.handle("usage:summary", () => {
  const settings = getSettings();
  return history.summarizeUsage(app.getPath("userData"), settings.historyRetentionDays);
});
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
  // canConnect() only covers serverUrl now — being logged in is a separate,
  // keychain-backed check, but a fresh install (never logged in) needs the
  // same "open Settings so they can act" nudge, or it'd just sit silently
  // showing "unauthorized" in the tray with nothing pointing at why.
  if (!store.canConnect(settings) || !nexusLogin.currentUser()) {
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
