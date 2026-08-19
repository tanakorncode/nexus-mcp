import { Entry } from "@napi-rs/keyring";

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
  userId: string;
  userEmail: string;
  userName: string;
}

const SERVICE = "nexus-mcp";
const ACCOUNT = "active-token-set";

/**
 * Ported from nexus-vscode's TokenManager — same TokenSet shape and refresh
 * semantics, backed by the OS keychain (via @napi-rs/keyring) instead of
 * vscode.SecretStorage so it works outside VS Code, cross-platform.
 */
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

  isExpired(tokens: TokenSet): boolean {
    return Date.now() >= tokens.expiresAt - 60_000;
  }
}
