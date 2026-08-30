---
name: nexus-plan-work
description: Use when breaking down a feature into epics/stories/tasks in Nexus via nexus-mcp — e.g. the user (PM/BA/Team Lead) says "create a task for X", "break this feature down", "set up the backend and frontend tasks for Y", or asks to plan work that will later be picked up via nexus-pick-up-task. The authoring counterpart to nexus-pick-up-task — this skill is about creating well-formed work, that one is about consuming it.
metadata:
  version: "1.0.0"
---

# Plan Work (nexus-mcp)

> Written for teams using **nexus-mcp / Nexus PM**, same caveat as `nexus-pick-up-task` — tool names below only exist if that's what's connected. Read that skill too; this one exists because a task that's under-specified at creation time is unrecoverable later — `nexus-pick-up-task` can't invent structure that was never set.

## Who this is for

`create_task` is role-gated server-side (ADMIN/PM/BA can; DEV/QA/MEMBER/VIEWER can't) — this isn't a convention to follow, it's enforced. If `create_task` comes back `403 FORBIDDEN`, that's the acting person's role, not a bug to route around: say so plainly and suggest they ask a PM/BA/ADMIN to create it (or run this skill themselves), rather than retrying or trying `update_task` on some other task as a workaround.

## Why this matters

Everything `nexus-pick-up-task` relies on to find "the right task" and "what it's blocked on" is set **once, at creation time, by whoever plans the work** — not inferred automatically. A task created without a `repositoryId` is invisible to repo-scoped queries forever, not just until someone notices. Fix it at the source.

## Steps

1. **Resolve which project first if it's not obvious.** `list_epics`/`create_task`/etc. all accept an explicit `projectId`, and will *try* to auto-detect one from the current repo if it's omitted — but that only works when the session is sitting in a repo linked to exactly one project. A PM or Team Lead planning across several projects usually isn't sitting in any particular project's repo at all, so auto-detect has nothing to go on and either fails outright or guesses the wrong one silently.

   Don't rely on auto-detect here. If the person named the project, confirm it — call `list_projects` and match by name (ask if more than one is close). If they didn't name it and there's no unambiguous repo context, ask which project before doing anything else. Every tool call for the rest of this skill should carry that resolved `projectId` explicitly rather than leaving it to auto-detect.

2. **Find or confirm the epic.** `list_epics` for the project. Epics are usually pre-planned (quarters/major initiatives) by a lead, and creating one is a bigger commitment than a task or story — don't `create_epic` reflexively just because none fits perfectly. Check with the person before creating a new epic rather than assuming; if they confirm, `create_epic` (name required, everything else optional — `code` auto-generates in the product's own format if omitted).

3. **Decide if this feature spans multiple repos.** If yes (e.g. "add a registration page" = frontend UI + backend API), it needs **one story with one task per repo underneath it** — that's the whole mechanism `list_story_tasks` depends on later. Check `list_stories` on the epic first; don't create a duplicate story for a feature that already has one. If none exists, `create_story`.

   If it's genuinely single-repo work, skip the story — not everything needs one.

4. **Gather every field for each task before creating it — ask, don't skip silently.** For each field below not already given by the person or obvious from context, ask them explicitly whether to set it or skip it. Never just omit one because it's easier — an unset field should be a decision the planner made, not something that fell through because nobody asked.
   - `repositoryId` — **the single most important field, and the one most likely to get skipped.** Use `get_current_repository` (if sitting in that repo) or `list_repositories` for the project otherwise — pick the one matching the repo this task's work actually belongs to, don't guess from the task name alone if more than one repo is plausible. A task with no `repositoryId` won't show up when someone scopes a query to "tasks for this repo." A project with no git repos at all (pure planning/BA work) genuinely has nothing to set here — that's fine, don't force it.
   - `storyId` — the story from step 3, if there is one.
   - `blockedById` — does this task genuinely have to wait on another? Nothing infers this later.
   - `assigneeId` — check `list_members` if the person names someone; ask if it's genuinely undecided yet rather than defaulting to unassigned without asking. This is the single primary assignee only — reviewers are a separate step, see step 6.
   - `labelIds` — `list_labels` first; if the right one doesn't exist, ask whether to `create_label` or skip labeling. Don't invent a label name without confirming it with the person.
   - `description` — enough for someone (or an agent) who wasn't in the planning conversation to act on. A one-line title is not enough; a full spec is overkill. Aim for what you'd tell a competent teammate in a ticket — the shape of the change and any acceptance criteria, not implementation detail.
   - `priority` — don't leave everything at the default; if it's not urgent, it shouldn't look urgent.
   - `sprintId` — check `list_sprints` if this project plans in sprints; ask whether this task belongs in the current/a specific sprint or stays in the backlog. Easy to forget since it's not a required field, but a task left out of every sprint doesn't show up in sprint-scoped planning views.

5. **Show the complete field set and get explicit confirmation before calling `create_task`.** Once every field above has been decided (set to a value, or explicitly skipped), summarize what's about to be created — name, epic, story, repository, blocked-by, assignee, labels, priority, status — and wait for the person to confirm before making the call. This is the checkpoint that catches a wrong epic or a typo'd description before it's real, the same way `nexus-pick-up-task` stops at a PR instead of merging — a mistake here is cheap to fix before creation, expensive to notice after.

   To change something on an already-created task, use `update_task` (`storyId`/`repositoryId`/`blockedById`/`sprintId`/`assigneeId`/`labelIds`/`archived` — `labelIds` is a full replace, pass the complete set you want, not just what's being added). To edit the story itself (name, description, storyPoints) rather than a task under it, use `update_story`.

6. **Add reviewers right after creation, if the person named any.** `create_task`/`update_task` only set the one primary `assigneeId` — reviewers go on separately via `add_task_assignee(taskId, memberId, role: "REVIEWER")`, which needs a real `taskId` and so can only happen after step 5's `create_task` call, never in the same step. Do it immediately after and say you did — don't silently skip it because it's an extra call.

7. **Files can be attached from here now; Figma/doc embeds still can't.** `add_task_attachment(taskId, filePath)` uploads a local file (screenshot, export, doc — 10MB cap) directly — use it if the reference material already exists as a file on this machine. Figma/link embeds are still read-only through nexus-mcp (`get_task` returns `task.embeds`, but there's no `create_embed` tool) — those still need the product UI. If the reference material is the main point of the task, attach it right after `create_task` rather than leaving a "see attached" note with nothing attached.

8. **Pick a real starting status**, not whatever the default happens to be if that's wrong — check `list_statuses` for what this project actually uses.

## What this skill does not do

Doesn't attach Figma/doc embeds (step 7) — those stay web-UI-only; files are fine via `add_task_attachment`. Doesn't create an epic without the person explicitly confirming it first (step 2) — epics are a bigger, less frequent commitment than a task. Doesn't guess at any field the planner doesn't actually know — leaving a field unset after asking is honest; guessing wrong is worse, because it'll silently mismatch later instead of visibly failing now. Doesn't trust auto-detect for which project (step 1) — the wrong-project version of that same guessing problem, and the one most likely to bite a PM/Team Lead working across several projects. And it never calls `create_task` without the person confirming the full field set first (step 5).
