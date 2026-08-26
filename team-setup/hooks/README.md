# hooks/ (optional)

Not installed by default — these are examples, not something every repo needs. A hook runs a shell command on a Claude Code event, wired via `.claude/settings.json`'s `hooks` key (the shared, committed one — see `../settings.json.example`).

`stop.sh` / `approve.sh` here are the two from `demo-project-team` — an audible nudge when a session finishes (`Stop`) or needs a permission decision (`PermissionRequest`), using macOS's `say`. **macOS-only** — don't wire these into a team's shared `settings.json` without checking everyone's actually on macOS, or Linux/Windows teammates get a hook that just fails silently on every stop/permission event.

To use:

```bash
mkdir -p .claude/hooks
cp ~/development/pea/claude-templates/team-setup/hooks/*.sh .claude/hooks/
chmod +x .claude/hooks/*.sh
```

Then add to `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": ".claude/hooks/stop.sh" }] }],
    "PermissionRequest": [{ "hooks": [{ "type": "command", "command": ".claude/hooks/approve.sh" }] }]
  }
}
```

For a cross-platform equivalent, swap `say "..."` for whatever's available on the team's actual OS mix (`notify-send` on Linux, `powershell -c [console]::beep` or a toast on Windows) — or skip audio hooks entirely and rely on Claude Code's own UI notifications, which work everywhere without any of this.
