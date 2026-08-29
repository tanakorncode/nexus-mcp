# agent-teams-ai — architecture research notes

Source: `/Users/tanakorn/Downloads/agent-teams-ai-main` (AGPL-3.0, downloaded for read-only
research — nothing here is copied code, only descriptions of mechanisms). Researched
2026-08-29 across 6 background exploration passes. Purpose: reference for possibly
reimplementing similar features in our own Agent App / Nexus setup.

Electron desktop app for orchestrating teams of AI coding agents (Claude/Codex/Gemini/OpenCode)
with a kanban board, git-worktree isolation, and hunk-level review.

## Subsystem map

- **`src/main/`** — Electron main process, the control plane. Owns all filesystem I/O against
  `~/.claude/teams/{team}` and `~/.claude/tasks/{team}`, git operations, IPC handlers
  (`src/main/ipc/teams.ts` is huge — kanban, review, worktree preflight, member settings all
  live here), an internal HTTP "team control API," and dozens of `services/team/*` classes.
- **`src/renderer/`** + **`src/features/*/renderer`** — React/Zustand UI. Talks to main only
  through the `window.api` preload bridge (or an HTTP fallback for a detached/browser-preview
  window). Feature folders follow ports/adapters: `contracts/` (DTOs), `core/domain/` (pure
  logic), `main/adapters/`, `renderer/`.
- **`agent-teams-controller/`** — a separate CommonJS package vendored into both the Electron
  app and the MCP server. Contains the actual task/kanban/inbox/review business logic as flat
  modules (`internal/tasks.js`, `kanban.js`, `taskBoard.js`, `review.js`, `runtime.js`,
  `messages.js`, `agenda.js`, `crossTeamProtocol.js`, `boardLock.js`, `atomicFile.js`,
  `fileLock.js`). `internal/runtime.js` is a thin REST client that calls back into the
  Electron app's HTTP control API — this is how an agent process (via MCP) reaches into the
  running Electron app.
- **`mcp-server/`** — the actual MCP server (`agent-teams-mcp`) agents connect to as a tool.
  `mcp-server/src/tools/*.ts` groups tools by domain (kanban, task, team, review, message,
  cross-team, process, runtime, work-sync, lead), each a thin wrapper over
  `agent-teams-controller`.
- **`packages/agent-graph`** — standalone visualization package (`canvas/`, `layout/`,
  `strategies/`, `ui/`, `hooks/`, `ports/`) used by the renderer to draw team topology,
  decoupled via a ports interface.

**Core data flow**: agent → MCP tool call → `agent-teams-controller` function → HTTP request to
Electron's control API → `src/main` services mutate state on disk → `FileWatcher`
(`src/main/services/infrastructure/FileWatcher.ts`, native `fs.watch`) detects the change → IPC
push (`team:change`) to the renderer → renderer re-fetches the affected state slice. This exact
pattern (fs.watch → IPC push, no polling, no websocket) recurs across kanban, messaging, and the
agent graph.

---

## 1. Git worktree isolation

Not one mechanism — forks on provider, driven by a per-member `isolation: 'worktree' | null`
setting.

- **OpenCode members (app-managed)**: `TeamMemberWorktreeManager.ts`. Resolves repo root via
  `git rev-parse --show-toplevel`, derives a **deterministic** branch name
  `agent-teams/{teamSlug}/{memberSlug}-{sha256(repoPath).slice(0,10)}` and worktree path under
  the app's data dir. Verifies an existing worktree really belongs to the same repo/branch
  before reusing it (idempotent across restarts). Runs `git worktree add`. Limited to one
  isolated OpenCode member per runtime lane.
- **Claude/Codex teammates (prompt-driven)**: the app does *not* create a worktree itself — it
  threads `isolation: worktree` into the roster text and spawn-tool-call args given to the team
  lead, deferring to those CLIs' own native worktree primitives.
