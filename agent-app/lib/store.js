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

// What's still missing before a connection can even be attempted — kept
// separate from connection status itself (unconfigured vs. configured-
// but-can't-reach-the-server are different problems with different fixes).
function missingFields(settings) {
  const missing = [];
  if (!settings.serverUrl) missing.push("Server");
  if (!settings.memberId) missing.push("Nexus member id");
  if (!settings.secret) missing.push("Shared secret");
  if (!settings.command) missing.push("Command");
  if (!settings.repoMap?.length) missing.push("Repo mapping (อย่างน้อย 1 อัน)");
  return missing;
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

module.exports = { load, save, isConfigured, missingFields, resolveWorkDir, PRESETS, DEFAULTS };
