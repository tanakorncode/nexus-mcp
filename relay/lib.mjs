// Shared logic between the two relay entrypoints:
//   - server.mjs   — self-hosted, long-running Node http server
//   - api/webhook.js — Vercel Function (Web Standard fetch handler)
//
// Kept dependency-free on purpose (Node/Web built-ins only) so either
// entrypoint deploys with nothing to `npm install`.

import crypto from "node:crypto";
import fs from "node:fs";

export const ANTHROPIC_BETA = "experimental-cc-routine-2026-04-01";
export const ANTHROPIC_VERSION = "2023-06-01";
export const ROUTINE_FIRE_BASE = "https://api.anthropic.com/v1/claude_code/routines";

// Routing config can come from an env var (ROUTING_JSON — a JSON string,
// the only option that makes sense on Vercel, where there's no
// persistent local disk to hand it a file) or a local file (ROUTING_CONFIG_PATH,
// for the self-hosted Docker deployment). Env var wins if both are set.
export function loadRouting() {
  const inline = process.env.ROUTING_JSON;
  if (inline) {
    const parsed = JSON.parse(inline);
    if (!parsed.members || typeof parsed.members !== "object") {
      throw new Error("ROUTING_JSON must have a top-level \"members\" object");
    }
    return parsed;
  }

  const path = process.env.ROUTING_CONFIG_PATH ?? new URL("./routing.json", import.meta.url).pathname;
  const raw = fs.readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed.members || typeof parsed.members !== "object") {
    throw new Error("routing config must have a top-level \"members\" object");
  }
  return parsed;
}

export function verifySignature(secret, rawBody, header) {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function summarize(event, payload) {
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
// assignees/reviewers, deduped, resolved against routing config's member map.
export function membersToNotify(routing, payload) {
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

export async function fireRoutine(routineId, token, text) {
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

// Verify + route + fire, shared by both entrypoints. Notifications are
// awaited (not fire-and-forget) — a serverless function can be frozen the
// instant its response is sent, so anything left running in the background
// after that point isn't guaranteed to finish.
export async function handleWebhook({ rawBody, signatureHeader, secret }) {
  if (!verifySignature(secret, rawBody, signatureHeader)) {
    return { status: 401, body: "invalid signature" };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: "invalid JSON body" };
  }

  const { event, payload } = parsed;

  let routing;
  try {
    routing = loadRouting();
  } catch (err) {
    console.error(`[relay] ${event}: failed to load routing config — ${err.message}`);
    return { status: 500, body: "routing config error" };
  }

  const targets = membersToNotify(routing, payload ?? {});
  if (targets.length === 0) {
    console.log(`[relay] ${event}: no routed member on this task, skipping`);
    return { status: 200, body: "ok (no target)" };
  }

  const text = summarize(event, payload ?? {});
  const results = await Promise.allSettled(
    targets.map((target) =>
      fireRoutine(target.routineId, target.routineToken, text).then((ok) => ({ name: target.name, ok })),
    ),
  );
  for (const r of results) {
    if (r.status === "fulfilled") {
      console.log(`[relay] ${event} → ${r.value.name}: ${r.value.ok ? "fired" : "failed"}`);
    } else {
      console.error(`[relay] ${event}: fire error — ${r.reason?.message ?? r.reason}`);
    }
  }

  return { status: 200, body: "ok" };
}
