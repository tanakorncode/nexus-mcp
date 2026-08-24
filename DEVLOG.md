# DEVLOG

## 2026-08-19 — scaffold, pivot from OAuth to PAT, verified end-to-end

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

**Verified end-to-end (2026-08-19, same session):** logged in for real (Tech Lead account), reloaded VS Code, `.mcp.json` picked up and trusted. Called the live tools in order:
- `whoami` → resolved correctly via email match against `/api/v1/members`.
- `list_my_tasks` with no `projectId` → correctly *failed* with the "could not auto-detect" error, because the current branch was `develop`, which has no task-key pattern. Expected behavior, not a bug — auto-detect only works on a branch like `feature/PEA-T050-something`.
- `list_projects` → returned the real `PEA LINE Official Account` project (key `PEA`) with its 5 statuses (To Do / In Progress / In Review / Done / Blocked).
- `list_my_tasks` with `projectId` passed explicitly → returned 14 real tasks assigned to Tech Lead, correct shape (nested `assignee`/`epic`/`sprint`, `_count`), including one already `Done` with a real `statusRel`. Full chain confirmed working: keychain token → Bearer auth → `/api/v1/*` → correct data back.

**Left to do:**
1. Multi-repo/global registration — right now `.mcp.json` only makes `nexus-mcp` visible inside `pea-thailand-backoffice-be`. Either install the real `claude` CLI (`npm install -g @anthropic-ai/claude-code`) and use `claude mcp add --scope user`, or copy `.mcp.json` into each repo that needs it. Not resolved yet — didn't want to guess the user-scope file format without the CLI to verify it.
2. Other teammates still need to do their own `npm run login` (own app + token in the Developer Portal, own email) — nothing here is shared automatically, this was only verified for one account so far.
3. Optional, only if `add_comment`/`list_epics` end up mattering: would require adding those routes to `pm-system`'s `/api/v1/*` — out of scope for this repo.

## 2026-08-22 — found + fixed a real gap: PATCH status didn't set statusId/completedAt

`update_task_status` was writing only the raw `status` string column. Compared PEA-T002 (set via nexus-mcp) against PEA-T001 (a pre-existing real "Done" task) and found `statusId` and `completedAt` stayed `null` on the nexus-mcp one — `/api/v1/tasks/[id]` PATCH (`pm-system/src/app/api/v1/tasks/[id]/route.ts`) never touched those fields no matter what the client sent, confirmed by reading the route source directly (not guessed).

**Fix (in `pm-system`, not this repo):** PATCH now resolves `body.status` against the project's real `ProjectStatus` (unique on `[projectId, name]`) and, when matched, sets `statusId` + `completedAt` (`isDone ? now : null`) alongside the label. Falls back to the old raw-string behavior if the name doesn't match any real status, so nothing existing breaks.

**Verified two ways:**
- Against the live server (`27.254.62.17:8090`) before the fix — confirmed the bug (`statusId`/`completedAt` stayed null after PATCH).
- Against `pm-system`'s own dev server (`localhost:3000`, same database — found it already running, `next dev --turbopack` hot-reloads route changes) after the fix — `statusId`, `statusRel`, and `completedAt` all populated correctly on PEA-T002, matching PEA-T001's shape exactly.

Confirms `nexus-mcp`'s client code was already sending the right thing (`status` as a plain name string) — the gap was entirely server-side. `NEXUS_API_URL` in `pea-thailand-backoffice-be/.mcp.json` was pointed at `localhost:3000` for this test, then switched back to the real server (`27.254.62.17:8090`) afterward — but the *fix itself* is still only live on the local dev server's in-memory process, not on `27.254.62.17:8090`. `pm-system`'s git remote is broken (`repository not found`) and there's no known deploy pipeline yet — real deployment is still unresolved.

## 2026-08-22 — npm link for a portable install, found + fixed a missing shebang

