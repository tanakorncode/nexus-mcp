# Nexus relay

Bridges pm-system's outbound task webhooks to Claude Code routines, so a
teammate's routine fires automatically when someone else updates a task
they're on — no polling, no "check if it's my turn" session.

```
pm-system  --(HMAC-signed webhook)-->  this relay  --(bearer-token fire)-->  teammate's routine
```

It exists because pm-system's webhook sender can't speak the routine
`/fire` endpoint's auth contract directly (it needs `Authorization` +
`anthropic-beta` + `anthropic-version` headers, which pm-system's
dispatcher doesn't send), and because one pm-system webhook fires for
every task in the workspace — something has to decide *which person's*
routine a given event belongs to.

## What it does

1. Receives the webhook POST from pm-system, verifies the `X-PM-Signature` HMAC against the raw body.
2. Looks at the task's `assignee` + `additionalAssignees` (reviewers) in
   the payload, maps each to a routine via the routing config.
3. POSTs a short text summary to each matched routine's fire endpoint,
   *waiting* for those calls before responding to pm-system — a
   serverless deployment (Vercel) can be frozen the instant a response is
   sent, so nothing left running in the background after that point is
   guaranteed to finish.

Currently wired events: `task.status_changed`, `task.comment_created`.

## One-time setup — each team member

You need Claude Code on the web enabled (Pro/Max/Team/Enterprise plan).

1. Create a routine at [claude.ai/code/routines](https://claude.ai/code/routines) describing what it should do when it fires — e.g. "read the task mentioned in this message via nexus-mcp tools (get_task_by_key, list_task_comments), then continue the work."
2. On that routine, click **Add another trigger** → **API** → **Generate token**. Copy the token (`sk-ant-oat01-...`) and the routine's fire URL — both shown once.
3. Find your own Nexus member id: call `whoami` via nexus-mcp, or ask whoever administers pm-system to look you up in `list_members`.
4. Send your member id + routine id (the `trig_...` from the fire URL) + token to whoever maintains `routing.json` on the relay host. This is a one-time handoff — nothing to redo unless you regenerate the token or change the routine.

## One-time setup — whoever administers the relay

1. Build the routing map — each team member's `{memberId: {name, routineId, routineToken}}`. **Never commit this anywhere** — it holds live bearer tokens. See `routing.example.json` for the shape.
2. Register one App + one webhook on pm-system pointing at this relay (see below). This is admin-only, not per-person.
3. Deploy the relay. There are two hops to think about separately — pm-system → relay, and relay → Anthropic's routine `/fire` endpoint — and only one of them is a real choice:
   - **pm-system → relay** isn't actually a decision if the relay runs *on the same host/network as pm-system* (e.g. another container in the same `docker compose`): that traffic never leaves the internal network, so whether pm-system's server accepts inbound connections from the public internet is irrelevant. This is the default — see "Deploying self-hosted" below.
   - **relay → Anthropic** is the one hop that's genuinely internet-facing, and it's *outbound only* — normally fine even on a locked-down internal server (no different from pm-system's own outbound calls to, e.g., the LINE API). Worth a one-time check if unsure: `curl -I https://api.anthropic.com` from that server should connect (any response, not necessarily 200) rather than time out or refuse.
   - The only real reason to reach for **Vercel** instead is if the relay *can't* be co-located with pm-system at all — e.g. whoever administers the relay has no deploy access to that server. See "Deploying to Vercel" below for that case.

The relay is two entrypoints sharing `lib.mjs`: `server.mjs` (self-hosted) and `api/webhook.js` (a Vercel Function using the Web Standard `fetch` handler — deliberately not the `request.body` convenience helper, which auto-parses JSON before the handler runs and would make the HMAC signature, computed over the exact raw bytes pm-system sent, unverifiable).

### Deploying self-hosted (default)

Run it as another service on the same host/network as pm-system — e.g. add it to pm-system's own `docker-compose.yml` as another service, so pm-system can reach it as `http://nexus-relay:8091/webhook` over the internal docker network with nothing exposed publicly.

Copy `routing.example.json` → `routing.json` (kept off git — already gitignored) and fill in the real values. The webhook endpoint is `http://<relay-host>:8091/webhook`.

```bash
PM_WEBHOOK_SECRET=<secret from webhook registration> \
ROUTING_CONFIG_PATH=/path/to/routing.json \
node server.mjs
```

Or via Docker:

```bash
docker build -t nexus-relay .
docker run -d \
  -p 8091:8091 \
  -e PM_WEBHOOK_SECRET=<secret> \
  -v /path/to/routing.json:/app/routing.json \
  -e ROUTING_CONFIG_PATH=/app/routing.json \
  nexus-relay
```

No `npm install` needed — both entrypoints use only Node/Web built-ins.

### Deploying to Vercel (only if the relay can't be co-located with pm-system)

1. Push this repo to GitHub (or GitLab/Bitbucket) if it isn't already, then import it into Vercel.
2. In the Vercel project's settings, set **Root Directory** to `relay` — this repo's own top-level `package.json` belongs to the unrelated MCP server, not this service.
3. Set environment variables on the Vercel project:
   - `PM_WEBHOOK_SECRET` — the secret from webhook registration (below)
   - `ROUTING_JSON` — the whole routing map as a single-line JSON string, e.g. `{"members":{"<memberId>":{"name":"...","routineId":"trig_...","routineToken":"sk-ant-oat01-..."}}}`
4. Deploy. The webhook endpoint is `https://<your-project>.vercel.app/api/webhook` — that's the `url` to register on pm-system.

No `vercel.json` needed — Vercel auto-detects `/api/webhook.js` as a function.

### Registering the pm-system webhook

Requires an App already registered on pm-system (Developer Portal), owned by whoever is doing this setup. Use the endpoint from whichever deployment you picked above (`.../api/webhook` for Vercel, `.../webhook` for self-hosted):

```bash
curl -X POST https://<pm-system-host>/api/apps/<appId>/webhooks \
  -H "Cookie: <session cookie>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<your-relay-endpoint>",
    "events": ["task.status_changed", "task.comment_created"]
  }'
```

The response includes `secret` — set it as `PM_WEBHOOK_SECRET` (shown once, same as the routine token).

## Known limits

- Routine `/fire` has no idempotency key. The relay awaits the fire call
  before responding to pm-system (typically well under a second), but if
  Anthropic's API is slow enough to approach pm-system's ~10s per-attempt
  timeout, pm-system's own retry could fire the same routine twice. No
  dedupe on either side today — accepted as a rare, low-stakes edge case
  rather than adding a shared state store to prevent it.
- Every pm-system webhook is workspace-wide (not scoped to a project or
  repo). The relay filters by task assignee/reviewer, not by project —
  if two people share a task's assignee list across unrelated projects,
  both get notified for every event on it.
- Only `task.status_changed` and `task.comment_created` are wired on the
  pm-system side today. Other events (`task.created`, `sprint.*`, etc.)
  exist as webhook events but summarize() doesn't have a case for them
  yet — they'll fall through to the generic default text.
- Routing config (file or `ROUTING_JSON`) is re-read on every request, no
  caching — fine at team scale, intentionally simple to hand-edit without
  a redeploy on the self-hosted path (Vercel needs a redeploy either way,
  since env var changes require one).
- Vercel Functions have an execution timeout (10s on Hobby, longer on
  paid plans) — fine for a single routine fire, could matter if a task
  has many assignees/reviewers all firing in the same request.
