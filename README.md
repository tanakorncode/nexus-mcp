# nexus-mcp

MCP server exposing the Nexus/TaskBridge PM system to Claude Code, so agents can read and update tasks directly instead of a human relaying state by hand. Paired with two skills in [`claude-templates`](https://github.com/tanakorncode/claude-templates) — `nexus-plan-work` (for PM/BA/Team Lead, authoring) and `nexus-pick-up-task` (for devs, consuming).

Talks to the PM system's public `/api/v1/*` API — not `nexus-vscode`'s internal endpoints, which are reserved for the official extensions. See `DEVLOG.md` for why, and for the full build history.

## Setup (one time, per person)

No clone needed — `npx` fetches, builds, and runs straight from GitHub.

Generate your own access token, then log in (this prompts you for the token):

```bash
export NEXUS_API_URL=http://27.254.62.17:8090
npx -y -p github:tanakorncode/nexus-mcp nexus-mcp-login
```

This walks you through the Developer Portal (`$NEXUS_API_URL/developer` → create an app → grant scopes `tasks:read tasks:write projects:read members:read sprints:read` → generate a token), then prompts for that token plus your account email. The token is stored in your OS keychain (`@napi-rs/keyring` — works on macOS/Windows/Linux), never in a file.

**Install the skills** (once per person — see `claude-templates/README.md` for details):

```bash
mkdir -p ~/.claude/skills
git clone --depth 1 https://github.com/tanakorncode/claude-templates /tmp/claude-templates
cp -r /tmp/claude-templates/skills/nexus-pick-up-task ~/.claude/skills/
cp -r /tmp/claude-templates/skills/nexus-plan-work ~/.claude/skills/
```

**Register with Claude Code** — two ways, not mutually exclusive:

*Option A — for yourself, every repo, one time* (needs the `claude` CLI: `npm install -g @anthropic-ai/claude-code`):

```bash
claude mcp add nexus-mcp -s user -e NEXUS_API_URL=http://27.254.62.17:8090 -- npx -y github:tanakorncode/nexus-mcp
```

No `.mcp.json` needed anywhere after this — it applies across every repo you open on this machine.

*Option B — commit `.mcp.json` to a specific repo*, so anyone who clones it gets `nexus-mcp` automatically even without Option A set up:

```json
{
  "mcpServers": {
    "nexus-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:tanakorncode/nexus-mcp"],
      "env": { "NEXUS_API_URL": "http://27.254.62.17:8090" }
    }
  }
}
```

Either way: reload the Claude Code window and approve the trust prompt. Verify with `whoami`.

First run is slower (`npx` fetches + builds fresh); it caches after that.

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
| `list_statuses` | Workflow statuses for a project — exact strings `update_task_status` accepts |
| `list_sprints` / `list_members` | Sprints in a project / teammates sharing a project with you |

**Authoring** (see `nexus-plan-work`)
| Tool | Purpose |
|---|---|
| `list_epics` | Epics in a project |
| `list_stories` | Stories under an epic — check before creating a duplicate |
| `create_story` | New story under an epic |
| `list_labels` / `create_label` | Labels in a project / create a new one |
| `create_task` | New task — `epicId` required; set `storyId`/`repositoryId`/`blockedById`/`assigneeId`/`labelIds` at creation if known |
| `update_task` | Change `storyId`/`repositoryId`/`blockedById`/`assigneeId`/`labelIds` on an existing task (`null` unsets a field; `labelIds` is a full replace, not a diff) |

**Hand-off**
| Tool | Purpose |
|---|---|
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

- No comment support, no commit-linking — those routes only exist on the extension-only internal API, not `/api/v1/*`. Would need new `pm-system` routes to add.
- No epic creation via API — epics are infrequent/lead-planned; use the product UI.
- No attachment/embed *upload* via API (reading them works — `get_task` returns both) — attach Figma links/screenshots through the product UI.
- Repo-scoped, story-scoped, and label-filtered queries only return results once someone actually sets `repositoryId`/`storyId`/`labelIds` on tasks — nothing is inferred automatically.
