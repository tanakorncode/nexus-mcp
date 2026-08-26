# Team Workflow

Rules specific to **team mode** (more than one person/agent working on this repo at once) — on top of, not instead of, the general standards in [.agents/AGENTS.md](.agents/AGENTS.md). A solo repo doesn't need any of this.

## 1. Task tracking — Nexus is the source of truth

Every role uses Nexus (MCP) through its skill, never a file in this repo, for who's doing what:

- **pm / ba** call `nexus-plan-work` when breaking work into epic/story/task
- **dev / qa** call `nexus-pick-up-task` when starting work or checking what's pending

If this repo also keeps a `tasks.md` snapshot, treat it as read-only reference, never the place to assign or pick up work — a single shared file is a merge-conflict machine the moment two people edit it at once, and it can silently drift out of sync with what Nexus actually says.

## 2. One branch per person/feature

- Never commit directly to `main`/`master` (or whatever this repo protects).
- Branch naming: `<type>/<nexus-task-key>-<short-desc>` — e.g. `feat/ALPHA-42-add-search`. The task key makes it trivial to find which Nexus task a branch belongs to later.
- Running more than one Claude Code session on this repo at once (multiple roles in parallel)? Use a separate [git worktree](https://code.claude.com/docs/en/worktrees) per branch — sharing one working tree across sessions means their file edits collide.

## 3. Pull Request, never a direct commit

- Commit on the feature branch (Conventional Commits format), push, open a PR — `dev`'s own hand-off step already covers this (see `roles/dev/.agents/agents/dev.md`).
- Never merge your own PR — wait for a reviewer's approval, every time, no exceptions for "this one's small."
- Once merged, update the task's status in Nexus — a merged PR nobody reflected in Nexus looks unfinished to anyone checking task state.

## 4. Share API contracts through a Nexus comment, not just chat

- When `dev` changes an endpoint/payload/response, `add_task_comment` the contract on their own task, then `list_story_tasks` to find the sibling task (e.g. the frontend half of the same story) and post the same comment there too.
- The other side sees it the moment they run `nexus-pick-up-task` (via `list_task_comments`) — no need to ask in chat or wait for someone to remember to mention it.
- If this repo's git host doesn't auto-link activity into Nexus (`list_task_git_activity` only works with a GitLab webhook configured) — also put the contract in the PR description (`## API Contract`) as a second channel for reviewers who won't see the Nexus comment.

## 5. Personal config stays out of git

Anything that varies by person or machine (which terminal multiplexer you use with Claude Code's teammate mode, a local port override, ...) goes in `.claude/settings.local.json` — **not** committed (should already be in this repo's `.gitignore`). Team-shared settings (env vars, hooks everyone should run) go in the real `.claude/settings.json`, which *is* committed.

First time cloning this repo? Create your own `.claude/settings.local.json` — see `team-setup/settings.local.json.example` in `claude-templates` for the shape.