Working out how teammates would install this without hardcoding a path tied to one person's home directory. `npm link` (or `npm install -g .`) makes the `bin` entries in `package.json` (`nexus-mcp`, `nexus-mcp-login`) resolve on `PATH` — so `.mcp.json` can say `"command": "nexus-mcp"` with no path at all, portable across machines, safe to commit and share via git.

**Bug found while testing this:** `dist/index.js` had no `#!/usr/bin/env node` shebang. Running it via `node dist/index.js` (what `.mcp.json` was doing before) worked fine, but invoking the linked `nexus-mcp` command directly did not — the shell fell through to interpreting the first source line as a command, and that line started with the word `import` (an ES module import statement), which happened to resolve to **ImageMagick's `import` binary** on this machine instead of failing with a clear error. Silent, confusing failure mode.

**Fix:** added `#!/usr/bin/env node` as the first line of `src/index.ts` and `src/cli/login.ts` — `tsc` preserves a shebang comment verbatim at the top of a file, so it survives into `dist/*.js`. Verified `nexus-mcp` runs clean via the linked PATH command afterward (no ImageMagick output, clean exit).

`pea-thailand-backoffice-be/.mcp.json` now: `"command": "nexus-mcp", "args": []`, no path, `NEXUS_API_URL` pointed at the real server. Still needs `nexus-mcp` itself pushed to a git remote before this is actually shareable — right now it only exists as local commits on this machine.

Pushed to `https://github.com/tanakorncode/nexus-mcp` shortly after (separate from this note — see commit history).

## 2026-08-22 (later) — repo-scoped tasks, story grouping, task dependencies

The real question this was for: one Nexus project covers multiple actual repos (frontend, backend, ...) — how does an agent sitting in one specific repo know which tasks are "its" tasks, and how does it know backend-before-frontend ordering? Checked the schema directly instead of guessing (`pm-system/prisma/schema.prisma`) and found three mechanisms already modeled, none of them exposed through `/api/v1/*` yet:

- **`GitRepository`** — a project can register multiple repos, each with its own `repoUrl`. `Task.repositoryId` links a task to one specific repo. This is the actual designed-for answer to "which task is for this repo."
- **`Story`** — groups tasks under one epic; sibling tasks sharing a `storyId` are the natural "one feature, one task per repo" unit. Already had real data to confirm this pattern (PEA-T048/T049/T050 share a `storyId`).
- **`Task.blockedById`** (+ reverse `blocks`) — literal single-predecessor dependency field, exactly the "do X before Y" signal. Confirmed via a schema comment that this is the one actually used by the product's task-detail/badges/backlog UI, not the richer `TaskDependency` table (that one's additive, for the Gantt view's multi-dependency FS/SS/FF/SF needs — out of scope here).

**Backend changes (`pm-system`):**
- `GET /api/v1/tasks` and `GET /api/v1/tasks/:id` — added `story`, `repository`, `blockedBy`, `blocks` to the Prisma include (were being silently dropped before, client had no way to see them even though the columns existed).
- `GET /api/v1/tasks` — added `storyId` and `repositoryId` query filters (mirrors the existing `status`/`assigneeId` pattern).
- New route `GET /api/v1/repositories?projectId=&repoUrl=` — lists registered repos for a project. Gated by `projects:read` (didn't add a new scope — a GitRepository is project config, not a separate resource, and adding a new scope would've orphaned every already-issued token). Selects only safe fields — excludes `webhookSecret`, `aiReviewApiKey`.
- Typechecks clean (`tsc --noEmit`, exit 0, both times).

