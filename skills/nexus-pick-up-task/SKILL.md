---
name: nexus-pick-up-task
description: Use when starting, resuming, or checking status of work tracked as a Nexus task/ticket via the nexus-mcp tools — e.g. the user says "start this task", "what am I working on", "pick up where I left off", "let's do ALPHA-42", or opens a repo to begin a coding session. Hand-off protocol between people and repos coordinating through the Nexus PM system specifically.
metadata:
  version: "1.0.0"
---

# Pick Up a Task (nexus-mcp)

> This skill is written specifically for teams using **nexus-mcp / Nexus PM** — the tool names below (`get_current_task`, `list_story_tasks`, etc.) only exist if that's what's connected. A team using Jira/ClickUp/Linear/anything else needs its own equivalent skill with that tool's actual MCP tool names — same 7-step shape, different tool calls in steps 1, 2, and 7. Don't try to make one skill cover every PM tool by guessing at generic names; write a new skill per integration instead, the same way `frameworks/` has one file per stack.

Framework-agnostic *within* nexus-mcp projects — applies the same way whether this repo is NestJS, Next.js, Nuxt, or Vue. Stack-specific conventions live in this repo's own `CLAUDE.md`, not here.

## Steps

1. **Find the task.** If the user named one, use `get_task_by_key` or `get_task`. Otherwise try `get_current_task` (resolves from the current git branch name, e.g. `feature/ALPHA-42-...`) — if that fails, fall back to `list_my_tasks` (auto-detects the project via `get_current_project`, which tries the repo's registered `GitRepository` first, then the branch's task-key prefix) and ask the user which one. If the user describes a task by what it's about rather than a key ("that thing about the login bug"), use `search_tasks` instead of guessing from `list_my_tasks`.

2. **Read the full context, not just the title.** Task descriptions are intentionally short (matches how a human dev would get a ticket). Check `task.embeds` for unfurled links (Figma files, docs) and `task.attachments` for uploaded files (screenshots, mockups) — both come back directly on the task object from `get_task`/`get_current_task`, nothing extra to fetch. Call `list_task_comments` too — a previous person's hand-off notes (left via step 5/9 below, by them or a prior agent) live there, not on the task fields. If the task has prior code activity, `list_task_git_activity` shows linked commits/MRs from GitLab — useful for resuming work someone else started. Check `list_task_assignees` for reviewers beyond the primary assignee — worth knowing who else is on this task before you start. If it's part of a multi-repo feature, call `list_story_tasks` to see sibling tasks in the same story — e.g. what the backend actually implemented, if this is the frontend half.

3. **Check `blockedBy`.** If the task detail shows a non-null `blockedBy` and that task isn't `DONE`, stop and say so — don't start work that's blocked, and don't assume it's fine to proceed anyway.

4. **Match this repo's own conventions.** Read this repo's `CLAUDE.md` before writing code — that's where the stack-specific rules live (folder structure, error handling, test conventions, etc.), not in this skill.

5. **When genuinely ambiguous after 2–4** (no Figma/attachment, no comparable existing pattern in the repo) — stop and ask, don't guess and ship. If someone's actively running this session, ask in chat. If not (a scheduled/unattended run, or the answer needs to persist for whoever picks this up next), use `add_task_comment` instead — it's the durable option that survives past this session, chat isn't.

6. **Implement, following this repo's git conventions** (see the imported team conventions in this repo's `CLAUDE.md` for the commit format).

7. **Verify before calling anything done.** Run this repo's actual test/lint/build commands (per its `CLAUDE.md` or `package.json` scripts) — don't skip this because it feels like it should pass. A change that compiles isn't the same as a change that was checked.

8. **Open a PR/MR — never push directly to a protected branch (`main`/`develop`/whatever this repo protects).** This is the review checkpoint: a human looks at the diff before it lands, regardless of how confident the implementation felt. Don't merge it yourself even if you technically could.

9. **Hand off — status, and reassignment if the next step belongs to someone else.** Once the PR is open, or once your part is done and someone else needs to act next, two things move together, not just one:
   - `update_task_status` with the status name that matches what's actually true (check `list_statuses` — not always "Done", could be "In Review", "Ready for QA", "Ready for FE"). This is the signal the next person or agent watches for — it's the only thing that crosses machines/accounts, so get it right rather than leaving it stale.
   - If ownership itself needs to move — not just "someone should look at this," but "this is now theirs to act on" — reassign the primary `assigneeId` to them (`update_task(taskId, { assigneeId })`). This only works on a task you're *currently* the assignee on: most roles can only hand off work they hold, not reassign someone else's task. A 403 here is that boundary, not a bug — ask a PM/ADMIN to do the reassignment instead of retrying.
   - **Testing this and it failed?** Don't just comment and stop — a comment nobody's task list surfaces silently stalls. Leave a comment describing exactly what failed and how to reproduce it, attach evidence with `add_task_attachment` if a screenshot/log file exists locally, move the status back to whatever this project calls "needs rework" (check `list_statuses`), and reassign back to whoever implemented it, the same way as above.
   - If there's context the status change alone doesn't carry (why an approach was chosen, a caveat for whoever picks this up), leave it as a comment via `add_task_comment` too — status is a signal, not a place for detail.

## What this skill does not do

Doesn't decide what "done" means for this specific repo beyond "tested, PR open, status updated" — deploy/release process is that repo's own concern. Doesn't invent UI/API details that aren't in the task, an attachment, or the existing codebase — see step 5. Doesn't merge PRs or push to protected branches — see step 8. Doesn't reassign a task the current role doesn't own — see step 9; that's a real permission boundary, not something to work around.
