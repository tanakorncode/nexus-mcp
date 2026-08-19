# nexus-mcp

MCP server exposing the Nexus/TaskBridge PM system (epic → story → task) to Claude Code, so agents can read and update tasks directly instead of a human relaying state by hand.

Ported from [`nexus-vscode`](../nexus-vscode)'s API client and OAuth flow — same auth, same endpoints, same task model. The only things that changed are the two pieces that were VS Code-specific: token storage (now the OS keychain via `@napi-rs/keyring` instead of `vscode.SecretStorage`) and how the login browser tab opens (`open` instead of `vscode.env.openExternal`).

## Setup

```bash
npm install
export NEXUS_API_URL=https://<nexus-host>   # same value nexus-vscode points at
npm run login                                 # opens a browser, stores the token in your OS keychain
```

Each teammate runs `npm run login` on their own machine with their own Nexus account — tokens never leave the local keychain.

## Register with Claude Code

```bash
claude mcp add nexus-mcp -- node /path/to/nexus-mcp/dist/index.js
```

(run `npm run build` first, or point at `npx tsx src/index.ts` for local dev). Make sure `NEXUS_API_URL` is set in the environment Claude Code launches from.

## Tools

| Tool | Purpose |
|---|---|
| `whoami` | Current authenticated user |
| `list_projects` | Projects the user is a member of |
| `get_current_project` | Auto-detect project from this repo's git remote |
| `list_my_tasks` | Tasks assigned to the user (optionally filtered by status) |
| `get_task` / `get_task_by_key` | Full task detail, by id or by key (e.g. `ALPHA-42`) |
| `get_current_task` | Resolve task key from the current branch name and fetch its detail |
| `list_statuses` | Workflow statuses for a project (needed for `update_task_status`) |
| `update_task_status` | Move a task to a new status — the hand-off signal |
| `add_comment` | Log progress or a hand-off note on a task |
| `list_epics` | Epics for a project |
| `get_task_commits` | Commits already linked to a task |

Project id is auto-detected from the current repo's git remote when omitted (same matching logic as `nexus-vscode`'s `ProjectDetector`); pass it explicitly if a repo isn't registered in Nexus yet.

## Not ported (yet)

`NexusClient.getActiveSprint` and `NexusClient.linkCommit` are ported but not wired to a tool yet — add one in `src/index.ts` the same way as the existing tools if needed.

`nexus-vscode` also has `createTask`, `logTime`, and AI helpers (`generateCommitMessage`, `chatWithAI`, realtime SSE) that weren't ported into `NexusClient.ts` at all — out of scope for the read/hand-off loop this server is for. Port the method from `nexus-vscode/src/api/NexusClient.ts` first, then wire a tool.