- **Preflight**: `TeamWorktreeGitService.ts` checks the project is a git repo with at least one
  commit (worktrees need `HEAD`); offers `git init` + empty initial commit if not, never
  auto-commits real files.
- **Cleanup/merge-back**: none found. `git worktree remove` doesn't appear anywhere in source.
  Branches are ordinary long-lived branches left for the user to merge manually.

## 2. Hunk-level code review

Live system is a **task change ledger**, not a simple diff parser (an earlier
`FileChangeExtractor`+`jsdiff` design in `docs/iterations/` was superseded).

1. Agent edits get recorded as an append-only JSONL journal per task
   (`.board-task-changes/events/{taskId}.jsonl`): before/after content hashes, op kind,
   confidence tier (`exact|high|medium|low|ambiguous`), provenance.
2. `TaskChangeLedgerReader` reduces the journal to a `TaskChangeSetV2`: per-file line diffs
   (`diff.diffLines`), reviewability classification (`full-text|partial-text|metadata-only`).
   `ChangeExtractorService` orchestrates: prefers ledger, falls back to log reconstruction, can
   trigger on-demand ledger backfill for OpenCode. Cached (TTL + persisted JSON cache) keyed to a
   version counter + journal byte-size/mtime "stamp."
3. Renderer: `ChangeReviewDialog.tsx` (~5.4k lines) → `CodeMirrorDiffView.tsx` builds a
   CodeMirror `unifiedMergeView` over before/after text — hunks come from CodeMirror's own diff
   algorithm, not hand-rolled.
