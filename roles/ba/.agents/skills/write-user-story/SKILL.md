---
name: write-user-story
description: Use when writing the actual content of a task's description/acceptance criteria before create_task — e.g. "write the user story for X", "what should the AC be for this task". Content-quality companion to nexus-plan-work, which handles the field-by-field creation process but doesn't tell you how to write good description text.
metadata:
  version: "1.0.0"
---

# Write a User Story + Acceptance Criteria

`nexus-plan-work` tells you *that* a task needs a `description` and to ask the planner for acceptance criteria — this skill is about what to actually put in that field so `nexus-pick-up-task` on the other end doesn't have to guess or come back and ask.

## Format

**Story**: `As a <role>, I want <capability>, so that <benefit>.`

The `<role>` is a real person type (a specific user segment, an admin, an external caller of an API) — not "the user" as a placeholder that could mean anyone. The `<benefit>` is the actual reason, not a restatement of the capability ("so that I can log in" is not a benefit, it's the same sentence again — the benefit is *why* logging in matters here: "so that my saved progress carries over").

**Acceptance criteria** — Given/When/Then, one per distinct behavior:

```
Given <the starting state>
When <the action happens>
Then <the observable result>
```

Write enough of these to cover the happy path **and** the edge cases that would actually get asked about in review — an empty input, a duplicate, a permission boundary, the failure case. Don't write AC for every theoretically possible input; write the ones that would change what gets built if left unstated.

## Steps

1. **Confirm the role and benefit with the person**, don't invent them — a story with a guessed benefit steers the builder toward the wrong tradeoff when two implementations both satisfy the literal capability but only one serves the real reason.
2. **List the edge cases out loud before writing AC for them** — "what happens if X is empty," "what happens if this runs twice" — and ask the person which ones actually matter for this task rather than writing AC for every case that occurs to you.
3. **Put the finished story + AC directly in the task's `description` field** when running `nexus-plan-work`'s create step — this skill produces the *content*, `nexus-plan-work` handles the *tool call* and the rest of the field checklist (repositoryId, assignee, etc.).
4. **Reference the BRD** (if one exists for this epic — see `write-brd`) rather than repeating its context — a task description that re-explains the whole business case is noise for whoever's picking up the ticket to do the actual work.

## What this skill does not do

Doesn't call `create_task` or manage the other fields (`repositoryId`, `sprintId`, `priority`, ...) — that's `nexus-plan-work`'s job; this skill only produces the `description` text that goes into it. Doesn't write BA-level UAT scenarios — see `write-uat-scenario` for the "does this satisfy the business need" checklist, separate from AC (which is closer to what the builder needs to know while implementing).
