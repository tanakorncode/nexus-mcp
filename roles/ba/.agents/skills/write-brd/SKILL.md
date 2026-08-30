---
name: write-brd
description: Use when a BA needs to capture a business need before it's broken into epics/tasks — e.g. "write a BRD for X", "document the requirement for Y", or a new feature request that hasn't been analyzed yet. Precedes nexus-plan-work — a BRD is the "why" a whole epic exists, not any single task's description.
metadata:
  version: "1.0.0"
---

# Write a Business Requirement Document (BRD)

A BRD answers **why this work exists** — the business problem, who's affected, what success looks like — before anyone decides what epics/stories/tasks it becomes. `nexus-plan-work` assumes that decision is already made; a BRD is the artifact that makes it, or at least gives the planner something real to break down instead of guessing.

Not every task needs one upstream — a one-line bug fix doesn't. Write a BRD when the ask is a new feature, a process change, or anything a stakeholder outside the room would ask "wait, why are we doing this?" about.

## Document structure

1. **Background** — what's happening today, and why it's a problem worth solving now. Cite the actual pain (a metric, a complaint pattern, a compliance deadline) — not "it would be nice to have."
2. **Objective** — the business outcome, stated so it's checkable later ("reduce support tickets about X by half," not "improve the experience").
3. **Scope** — explicitly in scope and explicitly out of scope. The out-of-scope list is the one people skip and the one that prevents scope creep three weeks in — don't skip it.
4. **Stakeholders** — who asked for this, who approves it, who's affected day-to-day. Different people; naming only the requester misses who needs to sign off.
5. **Business rules / constraints** — anything non-negotiable (a regulation, an existing system it must stay compatible with, a hard deadline). This is what later becomes acceptance criteria — capture it here first, don't leave it to be invented at the user-story stage.
6. **Success metrics** — how anyone will know this worked, after it ships. If nobody can name one, that's worth surfacing to the stakeholder before writing further, not papering over.

## Steps

1. **Ask before assuming.** For each section above, if the person hasn't told you and it's not obvious from context, ask — a BRD with a guessed objective is worse than a shorter one with real answers, because the guess reads as confirmed fact to whoever plans off it later.
2. **Write it as a file in the repo**, not just as chat output — `docs/ba/brd-<short-name>.md` by default (create the folder if it doesn't exist). This is a project artifact meant to outlive the conversation, the same reason `nexus-pick-up-task` insists on `add_task_comment` over chat for anything that needs to persist. If `.agents/templates/BRD_Template.docx` exists in this repo and a `docx`-editing skill is available in this session, fill that template in as a real `.docx` instead — a BRD is often the one document that actually goes in front of a stakeholder outside the room, and a real Word file is more usable to them than a markdown export. If neither is available, the `.md` default is fine.
3. **Link it from Nexus** once the epic exists — `add_task_comment` on the epic-level task (or the first task under it) pointing at the file path, so `nexus-pick-up-task` for any task under this epic has a way to find the "why" behind it.
4. **Hand off to planning.** Once confirmed with the stakeholder, this is the input to `nexus-plan-work` — don't create epics/tasks yourself as part of this skill; that's a separate step with its own field-by-field checklist.

## What this skill does not do

Doesn't create epics/stories/tasks — that's `nexus-plan-work`, using this document as input. Doesn't write user stories or acceptance criteria at the task level — see `write-user-story`. Doesn't decide scope unilaterally — every section is something to confirm with the actual stakeholder, not infer from the request alone.
