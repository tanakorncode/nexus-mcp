---
name: write-api-contract
description: Use when an endpoint/payload changes and another repo or team depends on it — e.g. "document the API for X", "what's the contract for this endpoint", a backend task whose frontend counterpart task exists in the same story. Closes the exact gap nexus-pick-up-task flags — "share the contract via a task comment, not just chat."
metadata:
  version: "1.0.0"
---

# Write an API Contract

`nexus-pick-up-task` already says to share a changed contract with the sibling task via `add_task_comment` rather than leaving it in chat — this skill is what actually goes in that comment (or attached doc), so the other side doesn't have to read a diff to figure out what changed.

## Document structure

For each endpoint touched:

```
METHOD /path/to/endpoint

Request:
{
  "field": "type — required/optional, constraints if any"
}

Response (200):
{
  "field": "type"
}

Errors:
- 400 <when this happens>
- 404 <when this happens>
- <any other non-obvious status this endpoint returns>
```

Real example values beat abstract type names where it helps — `"status": "PENDING" | "APPROVED" | "REJECTED"` tells the consumer more than `"status": "string"` does.

## Steps

1. **Write it as soon as the shape is decided** — ideally before the frontend/consumer side starts, not after, so `nexus-pick-up-task`'s point about sharing the contract "the moment API changes" actually means something. A contract shared after the consumer already guessed and built against the wrong shape just creates rework.
2. **Include only what changed**, not the whole API surface, unless this is the first version of a new endpoint — a contract update buried in a restatement of ten unrelated endpoints won't get read carefully.
3. **Post it via `add_task_comment`** on both the task that changed it and the sibling task(s) in the same story (`list_story_tasks` to find them) — this is the exact mechanism `nexus-pick-up-task` step 2 relies on ("a previous person's hand-off notes... live there, not on the task fields").
4. **If the contract is large or this is a new service**, also save it as `docs/dev/api-<service-name>.md` and comment a pointer, rather than a comment.

## What this skill does not do

Doesn't replace a design doc for the *approach* behind the API — see `write-tech-design-doc` for that, this skill only documents the resulting shape once decided. Doesn't cover internal function signatures or anything not crossing a repo/service boundary — if nothing outside this codebase depends on it, a code comment is enough, this level of ceremony isn't needed.
