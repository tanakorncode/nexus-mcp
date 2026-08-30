# roles/

**Looking for how the roles actually hand off to each other — who does what, in what order?** See [`WORKFLOW.md`](WORKFLOW.md). This file is about installing them; that one's about the pipeline they run once installed.

One folder per real Nexus RBAC role (`pm`, `ba`, `dev`, `qa`) — copy-once seeds, same mechanism as `../frameworks/`, not live-shared. Each is a **complete, drop-in package**: the subagent definition plus every document-writing skill that role actually needs, laid out exactly the way [`demo-project-team`](https://github.com/tanakorncode) does it for real —

```
roles/<role>/.agents/
  agents/<role>.md        — the subagent definition (tools, permission notes, which skill to use)
  skills/<skill-name>/    — one folder per document that role produces
```

`.agents/` (not `.claude/`) on purpose — it's the tool-agnostic location both Claude Code and Antigravity IDE can read (see `nexus-mcp/README.md`'s editor-support table). `.claude/agents` and `.claude/skills` are meant to be **symlinks into `.agents/`**, not copies — that's what keeps both editors reading the exact same files with nothing to keep in sync by hand.

## Installing a role into a repo

Copy the role(s) you want, merging into the project's own `.agents/` (several roles share the same `agents/` and `skills/` folders once installed, so use `-r ... /. ...` to merge, not overwrite):

```bash
mkdir -p .agents
cp -r ~/development/pea/claude-templates/roles/ba/.agents/.  .agents/
cp -r ~/development/pea/claude-templates/roles/dev/.agents/. .agents/
cp -r ~/development/pea/claude-templates/roles/qa/.agents/.  .agents/
cp -r ~/development/pea/claude-templates/roles/pm/.agents/.  .agents/
```

**If this repo only uses Claude Code** (no Antigravity/other tool), symlink once so Claude Code picks the files up — do this the first time only, not per role:

```bash
mkdir -p .claude
ln -s ../.agents/agents .claude/agents
ln -s ../.agents/skills .claude/skills
ln -s ../.agents/hooks .claude/hooks
```

(If `.claude/agents`/`.claude/skills`/`.claude/hooks` already exist as real folders from before, move their contents into `.agents/` first, then replace them with the symlinks above — don't end up with both a real folder and a symlink fighting over the same name.)

**Don't skip the `.claude/hooks` symlink** even if you're not setting up unattended runs yet — every role's `settings.local.json.example` (see "รันแบบ unattended" in each role's own `.md`) hardcodes its hook command as `python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/preapprove.py"`. Without this symlink, that path never resolves — the hook silently fails to run, and every unattended `Write`/`Edit`/`Bash` call just hangs or gets denied with no indication why the preapprove step itself never fired. Confirmed this the hard way: a role installed with only the `agents`/`skills` symlinks (this doc's own instructions, before this note existed) hit exactly that — `git checkout` and every file write denied, because `.claude/hooks/preapprove.py` didn't exist despite `.agents/hooks/preapprove.py` being right there.

**Multiple roles sharing one repo**: `.agents/hooks/preapprove.py` and `.agents/hooks/settings.local.json.example` are filenames shared across every role's hooks folder (dev's and qa's are genuinely different scripts — qa's has no Write/Edit gating at all, since qa.md deliberately has no Write/Edit tool). Copying more than one role's `.agents/` into the same target with the merge command above means **whichever role you `cp -r` last silently overwrites the previous role's hook** — there is no warning, no conflict error. If you're installing multiple roles into one repo, check `.agents/hooks/preapprove.py` afterward to confirm it's actually the version you meant to end up with (e.g. `grep -l "the dev role" .agents/hooks/preapprove.py` should find it if dev's copy won).

Also install the two nexus-mcp workflow skills every role's `agents/*.md` assumes are there (see `../skills/`) — `nexus-plan-work` for pm/ba, `nexus-pick-up-task` for dev/qa — the same `.agents/skills/` target:

```bash
cp -r ~/development/pea/claude-templates/skills/nexus-plan-work    .agents/skills/
cp -r ~/development/pea/claude-templates/skills/nexus-pick-up-task .agents/skills/
```

Re-run all of the above after pulling updates to this repo — no live sync, same as `frameworks/` and `skills/`.

## Splitting `dev` further

`dev/` ships as one generic role. If the team splits frontend/backend, copy `roles/dev/.agents/agents/dev.md` twice (`frontend-dev.md` / `backend-dev.md`) and narrow each one's "หน้าที่" to its actual code area — `demo-project-team/.claude/agents/` (real repo, not a template) is a worked example of that split, plus a `git-manager` role this set doesn't include (PR opening is folded into `dev.md`'s own hand-off step instead — split it out if the team wants a dedicated git-hygiene role).

## Why a skill per document, not one giant "write docs" skill

Each skill is scoped to one artifact (a BRD, a sprint plan, a test case) because the failure modes are different per document — a BRD written like a user story skips the business "why," a bug report written like a test case buries the one field (actual vs. expected) that matters most. A single combined skill either gets too vague to be useful for any one document, or turns into an unreadable wall of conditional instructions. Cross-references between them (e.g. `write-user-story` pointing at `write-brd` for context, `write-bug-report` pointing back at `nexus-pick-up-task` for the hand-off mechanics) keep them from duplicating each other's content.
