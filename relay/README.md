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

1. Receives `POST /webhook` from pm-system, verifies the `X-PM-Signature` HMAC.
2. Acks `200` immediately (before doing anything else — pm-system retries
   on non-2xx/timeout, and routine fires have no idempotency key, so a
   slow response here risks double-firing someone's routine).
3. Looks at the task's `assignee` + `additionalAssignees` (reviewers) in
   the payload, maps each to a routine via `routing.json`.
4. POSTs a short text summary to each matched routine's fire endpoint.

Currently wired events: `task.status_changed`, `task.comment_created`.

## One-time setup — each team member

You need Claude Code on the web enabled (Pro/Max/Team/Enterprise plan).

1. Create a routine at [claude.ai/code/routines](https://claude.ai/code/routines) describing what it should do when it fires — e.g. "read the task mentioned in this message via nexus-mcp tools (get_task_by_key, list_task_comments), then continue the work."
2. On that routine, click **Add another trigger** → **API** → **Generate token**. Copy the token (`sk-ant-oat01-...`) and the routine's fire URL — both shown once.
3. Find your own Nexus member id: call `whoami` via nexus-mcp, or ask whoever administers pm-system to look you up in `list_members`.
4. Send your member id + routine id (the `trig_...` from the fire URL) + token to whoever maintains `routing.json` on the relay host. This is a one-time handoff — nothing to redo unless you regenerate the token or change the routine.

## One-time setup — whoever administers the relay

1. Copy `routing.example.json` → `routing.json`, fill in each team member's `{memberId: {name, routineId, routineToken}}`. **Never commit `routing.json`** (already gitignored) — it holds live bearer tokens.
2. Register one App + one webhook on pm-system pointing at this relay (see below). This is admin-only, not per-person.
3. Deploy the relay somewhere pm-system's server can reach over HTTP — same box as pm-system is simplest (`docker compose` alongside it).

### Registering the pm-system webhook

Requires an App already registered on pm-system (Developer Portal), owned by whoever is doing this setup:

```bash
curl -X POST https://<pm-system-host>/api/apps/<appId>/webhooks \
  -H "Cookie: <session cookie>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<relay-host>/webhook",
    "events": ["task.status_changed", "task.comment_created"]
  }'
```

The response includes `secret` — set it as `PM_WEBHOOK_SECRET` on the relay (shown once, same as the routine token).

### Running it

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

No `npm install` needed — the server uses only Node built-ins.

## Known limits

- Routine `/fire` has no idempotency key. If the relay's own `fetch` to
  Anthropic's API times out after Anthropic already started the run, a
  retry from the relay isn't attempted (single-shot, fire-and-forget) —
  but there's no receipt/dedupe on Anthropic's side either.
- Every pm-system webhook is workspace-wide (not scoped to a project or
  repo). The relay filters by task assignee/reviewer, not by project —
  if two people share a task's assignee list across unrelated projects,
  both get notified for every event on it.
- Only `task.status_changed` and `task.comment_created` are wired on the
  pm-system side today. Other events (`task.created`, `sprint.*`, etc.)
  exist as webhook events but summarize() doesn't have a case for them
  yet — they'll fall through to the generic default text.
- `routing.json` is a flat file read on every request (no caching) — fine
  at team scale, intentionally simple to hand-edit.
