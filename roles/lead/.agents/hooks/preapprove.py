#!/usr/bin/env python3
"""PreToolUse hook for unattended runs (e.g. Agent App) of the dev role.

Agent App (or any wrapper spawning `claude -p` non-interactively, not
through the Agent SDK) has no one present to answer an interactive
permission prompt — and per the Claude Code hooks guide's Limitations
section, PermissionRequest doesn't even fire for a plain `-p` run;
PreToolUse is the hook event that actually works for this invocation
style. Without something like this, every Write/Edit/Bash call a dev
subagent makes just hangs or gets denied the moment it's triggered by
an unattended Nexus event.

This narrows Bash/Write/Edit to an explicit allowlist instead of
pre-approving the tools wholesale via --allowedTools: task/comment
content that triggers an unattended run is attacker-adjacent (anyone
with API access to the Nexus project can write it), so a blanket
"Bash: allow" is a materially bigger blast radius than this list.
Extend ALLOWED_BASH for this repo's actual toolchain (a Rails repo
needs `bundle`/`rails`, a Go repo needs `go`, etc.) rather than
loosening the pattern to match anything.

Anything not matched here is explicitly denied with a reason fed back
to Claude, rather than left to hang on a prompt nobody will answer.
"""
import json
import os
import re
import sys

ALLOWED_BASH = [
    r"^node\s",
    r"^nohup\s+node\s",
    r"^npm(\s|$)",
    r"^npx\s",
    r"^python3\s+-m\s+http\.server",
    r"^nohup\s+python3\s+-m\s+http\.server",
    r"^curl\s+(https?://)?localhost",
    r"^curl\s+(https?://)?127\.0\.0\.1",
    r"^git\s",
    r"^ls(\s|$)",
    r"^cat\s",
    r"^mkdir\s",
    r"^pkill\s+-f\s",
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
cwd = data.get("cwd", "")

if tool in ("Write", "Edit"):
    path = tool_input.get("file_path", "")
    abs_path = path if os.path.isabs(path) else os.path.abspath(os.path.join(cwd, path))
    abs_path = os.path.normpath(abs_path)
    abs_cwd = os.path.normpath(os.path.abspath(cwd))
    if ".env" in abs_path or f"{os.sep}.git{os.sep}" in abs_path or abs_path.endswith(".git"):
        decide("deny", f"protected path: {path}")
    elif abs_path == abs_cwd or abs_path.startswith(abs_cwd + os.sep):
        decide("allow")
    else:
        decide("deny", f"path outside the project working directory: {path}")

elif tool == "Bash":
    cmd = tool_input.get("command", "").strip()
    if any(re.match(pat, cmd) for pat in ALLOWED_BASH):
        decide("allow")
    else:
        decide("deny", f"command not in the unattended allowlist: {cmd!r} — expand preapprove.py's ALLOWED_BASH for this repo's toolchain if this should be allowed")

# Anything else (Read, Grep, Glob, Skill, MCP tools) — no decision here,
# normal flow applies (MCP tools are already covered by --allowedTools).
sys.exit(0)
