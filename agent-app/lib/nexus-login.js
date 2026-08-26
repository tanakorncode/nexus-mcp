// Real per-person login for the WebSocket connection to notify-server —
// replaces the old "type in a memberId + a secret every teammate shares"
// setup. Reuses the exact PKCE loopback flow nexus-mcp's own CLI login
// (nexus-mcp/src/cli/login.ts) already has working against pm-system, and
// writes to the SAME OS keychain entry it does — logging in with either
// one authenticates both, since it's one Nexus identity per machine either way.
const { Entry } = require("@napi-rs/keyring");
const { createServer } = require("http");
const { randomBytes, createHash } = require("crypto");
const { shell } = require("electron");

const SERVICE = "nexus-mcp";
const ACCOUNT = "pat"; // matches nexus-mcp/src/auth/TokenStore.ts — legacy name, still current

function entry() {
  return new Entry(SERVICE, ACCOUNT);
}

function readTokens() {
  try {
    const raw = entry().getPassword();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Logins from before OAuth support (or nexus-mcp-login --manual) stored
    // `{token, email}` with no `type` field, or `type: "pat"` explicitly.
    if (!parsed.type && parsed.token && parsed.email) {
      return { type: "pat", token: parsed.token, email: parsed.email };
    }
    return parsed;
  } catch {
    return null;
  }
}

function storeTokens(tokens) {
  entry().setPassword(JSON.stringify(tokens));
}

function clearTokens() {
  try {
    entry().deletePassword();
  } catch {
    // nothing stored — fine
  }
}

function generatePkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function generateState() {
  return randomBytes(16).toString("hex");
}

// Spins up a one-shot local server on a random loopback port, opens the
// system browser to pm-system's /authorize with it as redirect_uri, and
// resolves once pm-system redirects back with ?code=&state= (or the
// 5-minute wait times out).
function waitForCallback(apiUrl, challenge, state) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
      setImmediate(() => server.close());
    };

    let redirectUri = "";

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (error || !code || returnedState !== state) {
        res.end("<html><body><h2>เข้าสู่ระบบไม่สำเร็จ</h2><p>ปิดแท็บนี้แล้วลองใหม่จาก Nexus Agent ได้เลย</p></body></html>");
        settle({ error: error ?? "state mismatch — possible replay or stale link" });
      } else {
        res.end("<html><body><h2>เข้าสู่ระบบสำเร็จ</h2><p>ปิดแท็บนี้แล้วกลับไปที่ Nexus Agent ได้เลย</p></body></html>");
        settle({ code, redirectUri });
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      redirectUri = `http://127.0.0.1:${port}/callback`;

      const authorizeUrl = new URL(`${apiUrl}/api/auth/nexus/authorize`);
      authorizeUrl.searchParams.set("code_challenge", challenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
      authorizeUrl.searchParams.set("state", state);
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);

      shell.openExternal(authorizeUrl.toString());
    });

    const timeout = setTimeout(
      () => settle({ error: "รอ login นานเกินไป (5 นาที) — ลองใหม่อีกครั้ง" }),
      5 * 60 * 1000,
    );
    timeout.unref();
  });
}

// Full PKCE loopback login — opens the system browser, waits for pm-system
// to redirect back, exchanges the code for tokens, and stores them.
async function login(pmSystemUrl) {
  const { verifier, challenge } = generatePkce();
  const state = generateState();

  const result = await waitForCallback(pmSystemUrl, challenge, state);
  if ("error" in result) return { ok: false, error: result.error };

  let tokenRes;
  try {
    tokenRes = await fetch(`${pmSystemUrl}/api/auth/nexus/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: result.code, code_verifier: verifier, redirect_uri: result.redirectUri }),
    });
  } catch (err) {
    return { ok: false, error: `เชื่อมต่อ pm-system ไม่ได้: ${err.message}` };
  }

  if (!tokenRes.ok) {
    return { ok: false, error: `แลก token ไม่สำเร็จ (HTTP ${tokenRes.status}): ${await tokenRes.text()}` };
  }

  const data = await tokenRes.json();
  storeTokens({
    type: "oauth",
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    user: data.user,
  });
  return { ok: true, user: data.user };
}

function logout() {
  clearTokens();
}

// For display only (e.g. Settings showing "logged in as X") — reads
// straight from the keychain, no network call, no refresh.
function currentUser() {
  const tokens = readTokens();
  if (!tokens || tokens.type !== "oauth") return null;
  return tokens.user;
}

// Refresh a bit before actual expiry so a request made right at the
// boundary doesn't race the server's own clock.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

async function refresh(pmSystemUrl, tokens) {
  let res;
  try {
    res = await fetch(`${pmSystemUrl}/api/auth/nexus/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: tokens.refreshToken }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const data = await res.json();
  const next = {
    type: "oauth",
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    user: data.user,
  };
  storeTokens(next);
  return next;
}

// The one thing ws-client needs on every (re)connect attempt: a currently
// valid access token, refreshing first if it's expired or close to it.
// Only an "oauth" token works here — notify-server verifies a real JWT
// now, so a legacy PAT (from `nexus-mcp-login --manual`) can't authenticate
// the socket even though it's still fine for pm-system's own HTTP API.
async function getValidAccessToken(pmSystemUrl) {
  let tokens = readTokens();
  if (!tokens || tokens.type !== "oauth") return { needsLogin: true };

  if (Date.now() > tokens.expiresAt - REFRESH_MARGIN_MS) {
    const refreshed = await refresh(pmSystemUrl, tokens);
    if (!refreshed) {
      clearTokens();
      return { needsLogin: true };
    }
    tokens = refreshed;
  }

  return { accessToken: tokens.accessToken, user: tokens.user };
}

module.exports = { login, logout, currentUser, getValidAccessToken };
