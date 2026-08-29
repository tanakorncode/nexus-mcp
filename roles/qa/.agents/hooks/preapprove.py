#!/usr/bin/env python3
"""PreToolUse hook for unattended runs (e.g. Agent App) of the qa role.

Agent App (or any wrapper spawning `claude -p` non-interactively, not
through the Agent SDK) has no one present to answer an interactive
permission prompt — and per the Claude Code hooks guide's Limitations
section, PermissionRequest doesn't even fire for a plain `-p` run;
PreToolUse is the hook event that actually works for this invocation
style. Without something like this, every Bash call qa makes just
hangs or gets denied the moment it's triggered by an unattended Nexus
event (a task moving into a testing/review state, say).

Only handles Bash — qa.md deliberately has no Write/Edit tool at all
("qa ตรวจสอบ ไม่แก้โค้ด production เอง"), so there's nothing to gate
there. Narrows Bash to an explicit allowlist instead of pre-approving
it wholesale via --allowedTools: task/comment content that triggers an
unattended run is attacker-adjacent (anyone with API access to the
Nexus project can write it), so a blanket "Bash: allow" is a materially
bigger blast radius than this list. Extend ALLOWED_BASH for this repo's
actual test tooling (a Python repo needs `pytest`, a Rails repo needs
`bundle exec rspec`, etc.) rather than loosening the pattern to match
anything.

Anything not matched here is explicitly denied with a reason fed back
to Claude, rather than left to hang on a prompt nobody will answer.
"""
import json
import re
import sys

ALLOWED_BASH = [
    r"^npm\s+(test|run)",
    r"^npx\s",
    r"^node\s",
    r"^pytest(\s|$)",
    r"^python3\s+-m\s+pytest",
    r"^curl\s+(https?://)?localhost",
    r"^curl\s+(https?://)?127\.0\.0\.1",
    r"^git\s",
    r"^ls(\s|$)",
    r"^cat\s",
]


def decide(decision, reason=None):
    out = {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": decision}}
    if reason:
        out["hookSpecificOutput"]["permissionDecisionReason"] = reason
    print(json.dumps(out))
    sys.exit(0)


data = json.load(sys.stdin)
tool = data.get("tool_name", "")
tool_input = data.get("tool_input", {})

if tool == "Bash":
    cmd = tool_input.get("command", "").strip()
    if any(re.match(pat, cmd) for pat in ALLOWED_BASH):
        decide("allow")
    else:
        decide("deny", f"command not in the unattended allowlist: {cmd!r} — expand preapprove.py's ALLOWED_BASH for this repo's test tooling if this should be allowed")

# Anything else (Read, Grep, Glob, Skill, MCP tools) — no decision here,
# normal flow applies (MCP tools are already covered by --allowedTools).
sys.exit(0)
