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
  memberId: "",
  secret: "",
  preset: "Claude Code",
  command: PRESETS["Claude Code"],
  workDir: "",
  enabled: true,
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
  return Boolean(settings.serverUrl && settings.memberId && settings.secret && settings.command && settings.workDir);
}

module.exports = { load, save, isConfigured, PRESETS, DEFAULTS };
