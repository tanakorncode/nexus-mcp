const fs = require("fs");
const path = require("path");

const PRESETS = {
  // --allowedTools before -p (not after) so its variadic argument list
  // stops at the next flag instead of swallowing {{prompt}} — verified
  // with a real `claude` invocation. Scoped to mcp__nexus-mcp__* only:
  // unattended runs have no one to answer Claude Code's own permission
  // prompt (a session-wide gate, separate from a subagent's own tools:
  // allowlist), so any tool not pre-approved here just silently fails
  // for every unattended job. This unblocks read-mostly roles (pm/ba/qa
  // querying and commenting on tasks); a role that also needs to write
  // files or run arbitrary Bash unattended (backend-dev/frontend-dev
  // implementing something) still needs those tool names added too —
  // deliberately not bundled in by default, since Bash/Write/Edit
  // pre-approved for every event (including ones carrying attacker-
  // adjacent task/comment content) is a materially bigger blast radius
  // than pre-approving one known MCP server's own tools.
  "Claude Code": 'claude --allowedTools "mcp__nexus-mcp__*" -p "{{prompt}}"',
  Codex: 'codex exec "{{prompt}}"',
  "Gemini CLI": 'gemini -p "{{prompt}}"',
  Custom: "",
};

const DEFAULTS = {
  serverUrl: "ws://27.254.62.17:8092",
  pmSystemUrl: "http://27.254.62.17:8090",
  preset: "Claude Code",
  command: PRESETS["Claude Code"],
  // Which local folder to work in depends on which repo (or, for a project
  // with no git repo at all — pure planning/BA work — which project) the
  // task belongs to. Array of { projectId, projectName, repositoryId,
  // repoName, path } — repositoryId/repoName are null for a project-only
  // row. See resolveWorkDir() for the matching order.
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
//
// Being logged in (a valid token in the OS keychain) is a separate check —
// it lives outside settings.json entirely, in nexus-login.js — so it's not
// part of this list even though the socket also needs it.
function missingConnectionFields(settings) {
  const missing = [];
  if (!settings.serverUrl) missing.push("Server");
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

// Which local folder to run in for a given task, preferring an exact repo
// match (most specific) and falling back to a project-only row (repoName
// null) when the task has no repository linked — the only option for a
// pure planning/BA project that was never registered as a git repo at all.
// Returns null if neither matches anything mapped on this machine.
function resolveWorkDir(settings, task) {
  const repoName = task?.repository?.name ?? null;
  if (repoName) {
    const match = settings.repoMap.find((r) => r.repoName === repoName);
    if (match) return match.path;
  }

  const projectName = task?.project?.name ?? null;
  if (projectName) {
    const match = settings.repoMap.find((r) => !r.repoName && r.projectName === projectName);
    if (match) return match.path;
  }

  return null;
}

module.exports = { load, save, isConfigured, canConnect, missingFields, resolveWorkDir, PRESETS, DEFAULTS };
