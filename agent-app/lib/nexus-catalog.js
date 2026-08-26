// Fetches the logged-in person's real projects/repositories from pm-system,
// for the Settings window's repo-mapping dropdowns — replaces free-typing a
// repo name that has to match Nexus exactly (case included) with picking
// from a list that's guaranteed correct. Read-only, GET-only, uses the same
// access token ws-client.js authenticates the socket with.
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
  return { ok: true, data: body.data ?? [] };
}

// Every project the logged-in person is a member of.
async function listProjects(pmSystemUrl) {
  const result = await authedGet(pmSystemUrl, "/api/v1/projects?perPage=100");
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.map((p) => ({ id: p.id, name: p.name, key: p.key })),
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
    data: result.data.map((r) => ({ id: r.id, name: r.name, keyPrefix: r.keyPrefix })),
  };
}

module.exports = { listProjects, listRepositories };
