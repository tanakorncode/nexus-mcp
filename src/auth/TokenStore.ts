import { Entry } from "@napi-rs/keyring";

export interface PatTokenSet {
  type: "pat";
  token: string; // pm_<hex> personal access token from the Developer Portal
  email: string; // used to resolve "me" against /api/v1/members (no /me endpoint exists)
}

export interface OAuthUser {
  id: string;
  email: string;
  name: string;
}

export interface OAuthTokenSet {
  type: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms epoch
  user: OAuthUser;
}

export type TokenSet = PatTokenSet | OAuthTokenSet;

const SERVICE = "nexus-mcp";
const ACCOUNT = "pat"; // legacy keychain account name — kept so pre-OAuth logins aren't orphaned

/** Stores the Nexus auth tokens in the OS keychain, cross-platform via @napi-rs/keyring. */
export class TokenStore {
  private readonly entry = new Entry(SERVICE, ACCOUNT);

  async store(tokens: TokenSet): Promise<void> {
    this.entry.setPassword(JSON.stringify(tokens));
  }

  async get(): Promise<TokenSet | null> {
    try {
      const raw = this.entry.getPassword();
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<TokenSet> & { token?: string; email?: string };
      // Logins from before OAuth support stored `{token, email}` with no `type` field.
      if (!parsed.type && parsed.token && parsed.email) {
        return { type: "pat", token: parsed.token, email: parsed.email };
      }
      return parsed as TokenSet;
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      this.entry.deletePassword();
    } catch {
      // nothing stored — fine
    }
  }
}
