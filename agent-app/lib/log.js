const fs = require("fs");
const path = require("path");

// console.log only reaches anyone if the app happens to be launched from a
// terminal — the normal double-click-the-installed-app path has no visible
// console at all. Writes to both: console for `npm start` dev use, plus a
// file anyone can open/tail regardless of how the app was launched.
let logFile = null;

function init(userDataDir) {
  logFile = path.join(userDataDir, "agent.log");
}

function write(level, message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  if (level === "error") console.error(line);
  else console.log(line);

  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, line + "\n", "utf8");
  } catch {
    // logging must never crash the app
  }
}

// Mirrors history.js's own retention pruning — reuses historyRetentionDays
// rather than introducing a second "how long to keep stuff" setting.
// Without this, agent.log has no size cap at all: this app is meant to run
// indefinitely in the background, so the file would just grow forever.
// Only called at startup and whenever settings are saved (same call sites
// history.loadHistory already uses for the same reason) — not on every
// write(), which would mean re-reading/rewriting the whole file on every
// single log line.
function prune(retentionDays) {
  if (!logFile) return;
  let raw;
  try {
    raw = fs.readFileSync(logFile, "utf8");
  } catch {
    return; // nothing written yet
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const kept = raw.split("\n").filter((line) => {
    if (!line) return false; // the split's trailing empty entry from the file's final "\n"
    const match = line.match(/^\[([^\]]+)\]/);
    if (!match) return true; // unrecognized shape — keep rather than risk losing something real
    const ts = Date.parse(match[1]);
    return Number.isNaN(ts) || ts >= cutoff;
  });

  try {
    fs.writeFileSync(logFile, kept.length ? kept.join("\n") + "\n" : "", "utf8");
  } catch {
    // pruning must never crash the app, same spirit as write()
  }
}

module.exports = {
  init,
  prune,
  log: (message) => write("log", message),
  error: (message) => write("error", message),
  path: () => logFile,
};
