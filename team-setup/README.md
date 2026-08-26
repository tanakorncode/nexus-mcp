# team-setup/

The project-level scaffold `roles/` doesn't cover — `roles/<role>/` gives you the agents and skills, this gives you the files that tie them into one working repo: `AGENTS.md` (project memory, what Claude Code actually loads), `TEAM-WORKFLOW.md` (the rules specific to more than one person/agent working here at once), and the settings that wire hooks/env vars per-repo vs. per-person. Modeled on `demo-project-team`'s real setup, generalized.

## Install (once per repo, after installing at least one role from `../roles/`)

```bash
# AGENTS.md — becomes .agents/AGENTS.md, symlinked to .claude/CLAUDE.md
cp ~/development/pea/claude-templates/team-setup/AGENTS.md .agents/AGENTS.md
ln -s ../.agents/AGENTS.md .claude/CLAUDE.md

# Team workflow rules — repo root, not symlinked (nothing else needs to read it via .agents/)
cp ~/development/pea/claude-templates/team-setup/TEAM-WORKFLOW.md ./TEAM-WORKFLOW.md

# Team-shared settings (commit this one)
cp ~/development/pea/claude-templates/team-setup/settings.json.example .claude/settings.json

# Your own personal settings (never commit this one)
cp ~/development/pea/claude-templates/team-setup/settings.local.json.example .claude/settings.local.json
echo ".claude/settings.local.json" >> .gitignore
```

Then **edit `.agents/AGENTS.md`** — it's a copy-once seed like `../frameworks/*/CLAUDE.md`, full of `<placeholder>` sections (repo structure, stack, which roles from `roles/` this repo actually installed, language convention — pull that one from `../shared/pea-thailand-conventions.md` via `@import` if this repo already does, don't duplicate it here).

If this repo is genuinely solo (one person, no team-mode coordination needed), skip `TEAM-WORKFLOW.md` and the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` env var — `AGENTS.md` alone still applies.

## Hooks (optional)

Not part of the base install — see `hooks/README.md`. The example hooks are macOS-only audio notifications; skip them or swap the underlying command if the team isn't all on macOS.

## Why `AGENTS.md` isn't just each role's own file

Each `roles/<role>/.agents/agents/<role>.md` is scoped to *that role's* job — what it does, what it's allowed to call, which skill to use. `AGENTS.md` is the one level up: what's true for the whole repo regardless of which role is reading it (stack, language, the full roster of who's on this project) — the same split `demo-project-team` uses between its per-agent files and its own `AGENTS.md`.
