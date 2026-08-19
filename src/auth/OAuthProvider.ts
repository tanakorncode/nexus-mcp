import * as crypto from "crypto";
import * as http from "http";
import type { AddressInfo } from "net";
import open from "open";
import type { TokenStore, TokenSet } from "./TokenStore.js";

/**
 * Ported from nexus-vscode's OAuthProvider — identical PKCE flow and local
 * callback server. Only change: launches the browser via the `open` package
 * instead of vscode.env.openExternal.
 */
export class OAuthProvider {
  constructor(
    private readonly tokenStore: TokenStore,
    private readonly getApiUrl: () => string,
  ) {}

  // ── PKCE helpers ───────────────────────────────────────────────────────────

  private generateVerifier(): string {
    return crypto.randomBytes(96).toString("base64url");
  }

  private generateChallenge(verifier: string): string {
    return crypto.createHash("sha256").update(verifier).digest("base64url");
  }

  private generateState(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  // ── Login flow (local HTTP callback server) ────────────────────────────────

  async login(): Promise<TokenSet> {
    const verifier = this.generateVerifier();
    const challenge = this.generateChallenge(verifier);
    const state = this.generateState();

    const apiUrl = this.getApiUrl();

    return new Promise<TokenSet>((resolve, reject) => {
      let capturedPort = 0;

      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end();
          return;
        }

        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        const isSuccess = !error && code && returnedState === state;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>nexus-mcp</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;
    background:#0d1117;color:#e6edf3}
  .card{text-align:center;padding:2rem;max-width:360px}
  .icon{font-size:3rem;margin-bottom:1rem}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{color:#8b949e;font-size:.9rem;margin:.5rem 0}
</style></head><body>
<div class="card">
  <div class="icon">${isSuccess ? "✅" : "❌"}</div>
  <h1>${isSuccess ? "Signed in successfully" : "Sign-in failed"}</h1>
  <p>${isSuccess ? "You can close this tab and return to the terminal." : "Something went wrong. Please try again."}</p>
</div>
<script>if(${isSuccess}) setTimeout(function(){window.close()},1500)</script>
</body></html>`);

        server.close();

        if (error) {
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code || returnedState !== state) {
          reject(new Error("Invalid callback parameters"));
          return;
        }

        const redirectUri = `http://127.0.0.1:${capturedPort}/callback`;
        this._exchangeCode(code, verifier, redirectUri)
          .then((tokens) => this.tokenStore.store(tokens).then(() => resolve(tokens)))
          .catch(reject);
      });

      server.listen(0, "127.0.0.1", () => {
        capturedPort = (server.address() as AddressInfo).port;
        const redirectUri = `http://127.0.0.1:${capturedPort}/callback`;

        const authUrl = new URL(`${apiUrl}/api/auth/nexus/authorize`);
        authUrl.searchParams.set("code_challenge", challenge);
        authUrl.searchParams.set("code_challenge_method", "S256");
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("redirect_uri", redirectUri);

        open(authUrl.toString()).catch((err: unknown) => {
          server.close();
          reject(err);
        });

        setTimeout(() => {
          server.close();
          reject(new Error("Login timed out (5 min)"));
        }, 5 * 60 * 1000);
      });

      server.on("error", (err) => {
        reject(new Error(`Callback server error: ${err.message}`));
      });
    });
  }

  // ── Token exchange ─────────────────────────────────────────────────────────

  private async _exchangeCode(
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<TokenSet> {
    const apiUrl = this.getApiUrl();

    const res = await fetch(`${apiUrl}/api/auth/nexus/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      user: { id: string; email: string; name: string };
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      userId: data.user.id,
      userEmail: data.user.email,
      userName: data.user.name,
    };
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    const apiUrl = this.getApiUrl();

    const res = await fetch(`${apiUrl}/api/auth/nexus/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) {
      throw new Error(`Token refresh failed (${res.status})`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      user: { id: string; email: string; name: string };
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      userId: data.user.id,
      userEmail: data.user.email,
      userName: data.user.name,
    };
  }
}
