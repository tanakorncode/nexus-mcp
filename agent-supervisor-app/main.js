const { app, Tray, Menu, BrowserWindow, ipcMain, dialog, nativeImage, Notification } = require("electron");
const path = require("path");
const store = require("./lib/store");
const taskPoller = require("./lib/task-poller");
const { summarizeClaimedTask } = require("./lib/summarize");
const { runJob } = require("./lib/runner");
const nexusLogin = require("./lib/nexus-login");
const nexusCatalog = require("./lib/nexus-catalog");
const history = require("./lib/history");
const log = require("./lib/log");

// Same reasoning as agent-app: more than one instance sharing one keychain
// identity means recentJobs isn't shared across them, so a second instance's
// Activity window could show nothing even though claims/runs are genuinely
// happening elsewhere. Worse here than in agent-app, too — two instances
// polling the same project would also race each other to claim the same
// tasks, on top of the display problem.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let tray = null;
let settingsWindow = null;
let progressWindow = null;
const recentJobs = []; // { id, prompt, workDir, lines: [], done: null, queued: false, retryCount } — plain data only, sent over IPC as-is
const jobKillHandles = new Map(); // job.id -> kill() — functions can't cross IPC, kept out of the job objects

// Ported verbatim from agent-app/main.js — see its own comment for why: a
// per-workDir lock/queue is the cheap alternative to real worktree
// isolation for an app that only ever runs one job at a time per folder.
// Generalizes here with zero changes: many claimed tasks across many repos
// running at once is exactly "several different workDirs, each serialized
// against itself" — the same guarantee agent-app needed for two events
// landing close together.
const workDirLocks = new Map();
const workDirQueues = new Map();

const MAX_AUTO_RETRIES = 2;
const RETRY_DELAY_MS = 90_000;

let pollTimer = null;
let pollInFlight = false;
let pollStatus = "connecting"; // idle | connecting | connected | error | unauthorized | paused
let pollDetail = "";

function getSettings() {
  return store.load(app.getPath("userData"));
}

function saveSettings(next) {
  store.save(app.getPath("userData"), next);
  history.loadHistory(app.getPath("userData"), next.historyRetentionDays);
  log.prune(next.historyRetentionDays);
  startPolling();
}

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

function currentStatus() {
  const settings = getSettings();
  if (!store.canConnect(settings)) return "idle";
  if (!settings.enabled) return "paused";
  return pollStatus;
}

function currentConfig() {
  const missing = store.missingFields(getSettings());
  return { complete: missing.length === 0, missing };
}

function activeJobCount() {
  return recentJobs.filter((j) => j.done === null).length;
}

function updateTrayTitle() {
  if (!tray) return;
  const status = currentStatus();
  const badge = activeJobCount() > 0 ? ` ● ${activeJobCount()}` : "";
  tray.setToolTip(`Nexus Supervisor — ${status}${badge}`);
  tray.setImage(trayIcon(status));
}

function broadcastStatus() {
  settingsWindow?.webContents.send("status:update", {
    status: currentStatus(),
    detail: pollDetail,
    config: currentConfig(),
  });
}

function openSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 520,
    height: 600,
    resizable: false,
    title: "Nexus Supervisor — Settings",
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
    width: 620,
    height: 460,
    title: "Nexus Supervisor — Activity",
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

function taskLineOf(prompt) {
  return prompt.split("\n").find((l) => l.startsWith("[Nexus]")) ?? prompt.split("\n")[0];
}

// --- Job queue: ported from agent-app/main.js (startJob/runNow/dequeueNext/
// cancelQueuedJob), unchanged in substance — see that file's comments for
// the full reasoning on the lock/queue/retry design. Only difference here:
// callers are the poll loop and jobs:retry, never a push-event handler. ---

