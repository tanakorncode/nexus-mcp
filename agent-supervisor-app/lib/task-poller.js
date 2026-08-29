// Discovers tasks this machine should claim and run, and claims them.
//
// No "unassigned" filter exists on GET /api/v1/tasks (verified by reading
// pm-system's route source directly) — list by projectId+status and filter
// client-side for assignee === null. No optimistic locking exists on
// PATCH /api/v1/tasks/:id either (also verified directly, not guessed) —
// claimTask() does the best a plain unconditional PATCH allows: write, then
// immediately re-fetch to confirm the write actually stuck before treating
// the task as ours to run. That narrows the race window; it can't close it
// (a third write could still land after our re-fetch) — there is no
// version/ETag field to make this properly atomic.
const nexusLogin = require("./nexus-login");
const store = require("./store");

async function authedRequest(pmSystemUrl, path, { method = "GET", body } = {}) {
  const auth = await nexusLogin.getValidAccessToken(pmSystemUrl);
  if (auth.needsLogin) return { ok: false, reason: "needs_login" };

  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`${pmSystemUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return { ok: false, reason: "network_error", detail: err.message };
  }
  if (!res.ok) {
    return { ok: false, reason: "http_error", detail: `HTTP ${res.status} on ${method} ${path}` };
  }
  const json = await res.json();
  return { ok: true, json };
}

// Every currently-claimable task across every supervised project: unassigned,
// in one of that project's configured "ready" statuses, AND resolvable to a
// local workDir. A task this machine can't actually run (no folder mapped)
// is filtered out here — never claimed, same as agent-app's existing
// "log and skip" behavior for an unmapped repo — a claimed task with
// nothing happening looks actively-worked-on to anyone watching the board.
//
// Doesn't paginate past the first 100 results per project+status combo
// (pm-system's own perPage cap) — an unusual amount of backlog for one
// status to matter in practice, and nothing about a task skipped this way
// is lost: it's still unassigned and visible next poll cycle.
async function listReadyTasks(settings, { onSkip } = {}) {
  const skip = onSkip ?? (() => {});
  const results = [];

  for (const projectId of store.supervisedProjectIds(settings)) {
    const readyStatuses = settings.readyStatusesByProjectId?.[projectId] ?? [];
    if (readyStatuses.length === 0) continue;

    for (const statusName of readyStatuses) {
      const qs = new URLSearchParams({ projectId, status: statusName, perPage: "100" });
      const page = await authedRequest(settings.pmSystemUrl, `/api/v1/tasks?${qs}`);
      if (!page.ok) {
        skip(`list tasks failed for project ${projectId} status "${statusName}": ${page.reason} ${page.detail ?? ""}`);
        continue;
      }

      for (const task of page.json.data ?? []) {
        if (task.assignee) continue; // already someone's — not ours to touch
        // A task with no description has nothing concrete for an unattended
        // run to act on safely — no acceptance criteria, no scope, nothing
        // to distinguish it from any other task that happens to sit in the
        // same project. Claiming it anyway risks running real, unsupervised
        // work against whatever the model guesses the title means (found
        // this for real: several old placeholder tasks with titles like
        // "Design Login Page" and no description at all, sitting unassigned
        // in the same project as genuine nexus-demo work — a project-level
        // workDir fallback can't tell those apart from real, in-scope
        // tasks; refusing to claim anything with no real spec closes that
        // gap regardless of how workDir resolution is configured).
        if (!task.description || !task.description.trim()) {
          skip(`${task.taskKey ?? task.id} ready but has no description — not claiming (nothing to act on safely, unattended)`);
          continue;
        }
        const workDir = store.resolveWorkDir(settings, task);
        if (!workDir) {
          skip(`${task.taskKey ?? task.id} ready but no local folder mapped for its repo/project — not claiming`);
          continue;
        }
        results.push({ task, workDir });
      }
    }
  }

  // Oldest-created first — the API's own default order is createdAt desc
  // (newest first), which would starve older backlog items indefinitely
  // under a concurrency cap.
  results.sort((a, b) => new Date(a.task.createdAt) - new Date(b.task.createdAt));
  return results;
}

// Claims one task for `selfMemberId`. See file header for why this can't be
// a true atomic claim — PATCH then re-fetch is the closest available.
async function claimTask(settings, taskId, selfMemberId) {
  const patch = await authedRequest(settings.pmSystemUrl, `/api/v1/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: { assigneeId: selfMemberId },
  });
  if (!patch.ok) return patch;

  const verify = await authedRequest(settings.pmSystemUrl, `/api/v1/tasks/${encodeURIComponent(taskId)}`);
  if (!verify.ok) return verify;

  const task = verify.json.data;
  if (task?.assignee?.id !== selfMemberId) {
    return { ok: false, reason: "lost_race", task };
  }
  return { ok: true, task };
}

module.exports = { listReadyTasks, claimTask };
