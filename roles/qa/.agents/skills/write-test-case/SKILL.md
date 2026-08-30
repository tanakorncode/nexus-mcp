---
name: write-test-case
description: Use when writing the actual step-by-step test cases for a task, once a test plan (if one exists) has set scope — e.g. "write test cases for X". The day-to-day granular artifact, distinct from write-test-plan (scope/approach) and BA's write-uat-scenario (business-facing sign-off).
metadata:
  version: "1.0.0"
---

# Write a Test Case

The concrete, repeatable artifact — precise enough that someone other than the person who wrote it (or the same person, a week later) can execute it the same way and get a comparable result.

## Format

```
ID: <short identifier>
Title: <what this verifies, in one line>
Preconditions: <state required before starting — logged in as X, data Y exists>
Steps:
  1. <action>
  2. <action>
  ...
Expected result: <what should happen — specific, not "it works">
Priority: P0/P1/P2 (blocks release / should fix / nice to have)
```

Write from the source of truth for what "correct" means: the task's acceptance criteria (`write-user-story`'s output) if they exist, plus the risk areas from `write-test-plan` if one was written for this round. Don't invent expected behavior that isn't grounded in either — if the AC doesn't say, ask rather than assume, the same rule every other skill in this set follows.

## Steps

1. **One test case per distinct behavior**, not one giant case covering the whole feature — a single case that fails partway through only tells you *something* broke, not *what*.
2. **Cover the negative/edge cases from the AC explicitly**, not just the happy path — an empty input, a duplicate, a permission boundary. If the AC listed edge cases (it should have, per `write-user-story`), each one gets its own test case.
3. **Set priority honestly** — not everything is P0. Overusing P0 makes exit criteria meaningless, since "all P0 cases pass" stops distinguishing a genuinely release-blocking gap from routine coverage.
4. **Save as `docs/qa/test-cases-<short-name>.md`** by default. If `.agents/templates/Test_Case_Template.xlsx` exists in this repo (sheets: คำแนะนำ, Test Cases, Summary, Defect Log) and an `xlsx`-editing skill is already installed and available in this session, fill that template in as a real `.xlsx` instead — it's the format the team already reviews this in, not a second system competing with it. If the template exists but no `xlsx` skill is available, tell the person you're working with that a real `.xlsx` is possible if they install one — e.g. `npx skills add https://github.com/anthropics/skills --skill xlsx --agent claude-code` (Anthropic's own official skills repo; verified this command works as of this writing) — don't install it yourself unprompted, it's a new capability for their session, their call. Either way, the `.md` default is a fine fallback, not a failure. Reference the result from the task via `add_task_comment`.
5. **Run them and record actual results** before reporting pass/fail on the task — this skill produces the case, `nexus-pick-up-task`'s hand-off step covers what to do with the outcome (pass → status update; fail → `write-bug-report` + reassign).

## What this skill does not do

Doesn't set overall scope or call out risk areas — that's `write-test-plan`, done first. Doesn't check the business need is actually met, in the stakeholder's own terms — that's BA's `write-uat-scenario`, a different audience and a different question than "does this function correctly." Doesn't write up a bug for a failed case — see `write-bug-report`.