4. Decisions keyed by stable `reviewKey` + hunk index (`changeReviewSlice.ts`, Zustand), with a
   hash of surrounding lines so a stale hunk index can be safely rejected. Applied by
   `ReviewApplierService.ts`:
   - **Accept** = no-op (disk already has the agent's change).
   - **Reject** reverses the hunk(s) against the review snapshot; if the file changed on disk
     since (agent kept working), runs a three-way text merge and only writes on a clean result —
     otherwise surfaces a conflict rather than clobbering.
   - All writes go through an atomic-transaction helper + per-file async lock.
   - Comments are a separate concern, feeding the task's inbox/comment stream, not the ledger.

## 3. Kanban board orchestration

- TODO/IN PROGRESS/DONE are **derived** straight from the task's own status field. REVIEW/
  APPROVED are tracked out-of-band in a separate `kanban-state.json`
  (`TeamKanbanManager.ts`) specifically so an agent's own task-file writes can't clobber review
  metadata. Atomic tmp+rename writes, malformed entries dropped on load rather than crashing.
- Agents self-drive TODO→IN PROGRESS→DONE via MCP tools writing task JSON files directly under
  `~/.claude/tasks/{team}/{id}.json` (lock file + highwatermark for ID allocation) — the UI never
  pushes this transition. REVIEW/APPROVED are user-driven: DONE→REVIEW optionally
  auto-assigns a reviewer (round-robin / least-active-review-count) + inbox message;
  DONE→APPROVED is a one-click shortcut; REVIEW→"Request Changes" deletes the kanban-state
  entry, flips the task to `pending` with a `needsFix` marker, and messages the original owner.
- GC pass prunes stale `kanban-state.json` entries only after all task files are fully loaded
  (avoids a startup race).

## 4. Messaging / real-time agent chat

Two genuinely different surfaces:

**(a) MessagesPanel — discrete structured inbox messages, persistent, team-wide.**
- Storage: `~/.claude/teams/{team}/inboxes/{memberName}.json`, one JSON array per member,
  appended forever (no pruning). Written via `TeamInboxWriter.ts` (atomic write + file lock,
  race with the CLI process reduced but not eliminated per the app's own docs). Read/merged by
  `TeamInboxReader.ts`. Message shape: `from`, `text` (plain string or JSON-encoded structured
  event like `idle_notification`/`shutdown_request`/`task_completed`), `timestamp`, `read`,
  `messageId`, optional `to`/`summary`/`color`.
- UI: `MessagesPanel.tsx` (renders an `ActivityTimeline`) + `MessageComposer.tsx` (pick
  recipient incl. cross-team, `@member`/`#task` mentions, action mode do/ask/delegate).
- Real-time: identical FileWatcher→IPC pattern as kanban — watches `inboxes/` dir, classifies
  `type: 'inbox'` / `'lead-message'` events.
- Delivery latency: a teammate only picks up new inbox entries **between turns** (its own
  `fs.watch` wakes it) — 1–30s typical, never mid-tool-call.

**(b) ChatHistory (session tab) — live streamed transcript of one running CLI process,
ephemeral.**
- Not file-watching — the CLI child process's stdout (`stream-json` protocol) is read and
  forwarded live over IPC as produced. Lower latency than the inbox mechanism.
- Renderer components: `src/renderer/components/chat/*` (`ChatHistory.tsx`,
  `DisplayItemList.tsx`, `ThinkingItem.tsx`, `LinkedToolItem.tsx`, `TeammateMessageItem.tsx` —
  the last is just how an inbox message *appears* interleaved into a transcript, not a second
  storage mechanism).

**User → running agent, "smart routing"** (`handleSendMessage` in `src/main/ipc/teams.ts`):
- Recipient = **team lead**, alive, non-OpenCode → delivered directly via the lead's **stdin**
  as a stream-json message (near-instant), falls back to inbox file on failure. Shared
  `messageId` correlates the stdin payload and the persisted inbox record.
- Recipient = any **other teammate**, or lead offline → inbox file only. No stdin injection path
  to a non-lead process. No way to interrupt an agent mid-tool-call.
- Attachments only supported for the online lead or an online OpenCode recipient (native
  Claude/Codex teammates only read text from the inbox file).

## 5. Team/member provisioning and setup

- **Create ≠ Launch**: `CreateTeamDialog.tsx` has a "Launch team" checkbox. Unchecked →
  `createConfig` only writes `team.meta.json` + `members.meta.json` + empty tasks dir, **no
  process spawned**. Checked → full deterministic provisioning pipeline. A team can exist purely
  as on-disk config with zero running processes; `LaunchTeamDialog.tsx` launches it later
  (immediately or scheduled).
- **Member edit lifecycle** (`memberSettingsPolicy.ts` → `selectMemberSettingsLifecycleAction`):
  returns `none` / `persisted_only` / `restart_member` / `restart_opencode_lane` /
  `restart_lead` / `require_team_relaunch`. Lead identity fields (role, workflow, isolation,
  providerId, providerBackendId, fastMode, mcpPolicy) always force full relaunch if changed;
  only model/effort hot-apply via `restart_lead` (anthropic/codex/gemini only — OpenCode leads
  always need full relaunch). Regular member: switching provider identity into/out of OpenCode
  forces relaunch; otherwise `restart_member` (single-process restart only).
- **Provider auth**: Anthropic/Gemini/Codex — spawn the real CLI binary in an embedded pty
  (`auth login --provider ...`), then re-fetch CLI status. Codex also has a lighter
  `CodexReconnectPrompt` OAuth-refresh path for stale ChatGPT sessions. OpenCode local models —
  no CLI login at all; validated by live-probing the configured HTTP endpoint
  (`OpenCodeLocalModelRuntimeInspector`/`Preflight`), status `ready|needs_verification|
  incompatible|experimental|error`.
- **Spawn sequence**: Electron spawns **only the lead process** directly via `spawnCli`.
  Individual teammates are *not* forked by the lead's own OS process — the lead is instructed
  (via prompt) to use its Task/Agent tool with a `team_name` param, which round-trips through
  the MCP control plane back into `TeamProvisioningMemberLifecycle.ts`, the second and only
  other `spawnCli` call site — it spawns each member as its own detached headless CLI process
  (`--teammate-runtime headless --agent-id ... --parent-session-id ...`). Same code path is
  reused for initial roster spawn and later add/restart-member operations.
- `TeamProvisioningPromptBuilders.ts` builds the lead's persistent context: member roster text,
  hard constraints (never call TeamDelete, never broadcast SendMessage "*", delegation-first,
  solo-mode fallback), `teamCtlOps` MCP tool instructions, cross-team messaging protocol.

## 6. Task logs / agent graph / embedded terminal / review-shell UI

- **Task Logs Panel** (`taskLogs/`, `member-log-stream/`) — scoped to a single *task*,
  reconstructed from **persisted transcript files on disk**, not live stdout. Three views:
  "Task Log Stream"/"Exact Task Logs" = precise message/tool-level attribution to the task via
  embedded IDs/markers; "Execution Sessions" = coarser, wraps the whole member session log
  clipped to the task's `workIntervals` timestamp range.
- **Agent Graph tab** (`packages/agent-graph`, `src/features/agent-graph/`) — visualizes the
  whole team's live runtime state: lead/member/task/process nodes, ownership + blocking/related
  edges, inbox messages & task comments as animated particles along edges. Layout is **not**
  generic force-directed: `stableSlots.ts` assigns each member a deterministic ring/sector slot
  around the lead (persisted, prevents jitter); `KanbanLayoutEngine` renders a miniature kanban
  board directly under each owner's node. HUD overlays (provisioning progress, inline activity
  lane, member-log preview reusing the `member-log-stream` pipeline, blocking-edge popovers) are
  absolutely-positioned React elements over the canvas. Data source is the same Zustand
  store/FileWatcher pipeline as kanban — no separate graph channel.
- **Embedded terminal** — two distinct systems:
  - `EmbeddedTerminal.tsx` — genuine node-pty + xterm.js shell for one-off commands.
  - `terminal-workspace/` — a much larger **custom-built multiplexer**, not tmux: spawns a
    per-team native **Rust `terminal-daemon` binary**, persists session state to per-team
    SQLite, exposes a local WebSocket gateway the renderer connects to for multi-pane sessions,
    history, snapshots. Real tmux integration (separately) exists only to keep CLI agent
    processes alive detached from the Electron app lifecycle and to detect liveness — unrelated
    to this UI; the `TmuxStatusBanner` in the dashboard is dead code (always renders `null`).
- **`ReviewDialog.tsx`** (name is misleading) — just a "Request Changes" comment composer
  (`@member`/`#task` mentions), never touches diff/hunk data. **`StatusHistoryTimeline`** — a
  separate approval/lifecycle audit-trail timeline (task_created, status_changed,
  review_requested, review_approved, etc.), architecturally independent of both the hunk-review
  dialog and `ReviewDialog`.

## 7. Extensions store / schedules / token usage / settings

- **Extensions store** — 4 tabs: Plugins (read-only marketplace browse/install), **MCP
  servers** (browse an official registry *or* register any custom stdio/HTTP MCP server — the
  install path shells out to the real CLI binary, `claude mcp add ...`, writing to
  `~/.claude.json`/project `.mcp.json`, so any agent spawned later picks it up automatically —
  no separate propagation step), Skills (folder-based Agent Skills, live filesystem-watched),
  API keys (encrypted/keychain store, cross-referenced against live CLI provider auth status).
- **Schedules** — real cron (`croner` lib) + timezone, not a simple interval. A scheduled run is
  **not** a full team launch — it's a one-shot `claude -p "<prompt>" --output-format
  stream-json --max-turns N --dangerously-skip-permissions ...` child process, output captured
  and truncated. Everything (persistence + `Cron` job objects) lives in the Electron **main
  process**; schedules stop firing whenever the app isn't running (no headless/background
  execution outside Electron). Per-cwd locking, auto-retry (up to 2), auto-pause after repeated
  failures.
- **Token usage dashboard** (`src/features/token-usage/`) — doesn't call provider billing APIs;
  reconstructs usage by parsing local session logs (Claude JSONL, Codex JSONL, OpenCode SQLite),
  deduped per request, cost estimated via a static pricing table. Explicitly tags each event's
  `usageSourceKind` (`sdk_exact`/`gateway_exact`/`log_parsed`/`tokenizer_estimated`/
  `cost_estimated`) so exactness is visible. Scopable by date range and team(s); supports budget
  alerts at global/team/project granularity.
- **Settings** — General/Notifications/Advanced are the reachable tabs; a fully-implemented
  **Connection** (SSH remote) section exists in code but its tab entry is currently commented
  out/disabled. `ConfigEditorDialog` edits the app's *own* JSON config (general/notifications/
  display/sessions), not CLI config — auto-saves per top-level section on an 800ms debounce.

## 8. Dashboard / teams list / organizations / notifications / report / command palette

- **Dashboard** — more than status banners: a real `RunningTeamsSection` (live team cards with
  task-status summaries) + `RecentProjectsSection`, below conditional banners (CLI install/auth
  status, update-available, Windows-without-admin warning; the tmux banner is dead/disabled).
- **Teams list** — per-team card: computed status badge (from alive-process list + provisioning
  state), git branch, member badges, task-count summary; click opens the team detail tab.
- **Organizations / org map** — a genuinely separate data model from "team": an org is a
  top-level container holding an arbitrary-nesting unit tree (`container`/`team` nodes),
  user-edited metadata only (assigning teams to units never launches/provisions anything),
  stored as plain JSON. The map additionally overlays a **runtime cross-team communication
  graph** built from actual cross-team outbox messages — distinct from the per-team agent-graph
  tab, which is one team's internal member/task graph. Hierarchy does not restrict which teams
  can actually communicate.
- **Notifications** — a persistent, app-wide (cross-team) notification center, separate from
  MessagesPanel. Dual-purpose `DetectedError` records: error-domain (regex/threshold rules
  evaluated against session JSONL) and team-domain (fixed event kinds: rate_limit, lead_inbox,
  task_review_requested, schedule_failed, usage_budget_exceeded, etc.). Per-event-type config
  toggles also drive native OS toast notifications, not just the in-app list.
- **Report tab** — assesses a **single session's** transcript. Entirely deterministic/local, no
  LLM call — a TypeScript port of a Python analysis script computing cost, cache efficiency,
  thrashing/friction signals, idle time, tool usage, then classifying each into a fixed severity
  vocabulary (`healthy/moderate/high/critical` etc.) shown as colored badges.
- **Command palette** (Cmd/Ctrl+K) — navigation-only search (projects, or full-text session
  transcript search) despite the name; no arbitrary action/command registry. Unrelated
  `SearchBar.tsx` is a local in-transcript find bar (Cmd+F).

---

## Notable things worth flagging if reimplementing

- The **create/launch split** (section 5) and the **derived-vs-out-of-band kanban state**
  (section 3) both look like genuinely reusable design decisions, not incidental — the
  REVIEW/APPROVED-out-of-band pattern is specifically defensive against an agent's own
  task-file write clobbering review metadata, worth keeping if we build kanban review state on
  top of Nexus tasks.
- Worktree isolation is **not** actually solved end-to-end by this app — no automated
  cleanup/merge-back exists. Don't assume there's a reference implementation to copy for that
  part; it'd need to be designed from scratch.
- Scheduled runs bypass the whole team/kanban/review machinery and use
  `--dangerously-skip-permissions` — a real security-relevant design choice to consider (or
  explicitly avoid) if we add scheduling to Agent App.
- The stdin-vs-inbox "smart routing" split for user→agent messages (section 4) is a clean
  pattern: near-real-time to the one process that's actually driving conversation (the lead),
  async/file-based to everyone else, with no mid-tool-call interruption anywhere.