**Reality check before building the client side:** queried the live DB directly (`prisma.gitRepository.findMany()`) — **zero `GitRepository` rows exist for the PEA project.** The mechanism is real but nothing's registered yet. Didn't fabricate a repo record myself (that's real project config, not something to guess at from an agent) — the matching logic is built and will start working the moment someone registers this repo through the product's own UI.

**Client changes (`nexus-mcp`):**
- `Task` type extended: `storyId`/`story`, `repositoryId`/`repository`, `blockedById`/`blockedBy`/`blocks`.
- New `GitRepository` type + `listRepositories()`.
- `ProjectDetector` rewritten — now tries git-remote → `GitRepository` matching first (exact repo, not just project), falls back to the existing branch-task-key-prefix heuristic if the repo isn't registered. Cache now stores `{project, repository}` together.
- New tools: `get_current_repository` (explicit "not registered yet" result, not an error — that's a normal state), `list_story_tasks` (siblings by story — usable today, no backend gap). `list_my_tasks` gained an optional `repositoryId` param.
- Typechecks clean, rebuilt.

**Not done:** end-to-end test against real data — blocked on nothing existing to match against yet (no repos, no story-linked tasks in active use, no blockedBy links set by anyone). `list_story_tasks` is the one piece with real data behind it (PEA-T048/049/050) and should be testable now. `blockedById`-based sequencing depends entirely on PM/BA actually setting it when planning work — the tooling can only surface it, not invent it.

## 2026-08-24 — packaged as a Claude Code plugin

**Why:** the manual setup (login → `claude mcp add` or `.mcp.json` → reload → separately `git clone claude-templates` and copy two skill folders by hand) was too many steps for a new teammate to get right — this is exactly what surfaced during the Windows teammate onboarding earlier this week.

**Verified real before building anything** (burned once already this session by trusting an agent's unverified claim about MCP config paths) — ran the actual `claude` CLI: `claude plugin init/install/validate/marketplace` all real subcommands; scaffolded a real throwaway plugin (`claude plugin init --with skills mcp`) and inspected the generated files directly. Confirmed: `.claude-plugin/plugin.json`'s `"skills": ["./"]` auto-discovers every `skills/*/SKILL.md` under the plugin root — no root-level `SKILL.md` required (tested with two nested skill dirs and no root file, `claude plugin validate` still passed).

**Done:**
- `nexus-mcp` repo is now itself a plugin — added `.claude-plugin/plugin.json`, root `.mcp.json` (same `npx github:tanakorncode/nexus-mcp` form as the existing `claude mcp add` command, so no separate config step), and `skills/nexus-pick-up-task/` + `skills/nexus-plan-work/` (copied from `claude-templates`, which stays the source of truth for anyone browsing templates rather than installing).
- `claude plugin validate .` passes.
- README restructured: plugin install (`claude plugin install github:tanakorncode/nexus-mcp`) is now Option A / the recommended path — login, install, reload, verify, done. Old manual steps kept as Option B (collapsed `<details>`) in case `claude plugin install` isn't available on someone's CLI version.

**Not done / known gap:** `skills/nexus-pick-up-task` and `skills/nexus-plan-work` now exist in two places (`claude-templates` and here) — content has to be mirrored by hand on future edits, no build step keeps them in sync. Accepted the duplication for now since the two repos serve different distribution needs (browse-and-copy vs single-command-install); revisit if the skills start drifting. Full plugin install → skill auto-load hasn't been verified with a real session reload yet (only schema validation) — next teammate to install it should confirm `/skills` lists both.

**Correction, same day:** first pass claimed `claude plugin install github:tanakorncode/nexus-mcp` installs directly — wrong, caught only because the user asked "will this actually work on someone else's machine" and that prompted re-testing instead of trusting the first answer. `claude plugin install` only installs `<plugin>@<marketplace>` — a bare plugin repo (just `.claude-plugin/plugin.json`) isn't installable on its own; it needs an accompanying `.claude-plugin/marketplace.json` that catalogs it, added via `claude plugin marketplace add <source>` first. Confirmed real by scaffolding both files locally and running the full `marketplace add` → `install` → `list` → `uninstall` → `marketplace remove` cycle end-to-end before touching the real repo. Fixed: added `.claude-plugin/marketplace.json` (single-plugin marketplace, `source: "./"`, pointing at itself) alongside `plugin.json` in the same repo — `claude plugin validate` passes clean. README's Option A is now the verified two-command form: `claude plugin marketplace add tanakorncode/nexus-mcp` then `claude plugin install nexus-mcp@nexus-mcp-marketplace`. Not yet tested against the *pushed* GitHub form specifically (only a local path) — same `marketplace add` command per its own `--help` ("URL, path, or GitHub repo"), high confidence but flagging until someone actually runs it against the real remote.

## 2026-08-24 — OAuth login (loopback PKCE), blocked on pm-system redeploy

**Why:** user asked, after the plugin work above, whether step 1 (login) could be easier — specifically "login through the system like Claude does," i.e. browser-based, no manual token paste. The earlier session (2026-08-19-ish) had concluded OAuth was a dead end for third-party tools — that conclusion turned out to be wrong, or at least stale.

**Re-verified from source, not memory:** read `pm-system/src/app/api/auth/nexus/{authorize,token,refresh}/route.ts` directly. `authorize`'s redirect_uri check is `redirectUri.startsWith("vscode://") || /^http:\/\/127\.0\.0\.1:\d+\//.test(redirectUri)` — any loopback port works, and there's no `client_id`/per-app allowlist gating it (that's a separate, unrelated `/api/oauth/authorize` Developer Portal system). A `gh auth login`-style flow — local HTTP server on a random `127.0.0.1` port, browser opened to `/authorize` with PKCE, wait for the redirect back — is structurally possible with zero pm-system changes, per the source.

**Built, on the client side (`nexus-mcp`):**
- `src/auth/pkce.ts` — S256 verifier/challenge generation.
- `src/auth/browser.ts` — best-effort cross-platform browser opener (`open`/`start`/`xdg-open`), always paired with printing the URL since opening can silently fail (headless box, no default browser).
- `src/cli/login.ts` — OAuth is now the default (`nexus-mcp-login`); `--manual` flag or `NEXUS_TOKEN` env var falls back to the old PAT-paste flow for headless machines. Also dropped the previously-required `NEXUS_API_URL` export — defaults to the production URL now, still overridable.
- `TokenStore.ts` — `TokenSet` is now `PatTokenSet | OAuthTokenSet`; old `{token, email}` keychain entries with no `type` are still read correctly (treated as PAT) so nobody already logged in gets silently logged out.
- `NexusClient.ts` — `getBearerToken()` picks PAT-as-is or a valid/refreshed OAuth access token; `refreshOAuth()` calls `/api/auth/nexus/refresh` and **persists the rotated refresh token** (the server revokes the old one on every use — reusing it would break the next refresh). `getCurrentMember()` returns the OAuth `user` directly for OAuth logins — no more email-matching against `/api/v1/members`, so the whole class of "no member found" errors (the Windows teammate's bug) can't happen on this path anymore.
- Typechecks clean, builds clean.

**Real blocker found during smoke-testing, not guessed:** ran the built `login.js` against the real `NEXUS_API_URL=http://27.254.62.17:8090` — it printed a well-formed authorize URL (verified the `127.0.0.1:<port>` regex matches in a standalone `node -e` check first, to rule out a client-side bug). Then `curl`'d that exact URL directly against production: **400, `"redirect_uri must be vscode:// or http://127.0.0.1"`** — the same rejection the original 2026-08-19 investigation hit. But the local `pm-system` checkout's `authorize/route.ts` (committed 2026-06-12, no local uncommitted diff) already has the permissive port-accepting regex. Conclusion: **what's deployed at `27.254.62.17:8090` doesn't match this local checkout** — this repo has no working git remote and deploys happen out-of-band, so local-vs-live drift isn't automatically caught. Not a code bug on either side as far as I can tell — a deployment gap.

**Status:** all client-side OAuth code is done, typechecked, and committed locally — not pushed (same MComScience/tanakorncode credential mismatch as everything else this session). Not yet usable until pm-system is redeployed with whatever's currently checked out locally. User is redeploying now and will come back to re-test — re-run the same `curl .../authorize?...` smoke test (or just `nexus-mcp-login` for real) once they confirm, before declaring this done.
