import { TokenStore } from "../auth/TokenStore.js";

const tokenStore = new TokenStore();
await tokenStore.clear();
console.log("Signed out — token removed from the OS keychain.");
