// Self-hosted relay entrypoint — a long-running Node http server.
// Use this if the relay runs alongside pm-system (e.g. same Docker host,
// reachable on the internal network). For a publicly-reachable deployment
// (e.g. pm-system's server has no inbound access from outside), see
// api/webhook.js instead, deployed to Vercel or similar.
//
// Zero external dependencies on purpose — nothing to `npm install`.

import http from "node:http";
import { handleWebhook } from "./lib.mjs";

const PORT = Number(process.env.PORT ?? 8091);
const PM_WEBHOOK_SECRET = process.env.PM_WEBHOOK_SECRET;

if (!PM_WEBHOOK_SECRET) {
  console.error("[relay] PM_WEBHOOK_SECRET env var is required — this must match the secret configured on the pm-system AppWebhook.");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404).end();
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const result = await handleWebhook({
      rawBody,
      signatureHeader: req.headers["x-pm-signature"],
      secret: PM_WEBHOOK_SECRET,
    });
    res.writeHead(result.status).end(result.body);
  });
});

server.listen(PORT, () => {
  console.log(`[relay] listening on :${PORT}`);
});
