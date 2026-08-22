#!/usr/bin/env node
import * as readline from "readline/promises";
import { TokenStore } from "../auth/TokenStore.js";

const apiUrl = process.env.NEXUS_API_URL;
if (!apiUrl) {
  console.error("NEXUS_API_URL is not set. Example: export NEXUS_API_URL=http://27.254.62.17:8090");
  process.exit(1);
}

console.log(`
Generate a personal access token first:
  1. Open ${apiUrl}/developer in your browser and sign in
  2. Create an app (any name, e.g. "nexus-mcp")
  3. Grant scopes: tasks:read, tasks:write, projects:read, members:read, sprints:read
  4. Generate a token — copy it now, it's shown only once
`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const token = (await rl.question("Paste the token (pm_...): ")).trim();
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

const tokenStore = new TokenStore();
await tokenStore.store({ token, email });
console.log("Saved — token stored in the OS keychain.");
