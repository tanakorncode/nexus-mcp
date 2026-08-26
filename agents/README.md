# agents/

Subagent templates, one per real Nexus RBAC role: `pm.md`, `ba.md`, `dev.md`, `qa.md` — copy-once seeds, same mechanism as `../frameworks/`, not live-shared.

Each one's `tools:` list and "สิทธิ์จริงในระบบ" section reflect what that role can actually do server-side (see `pm-system/src/lib/permissions.ts` — `task:create` is ADMIN/PM/BA only, `task:assign` is PM/ADMIN unrestricted but "owner"-scoped for DEV/QA), not just a convention written down and hoped for. If that permission matrix changes, these need updating to match — a stale "you can do X" here just means the agent tries it, gets a 403, and has to recover mid-task instead of knowing the boundary upfront.

All four assume `nexus-mcp` is connected and reference its two planning/consuming skills (`nexus-plan-work` for pm/ba, `nexus-pick-up-task` for dev/qa) rather than calling `create_task`/`update_task_status`/etc. directly — the skills carry the actual workflow (which fields to ask about, how to hand off, what to do when QA fails); these agent files are just "which role, which tools, which permission boundaries."

## Setting up a new repo

```bash
mkdir -p .claude/agents
cp ~/development/pea/claude-templates/agents/*.md .claude/agents/
```

Then, per repo:
- If the team splits frontend/backend, copy `dev.md` twice (e.g. `frontend-dev.md` / `backend-dev.md`) and narrow "หน้าที่" to each one's actual code area — see `demo-project-team/.claude/agents/` for a real example of that split, plus a `git-manager` role this template set doesn't include (that responsibility is folded into `dev.md`'s own PR step instead, but split it out if the team wants a dedicated git-hygiene role).
- Re-copy after pulling updates to this repo — no live sync, same as `frameworks/`.
