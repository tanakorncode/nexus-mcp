---
name: nexus-pick-up-task
description: Use when starting, resuming, or checking status of work tracked as a Nexus task/ticket via the nexus-mcp tools — e.g. the user says "start this task", "what am I working on", "pick up where I left off", "let's do ALPHA-42", or opens a repo to begin a coding session. Hand-off protocol between people and repos coordinating through the Nexus PM system specifically.
metadata:
  version: "1.0.0"
---

# Pick Up a Task (nexus-mcp)

> This skill is written specifically for teams using **nexus-mcp / Nexus PM** — the tool names below (`get_current_task`, `list_story_tasks`, etc.) only exist if that's what's connected. A team using Jira/ClickUp/Linear/anything else needs its own equivalent skill with that tool's actual MCP tool names — same overall shape, different tool calls in steps 1, 2, 3, and 10. Don't try to make one skill cover every PM tool by guessing at generic names; write a new skill per integration instead, the same way `frameworks/` has one file per stack.

Framework-agnostic *within* nexus-mcp projects — applies the same way whether this repo is NestJS, Next.js, Nuxt, or Vue. Stack-specific conventions live in this repo's own `CLAUDE.md`, not here.

## Steps

1. **Find the task.** If the user named one, use `get_task_by_key` or `get_task`. Otherwise try `get_current_task` (resolves from the current git branch name, e.g. `feature/ALPHA-42-...`) — if that fails, call `get_current_repository` first: if it resolves (this repo is registered as a `GitRepository` in Nexus), pass its `id` as `repositoryId` to `list_my_tasks` so it only returns tasks scoped to *this* repo, not every task assigned to you across the whole project. If `get_current_repository` comes back "not registered" (a normal state, not an error), fall back to an unscoped `list_my_tasks` call — there's no repo-level signal to narrow by. Either way, if more than one task comes back, ask the user which one; don't guess and don't work through the list unprompted. If the user describes a task by what it's about rather than a key ("that thing about the login bug"), use `search_tasks` instead of guessing from `list_my_tasks`.

2. **Tag this task with your repo, if it isn't tagged already.** Call `get_current_repository` (skip if step 1 already called it and it resolved). If it resolves to a registered `GitRepository` and the task's own `repository` field is null or doesn't match, call `update_task(taskId, { repositoryId })` right away, before anything else. This is what lets Nexus-driven automation (a webhook, Agent App, or any other event-based trigger) route this task's *future* status changes and comments back to this exact folder — skip it, and every subsequent event on this task falls back to a project-wide, repo-less routing rule that may land somewhere else entirely, or nowhere. This matters most for a task that started life with no repo set (e.g. planned by a PM/BA under a story spanning multiple repos, picked up here for the first time) — don't skip it just because no one's prompt happened to mention it; it belongs in every pickup, not just the ones someone remembered to spell out.

3. **Read the full context, not just the title.** Task descriptions are intentionally short (matches how a human dev would get a ticket). Check `task.embeds` for unfurled links (Figma files, docs) and `task.attachments` for uploaded files (screenshots, mockups) — both come back directly on the task object from `get_task`/`get_current_task`, nothing extra to fetch. Call `list_task_comments` too — a previous person's hand-off notes (left via step 6/10 below, by them or a prior agent) live there, not on the task fields. If the task has prior code activity, `list_task_git_activity` shows linked commits/MRs from GitLab — useful for resuming work someone else started. Check `list_task_assignees` for reviewers beyond the primary assignee — worth knowing who else is on this task before you start. If it's part of a multi-repo feature, call `list_story_tasks` to see sibling tasks in the same story — e.g. what the backend actually implemented (including any URL/how-to-run notes left in *their* task's comments, if there's no shared filesystem between repos), if this is the frontend half.

4. **Check `blockedBy`.** If the task detail shows a non-null `blockedBy` and that task isn't `DONE`, stop and say so — don't start work that's blocked, and don't assume it's fine to proceed anyway.

5. **Match this repo's own conventions.** Read this repo's `CLAUDE.md` before writing code — that's where the stack-specific rules live (folder structure, error handling, test conventions, etc.), not in this skill.

6. **When genuinely ambiguous after 3–5** (no Figma/attachment, no comparable existing pattern in the repo) — stop and ask, don't guess and ship. If someone's actively running this session, ask in chat. If not (a scheduled/unattended run, or the answer needs to persist for whoever picks this up next), use `add_task_comment` instead — it's the durable option that survives past this session, chat isn't.

7. **Implement, following this repo's git conventions** (see the imported team conventions in this repo's `CLAUDE.md` for the commit format).

8. **Verify before calling anything done.** Run this repo's actual test/lint/build commands (per its `CLAUDE.md` or `package.json` scripts) — don't skip this because it feels like it should pass. A change that compiles isn't the same as a change that was checked.

9. **Open a PR/MR — never push directly to a protected branch (`main`/`develop`/whatever this repo protects).** This is the review checkpoint: a human looks at the diff before it lands, regardless of how confident the implementation felt. Don't merge it yourself even if you technically could.

10. **Hand off — status, and reassignment if the next step belongs to someone else.** Once the PR is open, or once your part is done and someone else needs to act next, two things move together, not just one:
   - `update_task_status` with the status name that matches what's actually true (check `list_statuses` — not always "Done", could be "In Review", "Ready for QA", "Ready for FE"). This is the signal the next person or agent watches for — it's the only thing that crosses machines/accounts, so get it right rather than leaving it stale.
   - If ownership itself needs to move — not just "someone should look at this," but "this is now theirs to act on" — reassign the primary `assigneeId` to them (`update_task(taskId, { assigneeId })`). This only works on a task you're *currently* the assignee on: most roles can only hand off work they hold, not reassign someone else's task. A 403 here is that boundary, not a bug — ask a PM/ADMIN to do the reassignment instead of retrying.
   - **Testing this and it failed?** Don't just comment and stop — a comment nobody's task list surfaces silently stalls. Leave a comment describing exactly what failed and how to reproduce it, attach evidence with `add_task_attachment` if a screenshot/log file exists locally, move the status back to whatever this project calls "needs rework" (check `list_statuses`), and reassign back to whoever implemented it, the same way as above.
   - If there's context the status change alone doesn't carry (why an approach was chosen, a caveat for whoever picks this up), leave it as a comment via `add_task_comment` too — status is a signal, not a place for detail.

## What this skill does not do

Doesn't decide what "done" means for this specific repo beyond "tested, PR open, status updated" — deploy/release process is that repo's own concern. Doesn't invent UI/API details that aren't in the task, an attachment, or the existing codebase — see step 6. Doesn't merge PRs or push to protected branches — see step 9. Doesn't reassign a task the current role doesn't own — see step 10; that's a real permission boundary, not something to work around.
