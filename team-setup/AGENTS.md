# Project Standards & Multi-Agent Collaboration Framework

Read via `.claude/CLAUDE.md`, which symlinks here (see `../roles/README.md` for why `.agents/` and not `.claude/` directly) — this is the file Claude Code loads as project memory, and the same file Antigravity/other tools read at `.agents/AGENTS.md`.

#### 1. Project Overview & Architecture

- **Repository structure:** <describe it — monorepo/single service, main folders and what each contains>
- **Stack:** <language/framework — if this repo already has its own `CLAUDE.md` seeded from `../frameworks/`, point at it instead of repeating stack rules here; this file is about the team/roles, not the code style>
- **Target/goal:** <one or two lines on what this project is for>

#### 2. Language & Communication

<Project-specific — e.g. "respond in Thai always," "code comments in Thai, technical terms may stay in English." Pull from `../shared/pea-thailand-conventions.md` (`@import`) if this repo already does — don't duplicate it here, reference it.>

#### 3. Agent Roles & Team Structure

Team works through `.agents/skills/` (installed from `../roles/` — see `roles/README.md`). List whichever roles this repo actually installed, e.g.:

- **pm:** plans/creates epic-story-task breakdowns, assigns work, tracks progress — doesn't write code
- **ba:** writes requirement docs and detailed task specs — doesn't write code
- **dev** (or split `frontend-dev` / `backend-dev`): implements, tests, opens PRs
- **qa:** tests against acceptance criteria, reports back pass/fail

<Delete roles not installed in this repo; if `dev` was split, list each half with its actual code area.>

#### 4. Workflow Rules

1. **Nexus (MCP) is the task source of truth** — not any file in this repo. See `../TEAM-WORKFLOW.md` if this is a multi-person/team-mode repo for the full set of team-specific rules (branching, PR discipline, contract sharing) beyond this baseline.
2. <Any other project-specific rule that applies regardless of solo vs. team mode — destructive-command restrictions, a domain-specific compliance rule, etc.>
