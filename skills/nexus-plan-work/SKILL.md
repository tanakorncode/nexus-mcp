---
name: nexus-plan-work
description: Use when breaking down a feature into epics/stories/tasks in Nexus via nexus-mcp — e.g. the user (PM/BA/Team Lead) says "create a task for X", "break this feature down", "set up the backend and frontend tasks for Y", or asks to plan work that will later be picked up via nexus-pick-up-task. The authoring counterpart to nexus-pick-up-task — this skill is about creating well-formed work, that one is about consuming it.
metadata:
  version: "1.0.0"
---

# Plan Work (nexus-mcp)

> Written for teams using **nexus-mcp / Nexus PM**, same caveat as `nexus-pick-up-task` — tool names below only exist if that's what's connected. Read that skill too; this one exists because a task that's under-specified at creation time is unrecoverable later — `nexus-pick-up-task` can't invent structure that was never set.

## Why this matters

Everything `nexus-pick-up-task` relies on to find "the right task" and "what it's blocked on" is set **once, at creation time, by whoever plans the work** — not inferred automatically. A task created without a `repositoryId` is invisible to repo-scoped queries forever, not just until someone notices. Fix it at the source.

## Steps

1. **Find or confirm the epic.** `list_epics` for the project. Epics are usually pre-planned (quarters/major initiatives) by a lead, and creating one is a bigger commitment than a task or story — don't `create_epic` reflexively just because none fits perfectly. Check with the person before creating a new epic rather than assuming; if they confirm, `create_epic` (name required, everything else optional — `code` auto-generates in the product's own format if omitted).

2. **Decide if this feature spans multiple repos.** If yes (e.g. "add a registration page" = frontend UI + backend API), it needs **one story with one task per repo underneath it** — that's the whole mechanism `list_story_tasks` depends on later. Check `list_stories` on the epic first; don't create a duplicate story for a feature that already has one. If none exists, `create_story`.

   If it's genuinely single-repo work, skip the story — not everything needs one.

3. **Gather every field for each task before creating it — ask, don't skip silently.** For each field below not already given by the person or obvious from context, ask them explicitly whether to set it or skip it. Never just omit one because it's easier — an unset field should be a decision the planner made, not something that fell through because nobody asked.
   - `repositoryId` — **the single most important field, and the one most likely to get skipped.** Use `get_current_repository` (if sitting in that repo) or check the project's registered repos otherwise. A task with no `repositoryId` won't show up when someone scopes a query to "tasks for this repo."
   - `storyId` — the story from step 2, if there is one.
   - `blockedById` — does this task genuinely have to wait on another? Nothing infers this later.
   - `assigneeId` — check `list_members` if the person names someone; ask if it's genuinely undecided yet rather than defaulting to unassigned without asking.
   - `labelIds` — `list_labels` first; if the right one doesn't exist, ask whether to `create_label` or skip labeling. Don't invent a label name without confirming it with the person.
   - `description` — enough for someone (or an agent) who wasn't in the planning conversation to act on. A one-line title is not enough; a full spec is overkill. Aim for what you'd tell a competent teammate in a ticket — the shape of the change and any acceptance criteria, not implementation detail.
   - `priority` — don't leave everything at the default; if it's not urgent, it shouldn't look urgent.

4. **Show the complete field set and get explicit confirmation before calling `create_task`.** Once every field above has been decided (set to a value, or explicitly skipped), summarize what's about to be created — name, epic, story, repository, blocked-by, assignee, labels, priority, status — and wait for the person to confirm before making the call. This is the checkpoint that catches a wrong epic or a typo'd description before it's real, the same way `nexus-pick-up-task` stops at a PR instead of merging — a mistake here is cheap to fix before creation, expensive to notice after.

   To change something on an already-created task, use `update_task` (`storyId`/`repositoryId`/`blockedById`/`assigneeId`/`labelIds` — `labelIds` is a full replace, pass the complete set you want, not just what's being added).

5. **Attach reference material through the web UI, not here.** Figma links and screenshots (`embeds`/`attachments`) are readable through nexus-mcp (`get_task` returns them) but not writable — there's no `create_embed`/`upload_attachment` tool yet. If a task needs visual reference, attach it in the product UI after creating the task via this skill, or create the task in the UI directly if the reference material is the main point.

6. **Pick a real starting status**, not whatever the default happens to be if that's wrong — check `list_statuses` for what this project actually uses.

## What this skill does not do

Doesn't attach files/links (step 5) — that stays web-UI-only for now. Doesn't create an epic without the person explicitly confirming it first (step 1) — epics are a bigger, less frequent commitment than a task. Doesn't guess at any field the planner doesn't actually know — leaving a field unset after asking is honest; guessing wrong is worse, because it'll silently mismatch later instead of visibly failing now. And it never calls `create_task` without the person confirming the full field set first (step 4).
