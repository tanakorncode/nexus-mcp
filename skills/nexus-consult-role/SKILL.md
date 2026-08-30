---
name: nexus-consult-role
description: Use when stuck on a decision that's genuinely another role's call (pm for priority/scope, ba for requirement/acceptance-criteria) and you're running as your own independent process (Agent App, or any unattended `claude -p` run) — not a spawned Claude Code subagent, so `nexus-consult-teammate`'s in-session Agent-tool approach isn't available. Reassigns the task to trigger the other role's own automation, if they're running it; degrades safely to today's async hand-off if they're not.
metadata:
  version: "1.0.0"
---

# Consult a Role (cross-process, via task reassignment)

`nexus-consult-teammate` answers this same kind of question by spawning the other role as a subagent in the same session — but that only works when *you yourself* are a spawned subagent. Most real runs aren't: Agent App and Agent Supervisor App both run each role as its own independent `claude -p` process, possibly on a different machine, with no shared session to spawn into. This skill is the cross-process version — same idea (ask, get an answer, keep moving), different mechanism (Nexus, not the Agent tool).

## Why this works without any new infrastructure

`nexus-pick-up-task` step 11 already says a hand-off moves status *and* assignment together, not just one — because pm-system only fires a routable event when the **status** field actually changes (a same-value status update fires nothing at all, confirmed by reading the actual route). That's the entire mechanism this skill relies on: reassigning to someone with a status change is what makes their own Agent App notice and automatically pick the task up, the same way any other hand-off does. A consult is just that same hand-off, done twice in a row — once to ask, once for them to answer back.

## Steps

1. **Resolve who to ask.** Call `list_members({ projectId, role: ["PM"] })` (or `["BA"]`) — `role` here is the project's actual RBAC role, not the cosmetic job title `displayRole` shows elsewhere. If it comes back empty, nobody on this project currently holds that role — stop and tell the user, don't guess at a name. If more than one match, ask which one rather than picking the first. **Consulting ba specifically**: the automated round-trip only fully works for pm — ba can answer but can't reassign the task back to you (real permission boundary, see below), so expect this to end with the task sitting on ba with an answer and a request for a pm to move it back, not a clean automatic return to you.

2. **Form one specific, answerable question** — not "should I do this," the actual decision with the options on the table. `add_task_comment` it, **starting the comment with the literal marker `[CONSULT]`** — this is what lets the other role's own skill tell "answer this quickly and hand back" apart from "this is a new task assigned to me for real." Nothing else distinguishes the two.

3. **Pick a status meaning "blocked / needs input"** via `list_statuses` (name varies by project — check, don't assume "Blocked" exists verbatim).

4. **Reassign and change status in the same call**: `update_task(taskId, { assigneeId: resolvedMemberId, status: thatStatusName })`. Both fields in one call, not two separate ones — that's what fires the event that (if their Agent App is running) triggers their pickup automatically.

5. **Stop here — don't poll.** Your part of this task is done for now. End cleanly the way any other hand-off ends (this is a real reassignment, not a fake one — you are no longer the assignee, and won't be able to act on this task again until it comes back to you).

6. **When it comes back** (reassigned to you again, with a new comment answering the `[CONSULT]` question), your next pickup of this task via `nexus-pick-up-task` step 3 reads it like any other comment. No special handling needed there — just don't skip reading comments.

## Answering an incoming `[CONSULT]` (the pm/ba side of this)

If a task lands on you and its latest comment starts with `[CONSULT]`, this is not a new task to plan around — don't run `nexus-plan-work` on it. Read the question, answer it via `add_task_comment` (grounded in what's actually in Nexus/the repo — see the honesty boundary below).

**The hand-back step differs by role — this is a real permission boundary, not a choice:**
- **pm**: `task:assign` is `"true"` — hand back directly: `update_task(taskId, { assigneeId: originalAskerMemberId, status: whateverMeansBackToThem })`, same status+assignee-together pattern as the ask.
- **ba**: `task:assign` is `"false"` (confirmed against the real permission matrix, `src/lib/permissions.ts` — not `add_task_assignee` alone, the primary `assigneeId` reassignment itself is blocked). BA can answer the question but **cannot complete the hand-back itself** — `update_task(taskId, { assigneeId })` will 403 regardless of who currently owns the task. After answering, `add_task_comment` again asking a pm/admin to reassign it back to the original asker. This is not fully automated for ba — treat the round-trip as "answer promptly, but the hand-back still needs a human/pm in the loop," and say so plainly rather than silently retrying a call that will keep failing.

## The honesty boundary — same one `nexus-consult-teammate` has

You only know what's in Nexus and the repo — same information the asker already had access to. You can't supply a fact that only exists in a real person's head and was never written down. If you genuinely don't have enough to answer with confidence, say so plainly in the comment rather than guessing — an uncertain answer dressed up as authoritative is worse than no answer.

## Known limitation — read before relying on this for anything time-sensitive

This only reaches someone whose **own per-person Agent App** is currently running and connected. It does **not** reach Agent Supervisor App (that watches only *unassigned* ready tasks — a task reassigned to a specific named person, which this is, will never match its poll filter). If the target's Agent App isn't running when you reassign, nothing is lost — the task still carries the durable comment and status, and the existing comment notification (email/LINE) still fires — but there's no guaranteed fast turnaround, and it degrades to exactly today's async wait.

**If nobody answers at all** (the target is on leave, no backup, nobody happens to check) — pm-system runs an hourly cron job (`runConsultEscalationCheck`, `src/lib/cron.ts`) that auto-reassigns any task whose *latest* comment is still an unanswered `[CONSULT]` older than 24h to a project admin, with an `[ESCALATED]` comment explaining why, using this exact same comment+reassign pattern (so it rides the same event/notification path). This caps at one hop — if the admin it escalated to also doesn't answer, it won't keep re-escalating hourly forever; a human needs to notice from there (existing overdue/workload reports already surface long-stuck tasks). This is a safety net, not a fast path — don't rely on it for anything that can't wait 24h.

**Before relying on this in your org**: check that "PM"/"BA" are actually assigned as real per-project or global roles to real people (via the Roles admin UI in pm-system) — `list_members({ projectId, role: [...] })` returning empty doesn't necessarily mean something's broken, it may genuinely mean nobody's been assigned that role yet.

## What this skill does not do

Doesn't replace a human's sign-off on anything genuinely high-stakes or irreversible. Doesn't apply to every ambiguity — most questions still just need `nexus-pick-up-task` step 7's existing path. Doesn't work faster than the target's own Agent App can spin up a fresh `claude -p` run — this is "faster than waiting for someone to happen to check Nexus," not instant.
