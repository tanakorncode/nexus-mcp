import { TokenStore } from "../auth/TokenStore.js";
import { OAuthProvider } from "../auth/OAuthProvider.js";

const apiUrl = process.env.NEXUS_API_URL;
if (!apiUrl) {
  console.error("NEXUS_API_URL is not set. Example: export NEXUS_API_URL=https://nexus.internal.pea");
  process.exit(1);
}

const tokenStore = new TokenStore();
const oauth = new OAuthProvider(tokenStore, () => apiUrl);

console.log("Opening browser to sign in to Nexus...");

try {
  const tokens = await oauth.login();
  console.log(`Signed in as ${tokens.userName} <${tokens.userEmail}>. Token stored in the OS keychain.`);
} catch (err) {
  console.error("Login failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
