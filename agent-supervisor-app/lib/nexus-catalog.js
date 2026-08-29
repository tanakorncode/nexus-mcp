// Fetches the logged-in person's real projects/repositories/statuses from
// pm-system, for the Settings window's dropdowns — replaces free-typing a
// project/repo/status name that has to match Nexus exactly (case included)
// with picking from a list that's guaranteed correct. Read-only, GET-only,
// uses the same access token task-poller.js authenticates its claim calls
// with. Forked from agent-app/lib/nexus-catalog.js, plus getProjectStatuses
// (agent-app never needed per-project status names; this app does, since
// "which status counts as ready to claim" varies by project).
const nexusLogin = require("./nexus-login");

async function authedGet(pmSystemUrl, path) {
  const auth = await nexusLogin.getValidAccessToken(pmSystemUrl);
  if (auth.needsLogin) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  let res;
  try {
    res = await fetch(`${pmSystemUrl}${path}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
  } catch (err) {
    return { ok: false, error: `เชื่อมต่อ pm-system ไม่ได้: ${err.message}` };
  }
  if (!res.ok) {
    return { ok: false, error: `ดึงข้อมูลไม่สำเร็จ (HTTP ${res.status})` };
  }
  const body = await res.json();
  return { ok: true, body };
}

// Every project the logged-in person is a member of.
async function listProjects(pmSystemUrl) {
  const result = await authedGet(pmSystemUrl, "/api/v1/projects?perPage=100");
  if (!result.ok) return result;
  return {
    ok: true,
    data: (result.body.data ?? []).map((p) => ({ id: p.id, name: p.name, key: p.key })),
  };
}

// Repos registered under one project — empty array is a valid, common
// answer (a pure planning/BA project with no git repo at all).
async function listRepositories(pmSystemUrl, projectId) {
  const result = await authedGet(
    pmSystemUrl,
    `/api/v1/repositories?projectId=${encodeURIComponent(projectId)}`,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: (result.body.data ?? []).map((r) => ({ id: r.id, name: r.name, keyPrefix: r.keyPrefix })),
  };
}

// GET /api/v1/projects/:id returns a single project object under `data`
// (not a list) — mirrors how nexus-mcp's own list_statuses tool reads
// project.statuses rather than calling a dedicated statuses endpoint
// (there isn't one on the public v1 surface).
async function getProjectStatuses(pmSystemUrl, projectId) {
  const result = await authedGet(pmSystemUrl, `/api/v1/projects/${encodeURIComponent(projectId)}`);
  if (!result.ok) return result;
  const statuses = result.body.data?.statuses ?? [];
  return {
    ok: true,
    data: statuses.map((s) => ({ id: s.id, name: s.name, color: s.color, isDone: s.isDone, order: s.order, isDefault: s.isDefault })),
  };
}

module.exports = { listProjects, listRepositories, getProjectStatuses };
