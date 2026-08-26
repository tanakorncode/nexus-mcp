---
name: write-sprint-plan
description: Use when a PM needs to plan what goes into an upcoming sprint — e.g. "plan the next sprint", "what should we commit to for sprint N". Uses real Nexus data (backlog, velocity, member workload) rather than a guess at capacity.
metadata:
  version: "1.0.0"
---

# Write a Sprint Plan

A sprint plan is a commitment, not a wishlist — it exists so the team and stakeholders both know what "done" for this sprint actually means. Getting it from real data (past velocity, current backlog priority, who's actually available) beats picking a round number of tasks that feels right.

## Steps

1. **Check capacity first, not last.** `list_members` for who's on the team, and ask (or check known leave/other commitments) who's actually available this sprint — planning against nominal headcount instead of real availability is the single most common way a sprint plan becomes fiction by day 3.
2. **Pull the real backlog**, ordered by priority — `list_stories`/`search_tasks` scoped to the project, not a list from memory. Don't reorder based on what seems urgent in the moment; if priority looks wrong, that's a conversation with the stakeholder, not something to silently fix while planning.
3. **Check for blockers before committing a task to the sprint** — a task with a non-`DONE` `blockedBy` shouldn't go in, the same rule `nexus-pick-up-task` applies when picking up a single task, just checked in bulk here.
4. **State the sprint goal** in one sentence — what this sprint is *for*, not just the list of tasks. A list without a goal makes it hard to tell, mid-sprint, whether a scope change still serves the point of the sprint or should wait for the next one.
5. **Assign `sprintId` on each committed task** via `update_task` (or during creation, if planning and creating happen together) — a sprint plan that lives only in a doc and never gets reflected in Nexus means every sprint-scoped view in the product shows something different from what was agreed.

## Document structure

1. **Sprint goal** — one sentence.
2. **Committed tasks** — list with owner and story points, grouped by story/epic if that helps read at a glance.
3. **Capacity** — total points committed vs. team's typical velocity (if `reports/velocity` or past sprint stats are available, cite the actual number, not a guess).
4. **Known risks** — anything already visible that could blow up the plan (a dependency on another team, an unresolved design question).

Write it as `docs/pm/sprint-plan-<sprint-number>.md`, and `add_task_comment` a short pointer to it on the sprint's tracking task if one exists.

## What this skill does not do

Doesn't create the tasks themselves if they don't exist yet — that's `nexus-plan-work`, done beforehand; this skill selects from an already-planned backlog, it doesn't invent scope on the spot. Doesn't override priority set by a BA/stakeholder — if the backlog order looks wrong for this sprint, ask before reordering, the same "don't guess" rule the other skills in this set follow.
