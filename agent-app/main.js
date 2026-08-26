const { app, Tray, Menu, BrowserWindow, ipcMain, dialog, nativeImage } = require("electron");
const path = require("path");
const store = require("./lib/store");
const { ReconnectingClient } = require("./lib/ws-client");
const { summarize } = require("./lib/summarize");
const { runJob } = require("./lib/runner");
const { resolveIdentity } = require("./lib/nexus-identity");
const history = require("./lib/history");
const log = require("./lib/log");

let tray = null;
let settingsWindow = null;
let progressWindow = null;
let client = null;
let connectionStatus = "disconnected";
let connectionDetail = "";
const recentJobs = []; // { id, prompt, lines: [], done: null }

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

function trayIcon() {
  return nativeImage.createFromPath(path.join(__dirname, "assets", "icon-16.png"));
}

function currentStatus() {
  const settings = getSettings();
  if (!store.isConfigured(settings)) return "not configured";
  if (!settings.enabled) return "paused";
  return connectionStatus;
}

function updateTrayTitle() {
  if (!tray) return;
  const badge = recentJobs.some((j) => j.done === null) ? " ●" : "";
  tray.setToolTip(`Nexus Agent — ${currentStatus()}${badge}`);
}

function broadcastStatus() {
  settingsWindow?.webContents.send("status:update", { status: currentStatus(), detail: connectionDetail });
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
  const job = { id: `${Date.now()}`, prompt, lines: [], done: null };
  recentJobs.unshift(job);
  if (recentJobs.length > 20) recentJobs.pop();
  progressWindow?.webContents.send("job:new", job);
  updateTrayTitle();

  runJob({
    command: settings.command,
    workDir,
    prompt,
    onLine: (line) => pushLine(job, line),
    onDone: (result) => {
      job.done = result;
      progressWindow?.webContents.send("job:done", { id: job.id, result });
      updateTrayTitle();
      history.appendJob(app.getPath("userData"), job);
    },
  });
}

function reconnect() {
  client?.stop();
  const settings = getSettings();
  if (!store.isConfigured(settings)) {
    connectionStatus = "not configured";
    connectionDetail = "";
    log.log("not connecting — settings incomplete (need memberId, secret, serverUrl, and at least one repo mapped)");
    updateTrayTitle();
    broadcastStatus();
    return;
  }
  log.log(`connecting to ${settings.serverUrl} as memberId=${settings.memberId}`);
  client = new ReconnectingClient({
    url: settings.serverUrl,
    memberId: settings.memberId,
    secret: settings.secret,
    onEvent: handleEvent,
    onStatus: (status) => {
      connectionStatus = status;
      log.log(`connection status: ${status}`);
      if (status === "unauthorized") {
        connectionDetail = "Server rejected memberId/secret — check both match what notify-server expects";
        log.error(connectionDetail);
      } else {
        connectionDetail = "";
      }
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
ipcMain.handle("identity:resolve", async () => {
  const settings = getSettings();
  return resolveIdentity(settings.pmSystemUrl);
});
ipcMain.handle("status:get", () => ({ status: currentStatus(), detail: connectionDetail }));
ipcMain.handle("log:open", () => {
  require("electron").shell.showItemInFolder(log.path());
});

app.whenReady().then(() => {
  log.init(app.getPath("userData"));
  if (process.platform === "darwin") app.dock?.hide();
  app.setLoginItemSettings({ openAtLogin: true });

  const settingsAtStartup = getSettings();
  const pastJobs = history.loadHistory(app.getPath("userData"), settingsAtStartup.historyRetentionDays);
  // Newest first, matching recentJobs' own ordering (unshift on new jobs).
  for (const entry of pastJobs.slice().reverse()) {
    recentJobs.push({ id: entry.id, prompt: entry.prompt, lines: entry.lines, done: entry.done });
  }

  tray = new Tray(trayIcon());
  buildAndSetMenu();
  tray.on("click", () => tray.popUpContextMenu());

  const settings = getSettings();
  if (!store.isConfigured(settings)) {
    openSettingsWindow();
  } else {
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
