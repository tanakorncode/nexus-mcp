// Vercel Function entrypoint (Web Standard fetch handler) — use this when
// pm-system's server has no inbound access from outside (deploy the relay
// publicly instead, e.g. on Vercel, and pm-system reaches it outbound).
//
// Deliberately uses the Web Standard `request.text()` for the raw body
// instead of Vercel's `request.body` convenience helper — that helper
// auto-parses JSON before the handler runs, which would make the HMAC
// signature (computed over the exact raw bytes pm-system sent) unverifiable.
//
// Deploy with this directory's "Root Directory" set to `relay` in the
// Vercel project settings (this repo also has an unrelated package.json
// at its own root for the MCP server) — see ../README.md.

import { handleWebhook } from "../lib.mjs";

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return new Response("not found", { status: 404 });
    }

    const secret = process.env.PM_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[relay] PM_WEBHOOK_SECRET env var is not set");
      return new Response("server misconfigured", { status: 500 });
    }

    const rawBody = await request.text();
    const result = await handleWebhook({
      rawBody,
      signatureHeader: request.headers.get("x-pm-signature"),
      secret,
    });

    return new Response(result.body, { status: result.status });
  },
};
