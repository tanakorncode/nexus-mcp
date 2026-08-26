# Nexus notify-server

Bridges pm-system's Redis event stream to each teammate's local agent app
(`agent-app/`) over a plain outbound WebSocket connection — the machine
dials out to this server, so it works through any laptop's NAT/firewall
without needing anything to reach back in.

```
pm-system (dispatch()) --publish--> Redis "nexus:events" --subscribe--> notify-server --WebSocket--> agent-app (per person)
```

## Why this exists

Earlier attempts (Claude Code routines, GitLab CI/CD) hit real platform
walls — see `nexus-mcp/DEVLOG.md`'s later entries for the full trail. This
is the design that actually works: pm-system already publishes every
`dispatch()` event to Redis (see its `src/lib/api-platform/event-publisher.ts`);
this server just subscribes, figures out which teammate a given task's
`assignee`/`additionalAssignees` belong to, and forwards the event to
whichever of them currently has a socket open.

## Running it

```bash
REDIS_URL=<same REDIS_URL pm-system uses> \
NOTIFY_SHARED_SECRET=<pick a secret, give it to every teammate's agent-app> \
node server.mjs
```

Or via Docker (standalone):

```bash
docker build -t nexus-notify-server .
docker run -d -p 8092:8092 \
  -e REDIS_URL=<...> \
  -e NOTIFY_SHARED_SECRET=<...> \
  nexus-notify-server
```

**In practice, this runs as a service in pm-system's own `docker-compose.prod.yml`**
(`nexus-notify-server`, assumes this repo is cloned as `../nexus-mcp` next to
pm-system's) — deploy/update it the same way as `app`:

```bash
docker compose -f docker-compose.prod.yml up -d --build nexus-notify-server
```

with `./notify-config/.env` (relative to where `docker-compose.prod.yml` lives)
holding `REDIS_URL` and `NOTIFY_SHARED_SECRET`.

Bound to all interfaces (`8092:8092`, not loopback-only) — unlike a purely
internal service, teammates' own laptops on the office network/VPN need
to reach this directly, not just pm-system on the same host. Doesn't need
to be internet-facing beyond that, since this team works from the office
network/VPN only (no remote/WFH access needed).

## Client protocol

Connect with `ws://<host>:8092?memberId=<nexus member id>&secret=<NOTIFY_SHARED_SECRET>`.
Wrong or missing secret closes the connection immediately (code `4001`).
Once connected, any event Redis carries where you're on `task.assignee` or
`task.additionalAssignees` gets forwarded verbatim (same JSON shape pm-system
published) — no server-side transformation.

A dead connection (laptop slept without a clean close) is detected via a
30s ping/pong heartbeat and cleaned up automatically.

## Known limits

- No delivery when disconnected — no queue/replay. If your agent-app was
  offline when an event fired, it's gone; the person just doesn't get
  notified until the next thing happens. Acceptable for this team's scale;
  revisit if it becomes a real problem.
- One shared secret for every teammate, not per-person tokens — identity
  is just whatever `memberId` the client claims. Fine on a trusted
  internal network; would need real per-person auth before ever exposing
  this beyond that.
- `NOTIFY_SHARED_SECRET` and `REDIS_URL` are both plain env vars — same
  handling as pm-system's own secrets, nothing extra here.