function startJob(prompt, workDir, retryCount = 0) {
  const job = { id: `${Date.now()}`, prompt, workDir, lines: [], done: null, queued: false, retryCount };
  recentJobs.unshift(job);
  if (recentJobs.length > 20) recentJobs.pop();

  const retrySuffix = retryCount > 0 ? `\n(ครั้งที่ ${retryCount}/${MAX_AUTO_RETRIES})` : "";

  if (workDir && workDirLocks.has(workDir)) {
    job.queued = true;
    const queue = workDirQueues.get(workDir) ?? [];
    queue.push(job);
    workDirQueues.set(workDir, queue);
    progressWindow?.webContents.send("job:new", job);
    updateTrayTitle();
    notify("Nexus Supervisor — เข้าคิว", `${taskLineOf(prompt)}\nกำลังรอ — มีงานอื่นทำอยู่ในโฟลเดอร์นี้แล้ว${retrySuffix}`);
    return job;
  }

  progressWindow?.webContents.send("job:new", job);
  updateTrayTitle();
  notify(retryCount > 0 ? "Nexus Supervisor — ลองใหม่อัตโนมัติ" : "Nexus Supervisor — เริ่มทำงานใหม่", `${taskLineOf(prompt)}${retrySuffix}`);
  runNow(job);
  return job;
}

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
      if (job.done !== null) return;
      jobKillHandles.delete(job.id);
      if (workDir) workDirLocks.delete(workDir);

      const settingsNow = getSettings();
      const retryEligible =
        settingsNow.autoRetryEnabled !== false && !result.ok && !result.cancelled && !result.blockedTools?.length;
      if (retryEligible && workDir && (job.retryCount ?? 0) < MAX_AUTO_RETRIES) {
        const nextAttempt = (job.retryCount ?? 0) + 1;
        result.retryAt = Date.now() + RETRY_DELAY_MS;
        setTimeout(() => {
          const settingsAtFire = getSettings();
          if (!settingsAtFire.enabled || settingsAtFire.autoRetryEnabled === false) return;
          startJob(job.prompt, workDir, nextAttempt);
        }, RETRY_DELAY_MS);
      }

      job.done = result;
      progressWindow?.webContents.send("job:done", { id: job.id, result });
      updateTrayTitle();
      history.appendJob(app.getPath("userData"), job);
      const taskLine = taskLineOf(job.prompt);
      if (result.cancelled) {
        notify("Nexus Supervisor — ยกเลิกแล้ว", taskLine);
      } else if (result.blockedTools?.length) {
        notify("Nexus Supervisor — ถูกบล็อกสิทธิ์", `${taskLine}\nไม่ได้รับอนุญาตให้ใช้: ${result.blockedTools.join(", ")}`);
      } else {
        notify(result.ok ? "Nexus Supervisor — เสร็จแล้ว" : "Nexus Supervisor — ล้มเหลว", taskLine);
      }
      if (workDir) dequeueNext(workDir);
    },
  });
  jobKillHandles.set(job.id, handle.kill);
}

function dequeueNext(workDir) {
  const queue = workDirQueues.get(workDir);
  if (!queue || queue.length === 0) return;
  const next = queue.shift();
  if (queue.length === 0) workDirQueues.delete(workDir);
  next.queued = false;
  progressWindow?.webContents.send("job:started", { id: next.id });
  updateTrayTitle();
  notify("Nexus Supervisor — เริ่มทำงานแล้ว", taskLineOf(next.prompt));
  runNow(next);
}

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
  notify("Nexus Supervisor — ยกเลิกแล้ว (ยังไม่ทันเริ่ม)", taskLineOf(job.prompt));
}

// --- Poll + claim loop: the genuinely new part. ---

async function pollOnce() {
  if (pollInFlight) return; // never overlap two poll cycles
  pollInFlight = true;
  const settings = getSettings();

  try {
    if (!settings.enabled) {
      pollStatus = "paused";
      return;
    }
    const auth = await nexusLogin.getValidAccessToken(settings.pmSystemUrl);
    if (auth.needsLogin) {
      pollStatus = "unauthorized";
      pollDetail = "ยังไม่ได้เข้าสู่ระบบ";
      return;
    }
    const self = nexusLogin.currentUser();
    if (!self) {
      pollStatus = "unauthorized";
      pollDetail = "ยังไม่ได้เข้าสู่ระบบ";
      return;
    }

    const ready = await taskPoller.listReadyTasks(settings, {
      onSkip: (msg) => log.log(`poll: ${msg}`),
    });
    pollStatus = "connected";
    pollDetail = "";

    for (let i = 0; i < ready.length; i++) {
      if (activeJobCount() >= settings.maxConcurrentJobs) {
        log.log(`poll: at maxConcurrentJobs (${settings.maxConcurrentJobs}) — leaving ${ready.length - i} candidate(s) for next cycle`);
        break;
      }

      const { task, workDir } = ready[i];
      const claim = await taskPoller.claimTask(settings, task.id, self.id);
      if (!claim.ok) {
        if (claim.reason === "lost_race") {
          log.log(`poll: lost claim race for ${task.taskKey ?? task.id} — someone else got there first`);
        } else {
          log.log(`poll: claim failed for ${task.taskKey ?? task.id}: ${claim.reason}${claim.detail ? ` (${claim.detail})` : ""}`);
        }
        continue;
      }

      log.log(`poll: claimed ${task.taskKey ?? task.id} -> running in ${workDir}`);
      startJob(summarizeClaimedTask(claim.task), workDir);
    }
  } catch (err) {
    pollStatus = "error";
    pollDetail = err.message;
    log.error(`poll cycle failed: ${err.message}`);
  } finally {
    pollInFlight = false;
    updateTrayTitle();
    broadcastStatus();
  }
}

