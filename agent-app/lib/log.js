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

module.exports = {
  init,
  log: (message) => write("log", message),
  error: (message) => write("error", message),
  path: () => logFile,
};
