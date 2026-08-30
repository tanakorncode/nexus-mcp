---
name: write-tech-design-doc
description: Use before implementing a task complex enough that the approach itself needs sign-off first — e.g. "write a design doc for X", a task that touches multiple services, changes a data model, or has more than one reasonable implementation approach. Not for routine tasks — most tasks should just go straight to nexus-pick-up-task and implementation.
metadata:
  version: "1.0.0"
---

# Write a Technical Design Doc

Most tasks don't need this — `nexus-pick-up-task` covers picking up a task and going straight to implementation, and that's the right path for anything routine. Write a design doc specifically when getting the *approach* wrong would be expensive to discover after the code's written: a new data model, a change that crosses service boundaries, a task where two people on the team would reasonably propose different approaches.

## Document structure

1. **Problem** — what the task actually requires, in your own words (not a copy of the task description — if you can't restate it, you don't understand it well enough to design for it yet).
2. **Approach considered** — at minimum two, even if one is "do nothing" or "the obvious naive approach." Writing down the alternative you didn't pick, and why, is what makes this reviewable — a doc with only one approach isn't a design decision, it's a plan already made that's asking for a rubber stamp.
3. **Chosen approach** — the actual design: data model changes, API surface, sequence of what happens. Concrete enough that another dev could implement from this without asking you follow-up questions about the approach (implementation-level questions are fine, approach-level ones mean the doc isn't done).
4. **Tradeoffs** — what the chosen approach costs (performance, complexity, a migration needed, a constraint it locks in) — not just what it gains. A design doc that only lists upsides didn't do the job.
5. **Rollout/rollback** — how this ships safely, and what happens if it needs to be undone. Skip this section only for something with genuinely no blast radius (a new isolated endpoint, say) — for anything touching existing behavior, this is often the part that catches a real problem before it's live.

## Steps

1. **Write it before starting implementation**, not alongside or after — the entire point is catching a wrong approach while it's still just a document.
2. **Get it reviewed by at least one other person** before treating the approach as settled — `add_task_comment` the doc (or a link to it) on the task, and ask explicitly for a look, don't assume silence means agreement.
3. **Save as `docs/dev/design-<short-name>.md`** in the repo — this is exactly the kind of artifact `nexus-pick-up-task` expects a later reader to find via `list_task_comments`/`list_task_git_activity`, so link it from the task, don't leave it to be found by accident.
4. **If the approach changes during implementation**, update the doc — a design doc that's already wrong by the time the PR opens is worse than not having written one, because it looks authoritative.

## What this skill does not do

Doesn't replace an ADR for a decision that affects the whole codebase's architecture going forward (a new framework, a cross-cutting pattern) — that's a bigger, rarer conversation than most tasks need; this skill is scoped to one task's approach. Doesn't cover the API surface between services in the detail a consumer needs to build against — see `write-api-contract` for that, once the design here settles what the contract should be.
