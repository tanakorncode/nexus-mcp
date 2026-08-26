// Bridges pm-system's Redis event publishes (see pm-system's
// src/lib/api-platform/event-publisher.ts) to each teammate's local agent
// app over a plain WebSocket connection they open outbound to this server —
// solves the same "can't push into someone's laptop" problem as before,
// but the laptop dials out instead of anything dialing in.
//
// Not a webhook-dispatcher client: subscribes directly to pm-system's
// internal Redis channel, since this only ever needs to reach machines on
// the same trusted network as this server, not speak the wider webhook
// contract (no per-consumer secrets/signatures needed here).

import { WebSocketServer } from "ws";
import Redis from "ioredis";

const PORT = Number(process.env.PORT ?? 8092);
const REDIS_URL = process.env.REDIS_URL;
const SHARED_SECRET = process.env.NOTIFY_SHARED_SECRET;
const CHANNEL = "nexus:events";
const HEARTBEAT_MS = 30_000;

if (!REDIS_URL) {
  console.error("[notify-server] REDIS_URL env var is required");
  process.exit(1);
}
if (!SHARED_SECRET) {
  console.error("[notify-server] NOTIFY_SHARED_SECRET env var is required");
  process.exit(1);
}

// memberId -> Set<WebSocket>. A person can have more than one device/reconnect.
const clientsByMember = new Map();

function addClient(memberId, ws) {
  if (!clientsByMember.has(memberId)) clientsByMember.set(memberId, new Set());
  clientsByMember.get(memberId).add(ws);
}

function removeClient(memberId, ws) {
  const set = clientsByMember.get(memberId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) clientsByMember.delete(memberId);
}

function memberIdsForEvent(payload) {
  const ids = new Set();
  const task = payload?.task;
  if (task?.assignee?.id) ids.add(task.assignee.id);
  for (const a of task?.additionalAssignees ?? []) {
    if (a?.member?.id) ids.add(a.member.id);
  }
  return ids;
}

const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
redis.on("error", (err) => console.error("[notify-server] Redis error:", err.message));

redis.subscribe(CHANNEL, (err) => {
  if (err) {
    console.error("[notify-server] failed to subscribe:", err.message);
    process.exit(1);
  }
  console.log(`[notify-server] subscribed to ${CHANNEL}`);
});

redis.on("message", (_channel, raw) => {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    console.error("[notify-server] dropped malformed Redis message");
    return;
  }

  const targets = memberIdsForEvent(body.payload ?? {});
  if (targets.size === 0) return;

  const outgoing = JSON.stringify(body);
  for (const memberId of targets) {
    const sockets = clientsByMember.get(memberId);
    if (!sockets) continue;
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) ws.send(outgoing);
    }
  }
  console.log(`[notify-server] ${body.event} -> ${[...targets].length} member(s) checked, delivered to whoever's connected`);
});

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const memberId = url.searchParams.get("memberId");
  const secret = url.searchParams.get("secret");

  if (!memberId || secret !== SHARED_SECRET) {
    ws.close(4001, "unauthorized");
    return;
  }

  addClient(memberId, ws);
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  console.log(`[notify-server] ${memberId} connected (${clientsByMember.get(memberId).size} socket(s))`);

  ws.on("close", () => {
    removeClient(memberId, ws);
    console.log(`[notify-server] ${memberId} disconnected`);
  });

  ws.on("error", (err) => {
    console.error(`[notify-server] socket error for ${memberId}:`, err.message);
  });
});

// Drop dead connections that never respond to ping (e.g. laptop slept
// without a clean close) so they don't linger in clientsByMember forever.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

console.log(`[notify-server] listening on :${PORT}`);
