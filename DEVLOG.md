# DEVLOG

## 2026-08-19 — scaffold + pivot from OAuth to PAT, not yet connected end-to-end

**What this is for:** an MCP server so Claude Code (running for different people, on different machines) can read/update Nexus/TaskBridge tasks directly, instead of relaying task state by hand. Part of the "Relay Board" multi-agent design — GitLab + this PM system is the shared state agents coordinate through; `update_task_status` is the hand-off signal.

**What was tried first, and why it didn't work:** ported `nexus-vscode`'s (`~/development/pea/nexus-vscode`) `NexusClient`/`TokenManager`/`OAuthProvider` almost verbatim, swapping the two VS Code-only pieces (SecretStorage → OS keychain, `vscode.env.openExternal` → local browser open). Hit a wall against the real deployment (`http://27.254.62.17:8090`): `/api/auth/nexus/authorize` rejects any `redirect_uri` that isn't `vscode://` or a literal `http://127.0.0.1` — that flow is reserved for the official VS Code/IntelliJ extensions, confirmed by reading `pm-system`'s route source directly, not just from the error message.

**What actually works — pivoted to:** the PM system's own Developer Portal (`/developer`) — register an app, generate a personal access token (`pm_...`), use it as a static Bearer token against `/api/v1/*`. No OAuth needed at all. Confirmed by reading `pm-system/src/app/api/v1/**` route handlers directly (not guessed).

**Real constraint found in the v1 route source:** `/api/v1/*` only covers tasks / projects / sprints / members. No comments, no epics, no commit-linking, no task-by-key or git-remote→project lookup, no `/me` endpoint — those only exist on the internal `/api/nexus/*` surface gated to the extensions. Worked around:
- "current user" — resolved by matching the email entered at `npm run login` against `/api/v1/members` (cached in-process).
- "current project" — resolved from the current git branch's task-key prefix (`ALPHA-42` → project key `ALPHA`) matched against `list_projects()`, not git remote.
- `add_comment` / `list_epics` / `get_task_commits` — dropped. Not possible against this API; would need `pm-system` itself to add the routes.

**Done:**
- Full rewrite against `/api/v1/*` shapes (nested `assignee`/`statusRel`/`epic`/`sprint`, not flat name strings).
- Tools: `whoami`, `list_projects`, `get_current_project`, `list_my_tasks`, `get_task`, `get_task_by_key`, `get_current_task`, `list_statuses`, `update_task_status`, `list_sprints`, `list_members`.
- `npm run login` — interactive prompt for a pasted `pm_...` token + email, stored via `@napi-rs/keyring` (cross-platform: macOS Keychain / Windows Credential Manager / Linux Secret Service).
- Typechecks clean (`npx tsc --noEmit`), boots clean against the real `NEXUS_API_URL`. Not yet run end-to-end with a real token — needs a human to generate one, can't be done unattended.
- Git: 2 commits (`6446451` scaffold, `4ffbaa6` v1/PAT pivot).
- `.mcp.json` added at `pea-thailand-backoffice-be`'s repo root registering `nexus-mcp` (project-scoped, since the `claude` CLI isn't installed on this machine — no way to do `claude mcp add` yet). Untracked, not committed.

**Left to do, in order:**
1. Run `npm run login` — go to `http://27.254.62.17:8090/developer`, create an app, grant `tasks:read` `tasks:write` `projects:read` `members:read` `sprints:read`, generate a token, paste it in when prompted along with your Nexus account email.
2. Reload the VS Code window so the Claude Code extension picks up `.mcp.json` (first load will likely show a trust-approval prompt for the new server).
3. Sanity check: ask Claude to call `whoami` then `list_my_tasks` — if both return real data, the whole chain works.
4. Decide on multi-repo/global registration — right now `.mcp.json` only makes `nexus-mcp` visible inside `pea-thailand-backoffice-be`. Either install the real `claude` CLI (`npm install -g @anthropic-ai/claude-code`) and use `claude mcp add --scope user`, or copy `.mcp.json` into each repo that needs it. Not resolved yet — didn't want to guess the user-scope file format without the CLI to verify it.
5. Optional, only if `add_comment`/`list_epics` end up mattering: would require adding those routes to `pm-system`'s `/api/v1/*` — out of scope for this repo.
