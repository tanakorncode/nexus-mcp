# nexus-mcp

MCP server exposing the Nexus/TaskBridge PM system's **public `/api/v1/*` API** to Claude Code, so agents can read and update tasks directly instead of a human relaying state by hand.

## Why `/api/v1/*` and not the extension's own endpoints

`nexus-vscode` talks to `/api/auth/nexus/*` and `/api/nexus/*` — endpoints reserved for the official VS Code/IntelliJ extensions (the OAuth `redirect_uri` is validated against `vscode://` or a literal `http://127.0.0.1`, which a standalone tool can't satisfy). The PM system has a separate, actually-third-party-friendly surface for this: a **Developer Portal** (`/developer`) where you register an "app" and mint a personal access token, used against `/api/v1/*`.

Trade-off: `/api/v1/*` only covers tasks / projects / sprints / members. No comments, no epics, no commit-linking — those only exist on the extension-only endpoints. `update_task_status` is still the core hand-off signal, so this doesn't block the main use case, but comment-based hand-off notes aren't possible against this API today.

## Setup

```bash
npm install
export NEXUS_API_URL=http://27.254.62.17:8090
npm run login
```

`login` walks you through generating a token in the Developer Portal, then prompts for it plus your account email (needed because there's no `/me` endpoint — "my tasks" is resolved by matching your email against `/api/v1/members`). The token is stored in your OS keychain via `@napi-rs/keyring`.

Each teammate registers their own app + token in the Developer Portal and runs `npm run login` on their own machine.

## Register with Claude Code

```bash
npm run build
claude mcp add nexus-mcp \
  -e NEXUS_API_URL=http://27.254.62.17:8090 \
  -- node /path/to/nexus-mcp/dist/index.js
```

## Tools

| Tool | Purpose |
|---|---|
| `whoami` | Resolve the configured member (by email) |
| `list_projects` | Projects the user is a member of |
| `get_current_project` | Auto-detect project from the current branch's task key prefix (e.g. `ALPHA-42` → project key `ALPHA`) |
| `list_my_tasks` | Tasks assigned to the user (optionally filtered by status) |
| `get_task` / `get_task_by_key` | Task detail, by id or by key |
| `get_current_task` | Resolve task key from the current branch and fetch its detail |
| `list_statuses` | Workflow statuses for a project — exact strings `update_task_status` accepts |
| `update_task_status` | Move a task to a new status — the hand-off signal |
| `list_sprints` | Sprints in a project |
| `list_members` | Team members sharing a project with the user |

Project id auto-detects from the current git branch's task-key prefix when omitted (there's no git-remote lookup on the public API, unlike the extension's internal endpoint) — pass it explicitly if that fails.

## Not possible against this API

`add_comment`, `list_epics`, `get_task_commits`, `link_commit` — no `/api/v1/*` route backs any of these; they only exist on the internal `/api/nexus/*` surface reserved for the official extensions. If these matter enough, the fix has to happen on the `pm-system` side (add the routes to `/api/v1/*`), not in this client.
