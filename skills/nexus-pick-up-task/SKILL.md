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

1. **Find the task.** If the user named one, use `get_task_by_key` or `get_task`. Otherwise try `get_current_task` (resolves from the current git branch name, e.g. `feature/ALPHA-42-...`) — if that fails, fall back to `list_my_tasks` (auto-detects the project via `get_current_project`, which tries the repo's registered `GitRepository` first, then the branch's task-key prefix) and ask the user which one.

2. **Read the full context, not just the title.** Task descriptions are intentionally short (matches how a human dev would get a ticket). Check `task.embeds` for unfurled links (Figma files, docs) and `task.attachments` for uploaded files (screenshots, mockups) — both come back directly on the task object from `get_task`/`get_current_task`, nothing extra to fetch. If it's part of a multi-repo feature, call `list_story_tasks` to see sibling tasks in the same story — e.g. what the backend actually implemented, if this is the frontend half.

3. **Check `blockedBy`.** If the task detail shows a non-null `blockedBy` and that task isn't `DONE`, stop and say so — don't start work that's blocked, and don't assume it's fine to proceed anyway.

4. **Match this repo's own conventions.** Read this repo's `CLAUDE.md` before writing code — that's where the stack-specific rules live (folder structure, error handling, test conventions, etc.), not in this skill.

5. **When genuinely ambiguous after 2–4** (no Figma/attachment, no comparable existing pattern in the repo) — stop and ask the person, don't guess and ship. There's no way to leave a comment back on the Nexus task yet (not in the public API), so the question goes to whoever is running this session, in chat.

6. **Implement, following this repo's git conventions** (see the imported team conventions in this repo's `CLAUDE.md` for the commit format).

7. **Verify before calling anything done.** Run this repo's actual test/lint/build commands (per its `CLAUDE.md` or `package.json` scripts) — don't skip this because it feels like it should pass. A change that compiles isn't the same as a change that was checked.

8. **Open a PR/MR — never push directly to a protected branch (`main`/`develop`/whatever this repo protects).** This is the review checkpoint: a human looks at the diff before it lands, regardless of how confident the implementation felt. Don't merge it yourself even if you technically could.

9. **Hand off.** Once the PR is open (or once your part is done and the next step belongs to someone else), call `update_task_status` with the status name that matches what's actually true (check `list_statuses` for the exact names this project uses — they're not always "Done", could be "In Review", "Ready for FE", etc.). This status change is the signal the next person or agent watches for — it's the only thing that crosses machines/accounts, so get it right rather than leaving it stale.

## What this skill does not do

Doesn't decide what "done" means for this specific repo beyond "tested, PR open, status updated" — deploy/release process is that repo's own concern. Doesn't invent UI/API details that aren't in the task, an attachment, or the existing codebase — see step 5. Doesn't merge PRs or push to protected branches — see step 8.
