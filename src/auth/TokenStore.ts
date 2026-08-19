import { Entry } from "@napi-rs/keyring";

export interface TokenSet {
  token: string; // pm_<hex> personal access token from the Developer Portal
  email: string; // used to resolve "me" against /api/v1/members (no /me endpoint exists)
}

const SERVICE = "nexus-mcp";
const ACCOUNT = "pat";

/** Stores the Nexus personal access token in the OS keychain, cross-platform via @napi-rs/keyring. */
export class TokenStore {
  private readonly entry = new Entry(SERVICE, ACCOUNT);

  async store(tokens: TokenSet): Promise<void> {
    this.entry.setPassword(JSON.stringify(tokens));
  }

  async get(): Promise<TokenSet | null> {
    try {
      const raw = this.entry.getPassword();
      return raw ? (JSON.parse(raw) as TokenSet) : null;
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
