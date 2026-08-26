// Reads the SAME OS keychain entry nexus-mcp-login already writes on this
// machine, instead of asking the person to run `whoami` and copy an id by
// hand. If they've already logged into nexus-mcp for Claude Code (which
// they have, if they're using nexus-mcp at all), this needs zero extra
// steps from them.
const { Entry } = require("@napi-rs/keyring");

const SERVICE = "nexus-mcp";
const ACCOUNT = "pat"; // matches nexus-mcp/src/auth/TokenStore.ts — legacy name, still current

function readTokens() {
  try {
    const entry = new Entry(SERVICE, ACCOUNT);
    const raw = entry.getPassword();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.type && parsed.token && parsed.email) {
      return { type: "pat", token: parsed.token, email: parsed.email };
    }
    return parsed;
  } catch {
    return null;
  }
}

// OAuth logins carry the member id directly (user.id). PAT (legacy) logins
// only have an email, so it takes one lookup against /api/v1/members to
// resolve which member that is.
async function resolveIdentity(pmSystemUrl) {
  const tokens = readTokens();
  if (!tokens) {
    return { error: "ยังไม่พบการ login ของ nexus-mcp บนเครื่องนี้ — รัน nexus-mcp-login ก่อน" };
  }

  if (tokens.type === "oauth") {
    return { memberId: tokens.user.id, name: tokens.user.name, email: tokens.user.email };
  }

  try {
    const res = await fetch(`${pmSystemUrl}/api/v1/members`, {
      headers: { Authorization: `Bearer ${tokens.token}` },
    });
    if (!res.ok) return { error: `ดึงรายชื่อสมาชิกไม่สำเร็จ (HTTP ${res.status})` };
    const body = await res.json();
    const members = Array.isArray(body) ? body : (body.data ?? []);
    const match = members.find((m) => m.email === tokens.email);
    if (!match) return { error: `ไม่พบสมาชิกที่ email ${tokens.email} ใน pm-system` };
    return { memberId: match.id, name: match.name, email: tokens.email };
  } catch (err) {
    return { error: `เชื่อมต่อ pm-system ไม่ได้: ${err.message}` };
  }
}

module.exports = { resolveIdentity };