function startPolling() {
  stopPolling();
  const settings = getSettings();
  if (!store.canConnect(settings)) {
    pollStatus = "idle";
    pollDetail = "";
    log.log(`not polling — missing: ${store.missingFields(settings).join(", ")}`);
    updateTrayTitle();
    broadcastStatus();
    return;
  }
  if (!store.isConfigured(settings)) {
    log.log(`polling anyway despite incomplete work config (${store.missingFields(settings).join(", ")}) — needs at least one supervised project+status to actually claim anything`);
  }
  log.log(`polling ${settings.pmSystemUrl} every ${settings.pollIntervalMs}ms`);
  pollOnce();
  pollTimer = setInterval(pollOnce, settings.pollIntervalMs || 30_000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
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
      prompt: "This is a test prompt from Nexus Supervisor's settings screen — no real task, just checking the command runs.",
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
  if (!job || job.done === null || !job.workDir) return { ok: false };
  const newJob = startJob(job.prompt, job.workDir);
  return { ok: true, id: newJob.id };
});
ipcMain.handle("auth:status", () => ({ user: nexusLogin.currentUser() }));
ipcMain.handle("auth:login", async () => {
  const settings = getSettings();
  const result = await nexusLogin.login(settings.pmSystemUrl);
  if (result.ok) startPolling();
  return result;
});
ipcMain.handle("auth:logout", () => {
  nexusLogin.logout();
  stopPolling();
  pollStatus = "idle";
  broadcastStatus();
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
ipcMain.handle("catalog:listStatuses", (_e, projectId) => {
  const settings = getSettings();
  return nexusCatalog.getProjectStatuses(settings.pmSystemUrl, projectId);
});
ipcMain.handle("status:get", () => ({ status: currentStatus(), detail: pollDetail, config: currentConfig() }));
ipcMain.handle("usage:summary", () => {
  const settings = getSettings();
  return history.summarizeUsage(app.getPath("userData"), settings.historyRetentionDays);
});
ipcMain.handle("log:open", () => {
  require("electron").shell.showItemInFolder(log.path());
});

app.on("second-instance", () => {
  log.log("blocked a second instance from launching — already running");
  openSettingsWindow();
});

app.whenReady().then(() => {
  log.init(app.getPath("userData"));
  if (process.platform === "darwin") app.dock?.hide();
  app.setLoginItemSettings({ openAtLogin: true });

  const settingsAtStartup = getSettings();
  log.prune(settingsAtStartup.historyRetentionDays);
  const pastJobs = history.loadHistory(app.getPath("userData"), settingsAtStartup.historyRetentionDays);
  for (const entry of pastJobs.slice().reverse()) {
    recentJobs.push({ id: entry.id, prompt: entry.prompt, workDir: entry.workDir, lines: entry.lines, done: entry.done });
  }

  tray = new Tray(trayIcon("idle"));
  buildAndSetMenu();
  tray.on("click", () => tray.popUpContextMenu());

  if (!store.canConnect(settingsAtStartup) || !nexusLogin.currentUser()) {
    openSettingsWindow();
  } else {
    startPolling();
  }

  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      log.error(`auto-update check failed: ${err.message}`);
    });
  } catch (err) {
    log.error(`auto-updater unavailable: ${err.message}`);
  }
});

app.on("window-all-closed", () => {});
