---
name: nexus-consult-teammate
description: Use when stuck on a decision that's genuinely another role's call (a product/priority tradeoff for pm, a requirement/acceptance-criteria question for ba) and you're running as a spawned Claude Code subagent yourself — get a fast, same-session second opinion instead of stopping to wait for a human or another independently-running agent to see a comment. Not for questions needing information nobody's written down anywhere; see the boundary below before reaching for this.
metadata:
  version: "1.0.0"
---

# Consult a Teammate (in-session, via the Agent tool)

`nexus-pick-up-task`'s ambiguous-decision step (and similar steps in other roles' skills) has always had two options: ask a human if one's present, or `add_task_comment` and stop if not. Both assume the answer has to come from *outside this session*. This skill adds a third option that stays *inside* it: spawn the relevant role as a Claude Code subagent, right here, get its take, and keep going — no polling Nexus, no waiting for someone else's process to notice.

## The hard boundary — read this before using it

The subagent you spawn has no knowledge beyond what's in Nexus (task description, comments, sibling tasks) and this repo — the same information *you* already have access to. It is not the real PM/BA and cannot supply a fact that only exists in a real person's head and was never written down (a customer commitment, a deadline nobody logged, a decision made in a hallway conversation). Use this to get a second, differently-angled *read* of information that already exists — not to manufacture information that doesn't.

If the spawned subagent's answer amounts to "I don't have enough to go on," treat that exactly as if you'd gotten no answer at all — fall back to asking a human or leaving a comment (`nexus-pick-up-task` step 7). Don't let a plausible-sounding guess dressed up as "pm says X" stand in for the real thing.

## Known limitation — check this actually fires before relying on it

This only works when *you yourself* are running as a spawned Claude Code subagent in an interactive-style session (the Agent tool nests up to 3 layers deep). It is **not confirmed to work** when you're the top-level process in a headless `claude -p` unattended run (e.g. spawned by Agent App / Agent Supervisor App) — that mode is not documented as supporting subagent spawning at all. If you're running unattended and the Agent tool isn't available or errors, don't retry it — go straight to the existing comment-and-wait path instead.

## Steps

1. **Form one specific, answerable question** — not "should I do this," but the actual decision point with the options on the table. A vague question gets a vague, unhelpfully-confident answer back.

2. **Spawn the role via the Agent tool** — `subagent_type` is the role's name (`pm` or `ba`, matching that role's `.claude/agents/*.md`). In the prompt, include: the task id/key (so it can pull `get_task`/`list_task_comments` itself if it needs more than you're passing along), your specific question, and — explicitly — an instruction to say so plainly if it doesn't have enough information to answer with confidence, rather than guessing.

3. **Use the answer, or don't.** If it's a clear, confident take grounded in real information (the task's own acceptance criteria, an existing convention in the repo, a prior comment on the task), act on it and continue immediately. If it hedges or admits uncertainty, treat it as no answer — escalate the normal way instead.

4. **Leave a trace either way.** `add_task_comment` a short note on what was asked and what was decided (e.g. "consulted pm sub-agent on X — decided to Y because Z") — whoever reviews this later, including the real PM, should be able to see a decision was made this way and why, not discover it silently in a diff. This is advisory input, not the real role exercising their actual authority — the comment makes that traceable.

## What this skill does not do

Doesn't replace a human's sign-off on anything genuinely high-stakes or irreversible — this is for keeping momentum on routine interpretive questions, not for a decision the team would want a real person accountable for. Doesn't work across separate, independently-running sessions (a real PM's own machine, a different agent's own process) — that's a different problem with a different answer, still `add_task_comment`/hand-off for now. Doesn't apply to every ambiguity — most questions still just need `nexus-pick-up-task` step 7's existing path; reach for this specifically when the question is squarely another role's kind of judgment call.
