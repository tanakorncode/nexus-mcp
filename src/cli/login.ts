#!/usr/bin/env node
import * as readline from "readline/promises";
import { createServer } from "http";
import { TokenStore } from "../auth/TokenStore.js";
import { generatePkce, generateState } from "../auth/pkce.js";
import { openBrowser } from "../auth/browser.js";

const DEFAULT_API_URL = "http://27.254.62.17:8090";
const apiUrl = (process.env.NEXUS_API_URL ?? DEFAULT_API_URL).replace(/\/$/, "");
const tokenStore = new TokenStore();

// `--manual` or NEXUS_TOKEN set → old paste-a-PAT flow. Useful on a headless
// box or anywhere a browser can't reach this machine's loopback address.
const useManual = process.argv.includes("--manual") || !!process.env.NEXUS_TOKEN;

if (useManual) {
  await manualLogin();
} else {
  await oauthLogin();
}

async function manualLogin(): Promise<void> {
  console.log(`
Generate a personal access token first:
  1. Open ${apiUrl}/developer in your browser and sign in
  2. Create an app (any name, e.g. "nexus-mcp")
  3. Grant scopes: tasks:read, tasks:write, projects:read, members:read, sprints:read
  4. Generate a token — copy it now, it's shown only once
`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const token = (process.env.NEXUS_TOKEN ?? (await rl.question("Paste the token (pm_...): "))).trim();
  const email = (await rl.question("Your Nexus account email: ")).trim();
  rl.close();

  if (!token.startsWith("pm_")) {
    console.error(`That doesn't look like a token (expected it to start with "pm_").`);
    process.exit(1);
  }
  if (!email.includes("@")) {
    console.error("That doesn't look like an email address.");
    process.exit(1);
  }

  await tokenStore.store({ type: "pat", token, email });
  console.log("Saved — token stored in the OS keychain.");
}

async function oauthLogin(): Promise<void> {
  const { verifier, challenge } = generatePkce();
  const state = generateState();

  const result = await waitForCallback(challenge, state);
  if ("error" in result) {
    console.error(`Login failed: ${result.error}`);
    console.error("You can also try the manual flow: nexus-mcp-login --manual");
    process.exit(1);
  }

  const tokenRes = await fetch(`${apiUrl}/api/auth/nexus/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: result.code,
      code_verifier: verifier,
      redirect_uri: result.redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    console.error(`Token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
    process.exit(1);
  }

  const data = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user: { id: string; email: string; name: string };
  };

  await tokenStore.store({
    type: "oauth",
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    user: data.user,
  });

  console.log(`Logged in as ${data.user.name} (${data.user.email}) — token stored in the OS keychain.`);
}

type CallbackResult = { code: string; redirectUri: string } | { error: string };

/** Spins up a one-shot local server on a random loopback port, opens the
 * browser to /authorize with it as redirect_uri, and resolves once pm-system
 * redirects back with ?code=&state= (or the 5-minute wait times out). */
function waitForCallback(challenge: string, state: string): Promise<CallbackResult> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: CallbackResult) => {
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
        res.end("<html><body><h2>Login failed</h2><p>Close this tab and try again.</p></body></html>");
        settle({ error: error ?? "state mismatch — possible replay or stale link" });
      } else {
        res.end("<html><body><h2>Logged in — you can close this tab.</h2></body></html>");
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

      console.log(`Opening your browser to log in...\nIf it doesn't open automatically, visit:\n  ${authorizeUrl.toString()}\n`);
      openBrowser(authorizeUrl.toString());
    });

    const timeout = setTimeout(() => settle({ error: "timed out waiting for login (5 min)" }), 5 * 60 * 1000);
    timeout.unref();
  });
}
