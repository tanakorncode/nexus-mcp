---
name: write-test-plan
description: Use when planning test coverage for a feature or release before writing individual test cases — e.g. "write a test plan for X", "what needs testing before this ships". One level above write-test-case — scope and approach, not individual steps.
metadata:
  version: "1.0.0"
---

# Write a Test Plan

A test plan decides *what* needs testing and *how thoroughly* before anyone writes individual test cases — skipping straight to `write-test-case` for whatever comes to mind risks covering the obvious paths twice and missing a whole risk area nobody thought to check.

## Document structure

1. **Scope** — what's being tested (which tasks/story/feature), and what's explicitly out of scope for this round (e.g. "not testing the admin panel, unaffected by this change").
2. **Test approach per area** — for each part of the feature, how it'll be verified: manual click-through, automated, both. Not every area needs the same rigor — say which get more.
3. **Environments** — where this gets tested (staging, a specific branch deploy) and any data setup needed before testing can start.
4. **Entry criteria** — what has to be true before testing starts (PR merged to a test branch, migrations run, a feature flag on).
5. **Exit criteria** — what "tested enough" means for this round — not "zero bugs found," but something checkable: all P0/P1 test cases pass, no open blocker bugs.
6. **Risk areas** — the parts most likely to break or matter most if they do (touches money, touches auth, touches data that's hard to undo) — these get extra test cases and extra attention, called out explicitly so it's not left to whoever writes cases later to notice on their own.

## Steps

1. **Base scope on the actual task(s)/story**, not a guess at the feature — `get_task`/`list_story_tasks` for what's really in this round, including sibling tasks (frontend/backend) that all need to be tested together, not just the one task assigned to QA.
2. **Call out risk areas before writing test cases** — this is the step that prevents "we tested everything except the one thing that actually broke in production."
3. **Save as `docs/qa/test-plan-<short-name>.md`**, and `add_task_comment` a pointer on the relevant task(s).
4. **Get eyes on it before testing starts** if the risk areas are non-obvious — a quick check from the dev who built it can catch a blind spot (an edge case the plan missed) before time gets spent testing the wrong things.

## What this skill does not do

Doesn't contain individual test steps — see `write-test-case` for that, one level down. Doesn't decide when to actually run the tests — that's scheduling, this document is the plan for what gets covered when testing happens.
