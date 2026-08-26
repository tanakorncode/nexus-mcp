---
name: write-status-report
description: Use for a periodic (weekly/biweekly) progress update to stakeholders — e.g. "write this week's status report", "summarize progress for the client". Pulls real Nexus data rather than a from-memory summary.
metadata:
  version: "1.0.0"
---

# Write a Status Report

A status report is only useful if it's accurate enough that a stakeholder trusts it without double-checking — which means pulling real numbers from Nexus, not summarizing from memory of what felt like it happened this week.

## Document structure

1. **Overall status** — on track / at risk / blocked, stated plainly up front, not buried after three paragraphs of detail. A stakeholder skimming this should get the headline in one line.
2. **Progress since last report** — what actually moved to Done (`list_statuses` + a status-scoped query), not what was worked on — "in progress" isn't progress a stakeholder can act on.
3. **Blocked / at-risk items** — anything with a non-null `blockedBy`, or behind where the sprint plan expected it to be. Name the specific blocker, not "some delays" — a vague blocker can't be helped by anyone reading the report.
4. **Upcoming** — what's planned next, from the current sprint plan (`write-sprint-plan`) if one exists.
5. **Decisions needed** — anything genuinely waiting on the stakeholder, called out explicitly so it doesn't stay stuck by default. A status report that never asks for anything trains people to skim it.

## Steps

1. **Pull real task counts**, not an estimate — `search_tasks`/status-scoped queries for what's actually Done/In Progress/Blocked this period, compared against what the sprint plan committed to.
2. **Don't round risk up to "on track"** to avoid a hard conversation — a status report that's consistently rosier than reality is the fastest way to lose a stakeholder's trust in it, and the next surprise lands harder for having been unflagged.
3. **Keep it short enough to actually get read** — a stakeholder update is not the place for a page of caveats per task; save that detail for the task comments themselves.
4. **Save as `docs/pm/status-<date>.md`** if this needs to be a durable record, or post directly as the update if the audience just needs the current one, not a history.

## What this skill does not do

Doesn't replace `write-sprint-plan` — this reports against a plan that already exists, it doesn't create one. Doesn't editorialize blame for a slipped item — state what's blocked and why, factually; who's responsible is a separate, human conversation if it needs one at all.
