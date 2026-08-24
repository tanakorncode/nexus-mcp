import { randomBytes, createHash } from "crypto";

export interface Pkce {
  verifier: string;
  challenge: string;
}

/** PKCE S256 pair for the loopback OAuth flow against /api/auth/nexus/authorize. */
export function generatePkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}
