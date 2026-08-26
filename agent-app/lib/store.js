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

function isConfigured(settings) {
  return Boolean(
    settings.serverUrl &&
      settings.memberId &&
      settings.secret &&
      settings.command &&
      settings.repoMap?.length > 0,
  );
}

// Which local folder to run in for a given event, based on which repo the
// task belongs to. Returns null if that repo isn't mapped on this machine.
function resolveWorkDir(settings, repoName) {
  if (!repoName) return null;
  const match = settings.repoMap.find((r) => r.repoName === repoName);
  return match?.path ?? null;
}

module.exports = { load, save, isConfigured, resolveWorkDir, PRESETS, DEFAULTS };
