const fs = require("fs");
const path = require("path");

// Same command-template idea as agent-app — see command.js for why the
// prompt is injected as a single argv element rather than interpolated
// into a shell string. stream-json --verbose (not plain json) so Activity
// shows live progress instead of total silence until the whole run
// finishes — see agent-app/lib/runner.js's formatStreamEvent for why.
const PRESETS = {
  "Claude Code": 'claude --allowedTools "mcp__nexus-mcp__*" --output-format stream-json --verbose -p "{{prompt}}"',
  Codex: 'codex exec "{{prompt}}"',
  "Gemini CLI": 'gemini -p "{{prompt}}"',
  Custom: "",
};

const DEFAULTS = {
  pmSystemUrl: "http://27.254.62.17:8090",
  preset: "Claude Code",
  command: PRESETS["Claude Code"],
  // Same shape as agent-app's repoMap: { projectId, projectName,
  // repositoryId, repoName, path }. Doubles as "which projects this app
  // supervises" — a project counts as supervised iff it has at least one
  // row here, same as agent-app's existing pattern, rather than a second
  // separate project picker duplicating the same choice.
  repoMap: [],
  // projectId -> string[] of status NAMES (not ids — status names vary per
  // project, matched the same way task.status itself is a name) that count
  // as "ready to claim" for that project. Populated from
  // nexus-catalog.getProjectStatuses(); intentionally per-project since
  // there's no single "todo" convention across projects.
  readyStatusesByProjectId: {},
  enabled: true,
  historyRetentionDays: 7,
  autoRetryEnabled: true,
  // Polling trades agent-app's near-instant push model for whole-project
  // scope on purpose — kept conservative against pm-system's real rate
  // limiter (api-platform/rate-limiter.ts) rather than tuned for latency.
  pollIntervalMs: 30_000,
  // Checked only at claim time (see task-poller.js) — a poll cycle stops
  // claiming once this many jobs are already running, leaving remaining
  // ready tasks unclaimed for the next cycle (or a human) rather than
  // claiming work this machine can't get to soon.
  maxConcurrentJobs: 3,
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

// Only what's needed to attempt logging in / polling at all. repoMap isn't
// here on purpose, same reasoning as agent-app: "no repo mapped yet" and
// "can't reach pm-system" are different problems with different fixes.
function missingConnectionFields(settings) {
  const missing = [];
  if (!settings.pmSystemUrl) missing.push("pm-system URL");
  return missing;
}

function missingWorkFields(settings) {
  const missing = [];
  if (!settings.command) missing.push("Command");
  if (!settings.repoMap?.length) missing.push("โปรเจกต์ที่จะดูแล (อย่างน้อย 1 อัน)");
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

// Distinct project ids with at least one repoMap row — this IS "which
// projects are supervised," not a separate config surface.
function supervisedProjectIds(settings) {
  return [...new Set((settings.repoMap ?? []).map((r) => r.projectId).filter(Boolean))];
}

// Same overall shape as agent-app's store.js (exact repo match, then a
// project-only fallback for a task with no repository linked), but the
// fallback matches by projectId, not project name — deliberately different
// from agent-app. agent-app's tasks arrive via notify-server's push
// payload, built from pm-system's dispatch() calls that explicitly attach
// `project: {id,name,key}` (see withProjectSummary in pm-system's route
// source). task-poller.js's tasks come from plain GET /api/v1/tasks
// instead, which never attaches a nested `project` object at all — only
// `.projectId` (a plain scalar already on every task record) and `.url`.
// Matching on project.name against that shape silently never matches
// anything; projectId is always present and doesn't depend on the API
// response including project details at all.
function resolveWorkDir(settings, task) {
  const repoName = task?.repository?.name ?? null;
  if (repoName) {
    const match = settings.repoMap.find((r) => r.repoName === repoName);
    if (match) return match.path;
  }

  const projectId = task?.projectId ?? null;
  if (projectId) {
    const match = settings.repoMap.find((r) => !r.repoName && r.projectId === projectId);
    if (match) return match.path;
  }

  return null;
}

module.exports = {
  load,
  save,
  isConfigured,
  canConnect,
  missingFields,
  resolveWorkDir,
  supervisedProjectIds,
  PRESETS,
  DEFAULTS,
};
