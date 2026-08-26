// Nexus → Claude Code routine relay.
//
// Receives pm-system's outbound task webhooks (HMAC-signed) and re-fires
// them as Claude Code routine runs for whichever team member is on the
// task, via the routines/{id}/fire API. Exists because pm-system's
// generic webhook sender can't speak the routine fire endpoint's auth
// contract (Authorization/anthropic-beta/anthropic-version headers) and
// has no concept of "which person on the team should react to this".
//
// Zero external dependencies on purpose — this is meant to run
// unattended next to pm-system with nothing to `npm install`.

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";

const PORT = Number(process.env.PORT ?? 8091);
const PM_WEBHOOK_SECRET = process.env.PM_WEBHOOK_SECRET;
const ROUTING_CONFIG_PATH = process.env.ROUTING_CONFIG_PATH ?? new URL("./routing.json", import.meta.url).pathname;

const ANTHROPIC_BETA = "experimental-cc-routine-2026-04-01";
const ANTHROPIC_VERSION = "2023-06-01";
const ROUTINE_FIRE_BASE = "https://api.anthropic.com/v1/claude_code/routines";

if (!PM_WEBHOOK_SECRET) {
  console.error("[relay] PM_WEBHOOK_SECRET env var is required — this must match the secret configured on the pm-system AppWebhook.");
  process.exit(1);
}

function loadRouting() {
  const raw = fs.readFileSync(ROUTING_CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed.members || typeof parsed.members !== "object") {
    throw new Error("routing config must have a top-level \"members\" object");
  }
  return parsed;
}

function verifySignature(secret, rawBody, header) {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function summarize(event, payload) {
  const task = payload?.task;
  const taskLabel = task ? `${task.taskKey ?? task.id} — ${task.name}` : (payload?.taskId ?? "unknown task");
  const url = task?.url ? `\n${task.url}` : "";

  switch (event) {
    case "task.status_changed":
      return `[Nexus] ${taskLabel}\nStatus changed: ${payload.from} → ${payload.to}${url}`;
    case "task.comment_created": {
      const author = payload.comment?.author?.name ?? "someone";
      const content = payload.comment?.content ?? "";
      return `[Nexus] ${taskLabel}\nNew comment from ${author}: "${content}"${url}`;
    }
    default:
      return `[Nexus] ${event} on ${taskLabel}${url}`;
  }
}

// Who on the team should react: the primary assignee plus any additional
// assignees/reviewers, deduped, resolved against routing.json's member map.
function membersToNotify(routing, payload) {
  const ids = new Set();
  const task = payload?.task;
  if (task?.assignee?.id) ids.add(task.assignee.id);
  for (const a of task?.additionalAssignees ?? []) {
    if (a?.member?.id) ids.add(a.member.id);
  }
  return [...ids]
    .map((id) => routing.members[id])
    .filter((m) => m && m.routineId && m.routineToken);
}

async function fireRoutine(routineId, token, text) {
  const res = await fetch(`${ROUTINE_FIRE_BASE}/${routineId}/fire`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": ANTHROPIC_BETA,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    console.error(`[relay] routine fire failed (${res.status}): ${bodyText}`);
  }
  return res.ok;
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404).end();
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    const sig = req.headers["x-pm-signature"];

    if (!verifySignature(PM_WEBHOOK_SECRET, raw, sig)) {
      res.writeHead(401).end("invalid signature");
      return;
    }

    // Ack immediately: pm-system retries on any non-2xx/timeout, and the
    // routine fire endpoint has no idempotency key, so a slow response
    // here would risk firing the same routine multiple times.
    res.writeHead(200).end("ok");

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      console.error("[relay] dropped: body is not valid JSON");
      return;
    }

    const { event, payload } = body;

    let routing;
    try {
      routing = loadRouting();
    } catch (err) {
      console.error(`[relay] dropped ${event}: failed to load routing config — ${err.message}`);
      return;
    }

    const targets = membersToNotify(routing, payload ?? {});
    if (targets.length === 0) {
      console.log(`[relay] ${event}: no routed member on this task, skipping`);
      return;
    }

    const text = summarize(event, payload ?? {});
    for (const target of targets) {
      fireRoutine(target.routineId, target.routineToken, text)
        .then((ok) => console.log(`[relay] ${event} → ${target.name}: ${ok ? "fired" : "failed"}`))
        .catch((err) => console.error(`[relay] ${event} → ${target.name}: error — ${err.message}`));
    }
  });
});

server.listen(PORT, () => {
  console.log(`[relay] listening on :${PORT}, routing config: ${ROUTING_CONFIG_PATH}`);
});
