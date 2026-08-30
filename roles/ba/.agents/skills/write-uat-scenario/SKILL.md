---
name: write-uat-scenario
description: Use when a BA needs to write User Acceptance Test scenarios before a feature goes to the actual business stakeholder for sign-off — e.g. "write UAT scenarios for X", "what should we check with the client before go-live". Distinct from QA's write-test-case — UAT checks the business need is met, not that the code works technically.
metadata:
  version: "1.0.0"
---

# Write UAT (User Acceptance Test) Scenarios

QA's `write-test-case` skill asks "does this work the way it was built to work" — UAT asks a different question: **"does this actually solve the business problem from the BRD"**. Same feature, different failure mode being checked for — QA catches a broken button, UAT catches a button that works perfectly but doesn't match what the business actually needed.

Written from the stakeholder's point of view, in language they'd use — not technical steps, not implementation detail.

## Document structure

For each scenario:

1. **Business scenario** — described the way the stakeholder would describe their own workflow, not as a technical action. "รับพนักงานใหม่เข้าระบบ" not "POST /employees with valid payload."
2. **Reference to the BRD objective/business rule it validates** — every UAT scenario should trace back to something in `write-brd`'s objective or business rules section. A scenario that doesn't map to anything in the BRD is either testing something out of scope, or a sign the BRD was incomplete — either way, worth surfacing rather than writing anyway.
3. **Expected outcome, in business terms** — "พนักงานได้รับอีเมลยืนยันภายใน 1 วัน" not "email service returns 200."
4. **Pass/fail — left blank**, filled in by the stakeholder during the actual UAT session, not by the BA in advance. Pre-filling this defeats the point of getting a real sign-off.

## Steps

1. **Pull the objective and business rules straight from the BRD** (`write-brd`) — don't write UAT scenarios from the task description alone, that's the builder's view of the work, not the business's.
2. **Cover the business rules specifically**, not just the main flow — a business rule ("must reject registrations from under-18") is exactly the kind of thing that's easy to build correctly and never explicitly check with the stakeholder before go-live.
3. **Write it as a file** — `docs/ba/uat-<short-name>.md` by default, since this gets walked through live with a stakeholder, not just read once. If `.agents/templates/UAT_SignOff_Template.docx` exists in this repo and a `docx`-editing skill is already installed and available in this session, fill that template in as a real `.docx` instead — a stakeholder sign-off is exactly the kind of document that's more credible as a real, printable/signable file than a markdown export. If the template exists but no `docx` skill is available, tell the person you're working with that a real `.docx` is possible if they install one — e.g. `npx skills add https://github.com/anthropics/skills --skill docx --agent claude-code` (Anthropic's own official skills repo; verified this command works as of this writing) — don't install it yourself unprompted, it's a new capability for their session, their call. Either way, the `.md` default is fine.
4. **Attach or link it to the relevant task(s) in Nexus** via `add_task_attachment` (if it exists as a file already) so whoever's coordinating go-live can find it from the task itself.

## What this skill does not do

Doesn't write technical test cases — that's QA's `write-test-case`, different audience and different thing being checked. Doesn't run the UAT session itself or record results — this skill produces the scenario document only; running it with the stakeholder is a separate, human step. Doesn't substitute for acceptance criteria on the task (`write-user-story`) — AC is what the builder checks while working, UAT is what the business checks before sign-off, and they can diverge if the BRD had nuance the task description simplified away.
