---
name: nexus-consult-teammate
description: Use when stuck on a decision that's genuinely another role's call (a product/priority tradeoff for pm, a requirement/acceptance-criteria question for ba, a technical-feasibility question for dev, a testability/edge-case question for qa) — get a fast, same-session second opinion from that role instead of stopping to wait for a human or another independently-running agent to see a comment. Works whether you're running interactively or unattended (confirmed — see below). Not for questions needing information nobody's written down anywhere; see the boundary below before reaching for this.
metadata:
  version: "1.0.0"
---

# Consult a Teammate (in-session, via the Agent tool)

`nexus-pick-up-task`'s ambiguous-decision step (and similar steps in other roles' skills) has always had two options: ask a human if one's present, or `add_task_comment` and stop if not. Both assume the answer has to come from *outside this session*. This skill adds a third option that stays *inside* it: spawn the relevant role as a Claude Code subagent, right here, get its take, and keep going — no polling Nexus, no waiting for someone else's process to notice, no waiting for that role's own real account to be online at all.

This works for any pairing — dev asking pm, qa asking dev, pm asking ba, whatever the actual question calls for. It isn't a dev-specific mechanism.

## Confirmed: this works unattended too, not just interactively

An earlier version of this skill claimed headless `claude -p` runs (Agent App / Agent Supervisor App) weren't confirmed to support nested subagent spawning. That was tested directly and turned out to be wrong: a plain `claude -p --output-format json` run *can* spawn a named subagent via the `Agent`/`Task` tool and get its result back in the same process (`subagent_stats` in the JSON result confirms the spawn and completion). Use this skill the same way whether you were invoked interactively or unattended — don't special-case around a limitation that isn't real.

## Permission enforcement is automatic — you don't need to check anything for this

The subagent you spawn locally uses the *exact same* Nexus login as you — this machine's one nexus-mcp authentication, not a separate identity for whichever role persona is talking. So if you (say, logged in as a real dev-role account) spawn a `pm` subagent and it tries to actually call something like `create_epic`, that call is still authenticated as *your* real account server-side — pm-system's own RBAC (`requireRole`, keyed off the real caller's actual role, not any local label) will 403 it exactly as if you'd called it directly, regardless of which subagent persona initiated it. This is a real, enforced boundary, not a courtesy — you cannot get real PM authority by spawning a `pm`-flavored subagent locally.

What you *can* still get: **judgment**. The spawned subagent can reason about the situation the way that role would (using the same information already in Nexus/the repo, and that role's own documented decision criteria) and hand you back a recommendation — which you then act on using *your own* real, actual permissions. If your real account can't do what the recommendation implies, report that plainly ("pm's take was X, but I don't have permission to do X — here's what I can do / who needs to") rather than silently failing or pretending it worked.

## The hard boundary — read this before using it

The subagent you spawn has no knowledge beyond what's in Nexus (task description, comments, sibling tasks) and this repo — the same information *you* already have access to. It cannot supply a fact that only exists in a real person's head and was never written down (a customer commitment, a deadline nobody logged, a decision made in a hallway conversation). Use this to get a second, differently-angled *read* of information that already exists — not to manufacture information that doesn't.

If the spawned subagent's answer amounts to "I don't have enough to go on," treat that exactly as if you'd gotten no answer at all — fall back to asking a human or leaving a comment (`nexus-pick-up-task` step 7). Don't let a plausible-sounding guess dressed up as "pm says X" stand in for the real thing.

## Steps

1. **Form one specific, answerable question** — not "should I do this," but the actual decision point with the options on the table. A vague question gets a vague, unhelpfully-confident answer back.

2. **Spawn the role via the Agent tool** — `subagent_type` is the role's name (`pm`, `ba`, `dev`, or `qa`, matching that role's `.claude/agents/*.md`). In the prompt, include: the task id/key (so it can pull `get_task`/`list_task_comments` itself if it needs more than you're passing along), your specific question, and — explicitly — an instruction to say so plainly if it doesn't have enough information to answer with confidence, rather than guessing.

3. **Use the answer, or don't.** If it's a clear, confident take grounded in real information (the task's own acceptance criteria, an existing convention in the repo, a prior comment on the task), act on it and continue immediately, using your own real permissions to do so — see the permission section above if that recommendation implies an action you can't actually perform. If it hedges or admits uncertainty, treat it as no answer — escalate the normal way instead.

4. **Leave a trace either way.** `add_task_comment` a short note on what was asked and what was decided (e.g. "consulted pm sub-agent on X — decided to Y because Z") — whoever reviews this later, including the real PM, should be able to see a decision was made this way and why, not discover it silently in a diff. This is advisory input, not the real role exercising their actual authority — the comment makes that traceable.

## What this skill does not do

Doesn't replace a human's sign-off on anything genuinely high-stakes or irreversible — this is for keeping momentum on routine interpretive questions, not for a decision the team would want a real person accountable for. Doesn't grant permissions the real logged-in account doesn't actually have — see the permission section above; a locally-spawned persona is judgment, not delegated authority. Doesn't work across separate, independently-running sessions (a real PM's own machine, a different agent's own process) — that's what `nexus-consult-role` is for, when you specifically want a real person's real authority and durable, team-visible record rather than a fast local opinion. Doesn't apply to every ambiguity — most questions still just need `nexus-pick-up-task` step 7's existing path; reach for this specifically when the question is squarely another role's kind of judgment call.
