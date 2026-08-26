# nexus-mcp

MCP server exposing the Nexus/TaskBridge PM system to Claude Code, so agents can read and update tasks directly instead of a human relaying state by hand. Paired with two skills in [`claude-templates`](https://github.com/tanakorncode/claude-templates) — `nexus-plan-work` (for PM/BA/Team Lead, authoring) and `nexus-pick-up-task` (for devs, consuming).

Talks to the PM system's public `/api/v1/*` API — not `nexus-vscode`'s internal endpoints, which are reserved for the official extensions. See `DEVLOG.md` for why, and for the full build history.

## Setup (one time, per person)

**Option A — plugin (recommended).** This repo is itself a Claude Code plugin — one install registers the MCP server *and* both skills (`nexus-pick-up-task`, `nexus-plan-work`) together, no `.mcp.json` or `git clone` of `claude-templates` needed.

**1. Log in** — opens your browser to sign in (same pattern as `gh auth login`/`claude login`), then stores the tokens in your OS keychain (`@napi-rs/keyring` — never in a file):

```bash
npx -y -p github:tanakorncode/nexus-mcp nexus-mcp-login
```

No account/email typing needed — identity comes back from the login itself. `NEXUS_API_URL` defaults to production; only set it if you're pointing at a different instance (e.g. local dev).

<details>
<summary>Browser can't reach this machine, or a headless box? Use the old PAT flow instead</summary>

```bash
export NEXUS_API_URL=http://27.254.62.17:8090
npx -y -p github:tanakorncode/nexus-mcp nexus-mcp-login --manual
```

Walks you through `$NEXUS_API_URL/developer` → create an app → grant scopes `tasks:read tasks:write projects:read members:read sprints:read` → generate a token — then prompts you to paste that token plus your account email.

</details>

**2. Install the plugin** (two commands — the first registers this repo as a plugin source, the second actually installs it):

```bash
claude plugin marketplace add tanakorncode/nexus-mcp
claude plugin install nexus-mcp@nexus-mcp-marketplace
```

**3. Reload Claude Code** (new window / restart the session) — required, the running session doesn't pick up a newly-installed plugin on its own. First connection is slower (`npx` fetches + builds fresh); cached after that. Approve the one-time trust prompt.

**4. Verify** — ask Claude to call `whoami`. If it resolves your name, and both skills show up in `/skills`, all done.

<details>
<summary>Option B — manual (same result, more steps — useful if <code>claude plugin install</code> isn't available on your version)</summary>

**1. Log in** — same as Option A above (`nexus-mcp-login`, or `--manual` for the PAT flow).

**2. Register with Claude Code** — pick one (not both needed, but they can coexist):

- **For yourself, every repo, one time** (needs the `claude` CLI — `npm install -g @anthropic-ai/claude-code` first):

  ```bash
  claude mcp add nexus-mcp -s user -e NEXUS_API_URL=http://27.254.62.17:8090 -- npx -y github:tanakorncode/nexus-mcp
  ```

  No `.mcp.json` needed anywhere after this.

- **Or**, if a repo you're opening already has `.mcp.json` committed at its root (e.g. `pea-thailand-backoffice-be`) — nothing to do, Claude Code picks it up on its own when you open that repo. Only relevant if you *didn't* do the step above.

**3. Reload Claude Code**, then **4. Verify** — same as Option A.

**Install the skills too** (once per person — see `claude-templates/README.md` for details):

```bash
mkdir -p ~/.claude/skills
git clone --depth 1 https://github.com/tanakorncode/claude-templates /tmp/claude-templates
cp -r /tmp/claude-templates/skills/nexus-pick-up-task ~/.claude/skills/
cp -r /tmp/claude-templates/skills/nexus-plan-work ~/.claude/skills/
```

</details>

### Switching accounts

Run `nexus-mcp-login` again — it always overwrites whatever was stored before, no need to log out first. One gotcha specific to the browser flow: if you're still signed into pm-system *in your browser* as the old account, the login page won't prompt you again — it'll just hand back a code for that same old account. Sign out of pm-system in the browser first (or use a private/incognito window) if you're actually switching who you are, not just refreshing the current login.

### Developing on nexus-mcp itself

If you're changing this repo's own code, not just using it, clone it instead so edits take effect without re-publishing:

```bash
git clone https://github.com/tanakorncode/nexus-mcp
cd nexus-mcp
npm install
npm run build
npm link          # makes the `nexus-mcp` command available anywhere on this machine
```

Point `.mcp.json` at `"command": "nexus-mcp"` (no `args`) instead of the `npx` form while iterating — rebuild (`npm run build`) and reload the Claude Code window to pick up changes; the MCP server process holds old code in memory otherwise.

## Editor support

Login (`nexus-mcp-login`) is the same regardless of editor — it's a standalone CLI step, not tied to Claude Code. What differs is where each editor looks for MCP server and skill config.

| | Claude Code | Antigravity IDE |
|---|---|---|
| MCP server | Plugin (`claude plugin install ...`, see Setup above) or `.mcp.json` | `~/.gemini/config/mcp_config.json` (global) or `.agents/mcp_config.json` (workspace) |
| Skills | Bundled in the plugin, or `~/.claude/skills/` | `.agents/skills/<name>/` (workspace) or `~/.gemini/antigravity/skills/<name>/` (global) |

**Antigravity setup** — no plugin system there, so it's two manual steps instead of one:

1. **MCP server** — add to `~/.gemini/config/mcp_config.json` or `.agents/mcp_config.json`:

   ```json
   {
     "mcpServers": {
       "nexus-mcp": {
         "command": "npx",
         "args": ["-y", "github:tanakorncode/nexus-mcp"],
         "env": {
           "NEXUS_API_URL": "http://27.254.62.17:8090"
         }
       }
     }
   }
   ```

   (Same `mcpServers` shape as Claude Code's `.mcp.json` — Antigravity's UI equivalent: `...` in the agent panel → MCP Servers → Manage MCP Servers → View raw config.)

2. **Skills** — `SKILL.md` is the same standard both editors read, so the files need no changes, just copying into Antigravity's own skills directory:

   ```bash
   mkdir -p .agents/skills
   git clone --depth 1 https://github.com/tanakorncode/claude-templates /tmp/claude-templates
   cp -r /tmp/claude-templates/skills/nexus-pick-up-task .agents/skills/
   cp -r /tmp/claude-templates/skills/nexus-plan-work .agents/skills/
   ```

A person switching between the two editors on the same machine can keep both configs side by side — they don't conflict, and the OS keychain login is shared (one `nexus-mcp-login` covers both).

## The two skills, and when each applies

- **`nexus-plan-work`** — breaking a feature into epic/story/task. Use before work exists. The discipline that matters here: one story per feature that spans repos, one task per repo underneath it, `repositoryId` set on every task (the single most-skipped field, and the one that's unrecoverable later if missed).
- **`nexus-pick-up-task`** — finding, understanding, and executing a task, ending in a PR and a status update. Use once work exists and someone (human or a scheduled check) is ready to act on it.

Read the skill files themselves for the full step-by-step — this README won't duplicate them.

## Tools

**Identity & discovery**
| Tool | Purpose |
|---|---|
| `whoami` | Resolve the configured member (matched by email — there's no `/me` endpoint) |
| `list_projects` | Projects you're a member of |
| `get_current_project` | Auto-detect the project for the current repo — tries git-remote → registered `GitRepository` first, falls back to the branch's task-key prefix |
| `get_current_repository` | Match the current repo against Nexus's registered repos. Returns "not registered" (not an error) if nobody's added this repo in Project Settings yet |

**Reading tasks**
| Tool | Purpose |
|---|---|
| `list_my_tasks` | Tasks assigned to you (filter by `status`, narrow by `repositoryId`) |
| `get_task` / `get_task_by_key` | Full task detail, by id or human key (e.g. `ALPHA-42`) — includes `story`, `repository`, `blockedBy`/`blocks`, `attachments`, `embeds` |
| `get_current_task` | Resolve the task key from the current branch name and fetch its detail |
| `list_story_tasks` | Sibling tasks under the same story — the "other half" of a cross-repo hand-off |
| `search_tasks` | Find tasks by keyword across the whole project (name/description substring match) — use when you don't know the exact key |
| `list_statuses` | Workflow statuses for a project — exact strings `update_task_status` accepts |
| `list_sprints` / `list_members` | Sprints in a project / teammates sharing a project with you |

**Authoring** (see `nexus-plan-work`)
| Tool | Purpose |
|---|---|
| `list_epics` / `get_epic` | Epics in a project / single epic detail |
| `create_epic` | New epic — `code` auto-generates in the product's own format if omitted; confirm with the person first, epics are a bigger commitment than a task |
| `update_epic` | Change name/description/priority/status/color on an epic — `code`/`projectId` aren't editable |
| `list_stories` / `get_story` | Stories under an epic / single story detail — check before creating a duplicate |
| `create_story` | New story under an epic |
| `update_story` | Change name/description/priority/status/storyPoints on a story — `epicId` isn't editable |
| `list_labels` / `create_label` | Labels in a project / create a new one |
| `create_task` | New task — `epicId` required; set `storyId`/`repositoryId`/`blockedById`/`assigneeId`/`sprintId`/`labelIds` at creation if known |
| `update_task` | Change name/description/priority/dueDate/storyPoints/archived/`storyId`/`repositoryId`/`blockedById`/`sprintId`/`assigneeId`/`labelIds` on an existing task (`null` unsets a field; `labelIds` is a full replace, not a diff) — `archived: true`/`false` archives/restores instead of deleting |
| `list_task_git_activity` | Commits/MRs linked to a task, newest first — read-only, populated by GitLab webhooks |
| `add_task_attachment` | Upload a local file (screenshot, export, doc — 10MB cap) to a task |

**Reviewers / additional assignees**
| Tool | Purpose |
|---|---|
| `list_task_assignees` | Additional assignees/reviewers on a task, beyond the single primary assignee |
| `add_task_assignee` | Add someone as an additional assignee or reviewer (`role: "ASSIGNEE" \| "REVIEWER"`, defaults to `ASSIGNEE`) — needs a real `taskId`, so always a follow-up call after `create_task`, never the same call |
| `remove_task_assignee` | Remove one — takes the assignee row id from `list_task_assignees`/`add_task_assignee`, not a member id |

**Hand-off**
| Tool | Purpose |
|---|---|
| `list_task_comments` / `add_task_comment` | Persistent notes on a task (decisions, questions, hand-off context) — survives past the session, unlike chat. `parentId` threads a reply. |
| `update_task_status` | Move a task to a new status by name — the signal the next person/agent watches for |

## Optional: scheduled task check (notification only)

`scripts/check-my-tasks.sh` runs headless (`claude -p`) and checks `list_my_tasks` on a timer, firing a macOS notification if anything's ready — it does **not** start writing code by itself (`--allowedTools` is locked to read-only tools plus `Bash(osascript*)`, so it structurally can't edit files even if it wanted to).

```bash
launchctl load ~/Library/LaunchAgents/com.pea-thailand.nexus-task-check.plist   # enable, runs every 2h
launchctl unload ~/Library/LaunchAgents/com.pea-thailand.nexus-task-check.plist # disable
tail -f ~/Library/Logs/nexus-task-check.log                                     # watch it run
./scripts/check-my-tasks.sh                                                     # run once, right now
```

The plist itself isn't in this repo (it's local machine config, per person) — copy the one in `DEVLOG.md`'s 2026-08-22 entry, or ask whoever set theirs up.

This only checks; a person still has to open Claude Code and say "go" once notified — see `DEVLOG.md` if you want the reasoning for why it stops there.

## Known limits

- No attachment/embed *upload* via API (reading them works — `get_task` returns both) — attach Figma links/screenshots through the product UI.
- No hard delete for epics/stories/labels — only `archived` on tasks (soft, reversible). Real delete would need cascade-safety design work not done yet; use the product UI for now.
- No search-by-keyword — `list_my_tasks` filters by `status`/`repositoryId` only, `get_task_by_key` needs the exact key.
- No sprint assignment on tasks/stories via API (`sprintId` is readable, not settable) — set it through the product UI.
- No multi-assignee/reviewer — `assigneeId` is a single value.
- Repo-scoped, story-scoped, and label-filtered queries only return results once someone actually sets `repositoryId`/`storyId`/`labelIds` on tasks — nothing is inferred automatically.
- `list_*` tools have no pagination — fine at current scale, revisit if a project's task count grows a lot.
