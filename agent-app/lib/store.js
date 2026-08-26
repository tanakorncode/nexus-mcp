const fs = require("fs");
const path = require("path");

const PRESETS = {
  "Claude Code": 'claude -p "{{prompt}}"',
  Codex: 'codex exec "{{prompt}}"',
  "Gemini CLI": 'gemini -p "{{prompt}}"',
  Custom: "",
};

const DEFAULTS = {
  serverUrl: "ws://27.254.62.17:8092",
  pmSystemUrl: "http://27.254.62.17:8090",
  memberId: "",
  memberName: "",
  secret: "",
  preset: "Claude Code",
  command: PRESETS["Claude Code"],
  // Which local folder to work in depends on which repo the task belongs
  // to — a person can have more than one project checked out. Array of
  // { repoName, path }, matched against the event's task.repository.name.
  repoMap: [],
  enabled: true,
  historyRetentionDays: 7,
};

function storePath(userDataDir) {
  return path.join(userDataDir, "settings.json");
}

function load(userDataDir) {
  try {
    const raw = fs.readFileSync(storePath(userDataDir), "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(userDataDir, settings) {
  fs.writeFileSync(storePath(userDataDir), JSON.stringify(settings, null, 2), "utf8");
}

// Only what the socket itself actually needs. repoMap/command are NOT
// here on purpose — they decide what happens once an event arrives, they
// have nothing to do with whether a connection can be opened. Gating the
// socket on repoMap too meant "no repo mapped yet" looked identical to
// "can't reach the server", which is a different problem with a different
// fix — this was a real bug, not a design nuance.
function missingConnectionFields(settings) {
  const missing = [];
  if (!settings.serverUrl) missing.push("Server");
  if (!settings.memberId) missing.push("Nexus member id");
  if (!settings.secret) missing.push("Shared secret");
  return missing;
}

// Beyond connecting: what's needed to actually do anything useful once
// connected. Missing these doesn't stop the socket from connecting — it
// just means handleEvent() has nothing to route an incoming event to.
function missingWorkFields(settings) {
  const missing = [];
  if (!settings.command) missing.push("Command");
  if (!settings.repoMap?.length) missing.push("Repo mapping (อย่างน้อย 1 อัน)");
  return missing;
}

function missingFields(settings) {
  return [...missingConnectionFields(settings), ...missingWorkFields(settings)];
}

function canConnect(settings) {
  return missingConnectionFields(settings).length === 0;
}

function isConfigured(settings) {
  return missingFields(settings).length === 0;
}

// Which local folder to run in for a given event, based on which repo the
// task belongs to. Returns null if that repo isn't mapped on this machine.
function resolveWorkDir(settings, repoName) {
  if (!repoName) return null;
  const match = settings.repoMap.find((r) => r.repoName === repoName);
  return match?.path ?? null;
}

module.exports = { load, save, isConfigured, canConnect, missingFields, resolveWorkDir, PRESETS, DEFAULTS };
