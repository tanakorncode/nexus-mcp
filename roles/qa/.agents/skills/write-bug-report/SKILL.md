---
name: write-bug-report
description: Use when a test case fails and it's time to report it back — e.g. "file a bug for X", "write up why this test failed". Content-quality companion to nexus-pick-up-task's hand-off step (comment + attach evidence + reassign) — this skill is what actually goes in that comment.
metadata:
  version: "1.0.0"
---

# Write a Bug Report

`nexus-pick-up-task`'s hand-off step already says what to do mechanically when a test fails: comment, attach evidence, change status, reassign back to whoever implemented it. This skill is what makes that comment actually useful to the person receiving it, instead of "doesn't work."

## Structure

```
Summary: <one line — what's broken>
Test case: <which one failed, if this came from write-test-case — link/ID>
Environment: <where this was observed — branch, staging vs local, browser/OS if relevant>
Steps to reproduce:
  1. <action>
  2. <action>
Expected: <what should have happened>
Actual: <what actually happened>
Evidence: <screenshot/log — attached via add_task_attachment, referenced here>
Severity: <blocks release / degrades a feature / cosmetic>
```

"Actual" is the part that's easiest to write badly — describe exactly what was observed (an error message verbatim, a wrong value shown), not an interpretation of the cause. "The API is probably timing out" is a guess about the fix; "the page hung for 30s then showed a blank screen" is what was actually seen. Let whoever fixes it draw the causal conclusion — they have the code in front of them, the report has the symptom.

## Steps

1. **Reproduce it a second time before reporting**, if at all possible — a bug report for something that turns out to be a one-off flake (a slow network blip, not a real defect) wastes the implementer's time chasing a ghost. If it won't reproduce, say that explicitly rather than reporting it as if it reliably does.
2. **Attach the actual evidence** — `add_task_attachment` for a screenshot or log file that already exists on this machine, not just a text description of what was seen if a visual would make it unambiguous.
3. **Set severity honestly**, the same discipline as `write-test-case`'s priority field — everything marked "blocks release" stops meaning anything once it's most of the reports.
4. **Follow through on the hand-off mechanics** — `nexus-pick-up-task` covers this: status back to whatever this project calls "needs rework," reassigned to the implementer, not just commented and left. A well-written report that nobody's assigned to see is still a bug that silently stalls.

## What this skill does not do

Doesn't decide the fix or guess at the root cause — that's the implementer's job, with the code in front of them; this skill's job is giving them an accurate, reproducible symptom to start from. Doesn't cover the mechanical hand-off steps (status change, reassignment) — see `nexus-pick-up-task`, this skill only covers what goes in the comment itself.
