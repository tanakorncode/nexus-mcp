# วิธีติดตั้ง — Nexus Multi-Agent Team

คู่มือนี้สำหรับทีมที่จะใช้ subagent 4 role (`pm`/`ba`/`dev`/`qa`) จาก [`roles/`](roles/) และ skill เอกสารต่างๆ ที่ผูกกับ Nexus (MCP) ผ่าน [`nexus-mcp`](https://github.com/tanakorncode/nexus-mcp)

แบ่งเป็น 3 ส่วน — **ไม่ใช่ทุกคนต้องทำครบทุกส่วน** อ่านหัวข้อให้ตรงกับบทบาทตัวเอง

---

## ส่วนที่ 1 — ทำครั้งเดียวต่อคน (ทุกคนต้องทำ)

ผูกกับตัวคน/เครื่องคุณเอง ไม่เกี่ยวกับว่าทำงาน repo ไหน

```bash
# 1. login เข้า Nexus (เปิด browser ให้ล็อกอินครั้งเดียว เก็บ token ใน OS keychain)
npx -y -p github:tanakorncode/nexus-mcp nexus-mcp-login

# 2. ติดตั้ง nexus-mcp เป็น plugin — ได้ MCP server + skill nexus-plan-work/nexus-pick-up-task มาด้วยในตัวเดียว
claude plugin marketplace add tanakorncode/nexus-mcp
claude plugin install nexus-mcp@nexus-mcp-marketplace

# 3. reload Claude Code (ปิดเปิดหน้าต่างใหม่ หรือ restart session)
```

เช็คว่าเสร็จ: ถาม Claude ว่า `whoami` — ต้องรู้จักชื่อคุณ และ `/skills` ต้องเห็น `nexus-plan-work`/`nexus-pick-up-task`

---

## ส่วนที่ 2 — ทำครั้งเดียวต่อ repo (คนตั้ง repo ทำ แล้ว commit เข้า git)

ทำครั้งเดียวโดยใครก็ได้คนหนึ่งในทีม แล้ว **commit เข้า git** — หลังจากนั้นคนอื่นไม่ต้องทำซ้ำ (ดูส่วนที่ 3)

```bash
cd path/to/your-repo

# clone claude-templates มาก่อน (ใช้ path ชั่วคราว ไม่ต้องเก็บไว้ถาวร)
git clone --depth 1 https://github.com/tanakorncode/claude-templates /tmp/claude-templates

# ติดตั้ง role ที่ทีมมี (เลือกเฉพาะที่ใช้จริงก็ได้ ไม่ต้องครบ 4 role)
mkdir -p .agents
cp -r /tmp/claude-templates/roles/pm/.agents/.  .agents/
cp -r /tmp/claude-templates/roles/ba/.agents/.  .agents/
cp -r /tmp/claude-templates/roles/dev/.agents/. .agents/
cp -r /tmp/claude-templates/roles/qa/.agents/.  .agents/

# ติดตั้ง skill หลัก 2 ตัวเข้า repo ด้วย (ไม่บังคับถ้าติดตั้ง nexus-mcp plugin ไว้แล้วในส่วนที่ 1 — ใส่ไว้ให้ชัวร์เผื่อคนอื่นยังไม่ได้ติดตั้ง)
cp -r /tmp/claude-templates/skills/nexus-plan-work    .agents/skills/
cp -r /tmp/claude-templates/skills/nexus-pick-up-task .agents/skills/

# symlink ให้ Claude Code มองเห็น (ทำครั้งเดียว ไม่ใช่ต่อ role)
mkdir -p .claude
ln -s ../.agents/agents .claude/agents
ln -s ../.agents/skills .claude/skills

# ตั้งค่าระดับ repo (AGENTS.md, TEAM-WORKFLOW.md, settings)
cp /tmp/claude-templates/team-setup/AGENTS.md .agents/AGENTS.md
ln -s ../.agents/AGENTS.md .claude/CLAUDE.md
cp /tmp/claude-templates/team-setup/TEAM-WORKFLOW.md ./TEAM-WORKFLOW.md
cp /tmp/claude-templates/team-setup/settings.json.example .claude/settings.json
cp /tmp/claude-templates/team-setup/settings.local.json.example .claude/settings.local.json
echo ".claude/settings.local.json" >> .gitignore
```

**สำคัญ**: เปิด `.agents/AGENTS.md` แก้ `<placeholder>` ให้ตรงกับ repo จริง (โครงสร้าง, stack, role ที่ติดตั้งจริง)

```bash
git add .agents .claude/agents .claude/skills .claude/CLAUDE.md TEAM-WORKFLOW.md .claude/settings.json .gitignore
git commit -m "chore: set up multi-agent roles + Nexus workflow"
git push
```

> **ทีมที่มีคน Windows**: symlink ใน git อาจมีปัญหาถ้าไม่เปิด `core.symlinks=true` (ต้องสิทธิ์ admin/developer mode) — ถ้าเจอปัญหา ใช้ `cp -r` แทน `ln -s` ได้เลย (แค่ต้อง sync มือเองถ้าไฟล์ต้นทางอัปเดต)

---

## ส่วนที่ 3 — คนอื่นในทีม

**แค่ `git pull`** — ทุกอย่างอยู่ใน repo แล้วจากส่วนที่ 2 (symlink ก็ commit ไปด้วย) เปิด Claude Code ใน repo นี้ก็เห็น agent/skill ครบทันที ไม่ต้อง copy อะไรเองเลย **ทำแค่ส่วนที่ 1 พอ** (login คนละครั้ง)

---

## ทางเลือกเสริม — Agent App (auto-run เมื่อมีงานมอบให้ใน Nexus)

สามส่วนด้านบนคือการติดตั้ง subagent role ให้ Claude Code — คุณยังต้อง**เปิด Claude Code เองแล้วเรียก role เอง** ทุกครั้ง

**Agent App** เป็นคนละเรื่อง และไม่เกี่ยวกับ git เลย: desktop app (ไอคอนอยู่ tray/menu bar) ที่ฟังอีเวนต์จาก Nexus แล้ว spawn AI CLI (เช่น `claude`) ให้อัตโนมัติทันทีที่มีงานมอบให้คุณ — ไม่ต้อง poll เองว่าเป็นตาเราหรือยัง **เป็น opt-in สำหรับ dev เท่านั้น** (pm/ba มี email แจ้งเตือนอยู่แล้ว ไม่จำเป็นต้องติดตั้งตัวนี้) ใช้แทนหรือใช้ร่วมกับการเรียก role มือก็ได้

**ติดตั้ง (ไม่ต้องรู้ Node.js/npm เลย):**
1. โหลดตัวติดตั้งของ OS ตัวเอง (`.dmg` ของ Mac / `.exe` ของ Windows) จากที่ทีมแจก
2. เปิด/รันตามปกติของ OS
3. เปิดครั้งแรก แอปจะพาไปหน้า **Settings** อัตโนมัติ — เข้าสู่ระบบ Nexus (login แยกจาก `nexus-mcp-login` ในส่วนที่ 1 นะ ต้อง login อีกรอบ), เลือก AI CLI ที่จะใช้ (Claude Code / Codex / Gemini CLI / กำหนดเอง), แมปโฟลเดอร์โปรเจกต์แต่ละ repo ที่ทำงานด้วย
4. กด **Test** เช็คว่า command รันได้ก่อน แล้ว **Save** — จากนี้แอปจะ start ตอนเปิดเครื่องเองอัตโนมัติ

ปิดการทำงานชั่วคราวได้จาก tray menu (**Enabled**) โดยไม่หลุดการเชื่อมต่อ รายละเอียดเต็ม (auth, ความปลอดภัยของ command ที่รัน, การ build) ดูที่ [`agent-app/README.md`](https://github.com/tanakorncode/nexus-mcp/blob/main/agent-app/README.md)

---

## โครงสร้างไฟล์

**ใน `claude-templates` (repo ต้นทางที่ copy จาก ส่วนที่ 2):**

```
claude-templates/
├── roles/<role>/.agents/
│   ├── agents/<role>.md        — นิยาม subagent (สิทธิ์, tools ที่เรียกได้, ใช้ skill ไหน)
│   └── skills/<skill-name>/    — 1 โฟลเดอร์ต่อ 1 เอกสารที่ role นั้นต้องเขียน
├── skills/                     — skill หลัก ผูกกับ Nexus โดยตรง (nexus-plan-work, nexus-pick-up-task)
├── team-setup/                 — AGENTS.md, TEAM-WORKFLOW.md, settings ระดับ repo
├── shared/                     — convention กลาง (@import เข้า CLAUDE.md ของแต่ละ repo)
└── frameworks/<stack>/         — CLAUDE.md ตั้งต้นต่อ stack (NestJS, Next.js, ...)
```

**ใน repo ของทีม หลังติดตั้งส่วนที่ 2 เสร็จ:**

```
your-repo/
├── .agents/                    — ที่เก็บจริง เป็น tool-agnostic (Claude Code + Antigravity อ่านไฟล์ชุดเดียวกัน)
│   ├── AGENTS.md                 — project memory ระดับ repo (stack, role ที่ติดตั้งจริง)
│   ├── agents/<role>.md          — copy มาจาก roles/<role>/
│   └── skills/<skill-name>/      — รวมของ roles/ และ skills/ เข้าด้วยกัน
├── .claude/
│   ├── agents      → symlink ไป ../.agents/agents
│   ├── skills      → symlink ไป ../.agents/skills
│   ├── CLAUDE.md   → symlink ไป ../.agents/AGENTS.md
│   ├── settings.json            — ค่ากลางของทีม (commit เข้า git)
│   └── settings.local.json      — ค่าส่วนตัว (gitignore ไว้แล้ว)
└── TEAM-WORKFLOW.md            — กติกา branch/PR/task tracking ของทีม
```

---

## วิธีเรียกใช้แต่ละ role

**เรียกตรงๆ (การันตีว่าถูกตัว)**
```
@agent-pm ช่วยวางแผน sprint หน้าให้หน่อย
@agent-ba เขียน BRD ให้ feature ล็อกอิน
@agent-dev หยิบงาน PEA-T050 มาทำ
@agent-qa เทส task ที่ dev ส่งมาให้หน่อย
```

**พิมพ์ปกติ** — Claude เทียบคำขอกับ `description` ของแต่ละ agent แล้วเลือกเรียกให้เองถ้าตรง แต่ไม่การันตี 100% ว่าจะเลือกถูก — ถ้าอยากชัวร์ใช้ `@agent-` แบบข้างบน

**เปิด terminal เป็น role นั้นทั้ง session** — รันคำสั่งนี้เองในแต่ละหน้าต่าง (ดู [รันหลาย role พร้อมกัน](#รันหลาย-role-พร้อมกัน-tmux--agent-teams) ด้านล่างถ้าจะรันหลาย role พร้อมกันจริงจัง)
```bash
claude --agent pm
```

| Role | ตัวอย่างคำสั่ง | ใช้ skill |
|---|---|---|
| pm | วางแผน sprint / เขียน status report | `write-sprint-plan`, `write-status-report` |
| ba | เขียน BRD / user story / UAT scenario | `write-brd`, `write-user-story`, `write-uat-scenario` |
| dev | หยิบ task มาทำ / เขียน design doc / API contract | `nexus-pick-up-task`, `write-tech-design-doc`, `write-api-contract` |
| qa | เทส task / เขียน test plan / bug report | `nexus-pick-up-task`, `write-test-plan`, `write-test-case`, `write-bug-report` |

---

## รันหลาย role พร้อมกัน (tmux / Agent Teams)

**วิธีที่ 1 — เปิดเองทีละ pane (แนะนำเริ่มต้น)**

เปิด terminal/tmux pane แยกต่อ role แล้วรัน `claude --agent <role>` เองในแต่ละอัน — **tmux ไม่ใช่ฟีเจอร์ของ Claude Code** เป็นแค่เครื่องมือแยกหน้าจอที่คนส่วนใหญ่ใช้คู่กันเฉยๆ (จะใช้ terminal tab ธรรมดา หรือเปิดหลายหน้าต่างก็ได้ผลเหมือนกัน) role ต้องมีอยู่ใน `.claude/agents/` ก่อนแล้ว (มาจากส่วนที่ 2)

```bash
# ตัวอย่าง: เปิด 4 pane ด้วย tmux เอง — ไม่มีคำสั่งพิเศษจาก Claude Code
tmux new-session -s nexus \; \
  send-keys 'claude --agent pm' C-m \; \
  split-window -h 'claude --agent dev' \; \
  split-window -v 'claude --agent qa' \; \
  select-pane -t 0 \; split-window -v 'claude --agent ba'
```

รันหลาย session พร้อมกันแบบนี้บน repo เดียวกัน **ต้องแยก [git worktree](https://code.claude.com/docs/en/worktrees) ต่อ branch** ด้วย (ดูกติกาใน Workflow ด้านล่าง) — ใช้ working tree เดียวกันสอง session แก้ไฟล์ชนกันแน่นอน

**วิธีที่ 2 — ให้ Claude spawn agent ให้เอง (Agent Teams, experimental)**

**เปิดใช้งาน** — ใส่ env var ใน `~/.claude/settings.json` (อยู่ถาวรกว่า `export` ใน shell profile):
```json
{
  "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }
}
```

**วิธีใช้ — ไม่มี syntax ตายตัว พิมพ์บอกเป็นภาษาธรรมดา** สิ่งสำคัญที่สุดคือ **อ้าง agent type ที่นิยามไว้แล้วใน `.claude/agents/` ได้ตรงๆ** (pm/ba/dev/qa จากส่วนที่ 2) ไม่ต้องผูกกับชื่อเฉพาะที่ตายตัว เช่น:

```
Spawn 4 teammates: ใช้ dev agent สอง teammate ทำ backend-dev กับ frontend-dev
คู่กันสำหรับ PEA-T050, ใช้ ba agent เขียน user story ให้ feature login,
และใช้ qa agent เตรียม test plan รอ
```

Claude จะ spawn ตาม role ที่นิยามไว้จริงใน `.agents/agents/<role>.md` — `tools:` allowlist และสิทธิ์ต่างๆ ที่ตั้งไว้ยังบังคับใช้เหมือนเดิม ไม่ใช่สร้าง agent ใหม่ลอยๆ ที่ไม่มีขอบเขต

**ดู/คุยกับ teammate ที่ spawn แล้ว**:
- **in-process mode** (ค่าเริ่มต้น): กด ↑/↓ เลือก teammate ใน agent panel ใต้ prompt, Enter เพื่อดู/คุยกับตัวนั้น, `x` เพื่อหยุด, Ctrl+T สลับดู shared task list
- **split-pane mode** (`tmux`/`iterm2`/`auto`): คลิกเข้า pane ของ teammate นั้นได้ตรงๆ

**โหมดแยกจอ** — setting `teammateMode` ใน `settings.json`: `"in-process"` (ค่าเริ่มต้น ไม่แยกหน้าต่าง), `"auto"` (แยก pane อัตโนมัติถ้าอยู่ใน tmux/iTerm2 อยู่แล้ว), `"tmux"` (บังคับแยก pane ด้วย tmux), `"iterm2"` (ใช้ pane ของ iTerm2 เอง ต้องมี `it2` CLI) — เป็นของ**ส่วนตัว** ใส่ไว้ใน `.claude/settings.local.json` ไม่ใช่ `settings.json` ของทีม (ดู [`team-setup/TEAM-WORKFLOW.md`](team-setup/TEAM-WORKFLOW.md) ข้อ 5)

**ไม่มี**วิธี spawn agent จาก script/ระบบภายนอกอัตโนมัติทั้งสองวิธี — ต้องมีคนสั่งเริ่ม session เองเสมอ (พิมพ์คำสั่งเอง หรือคุยบอกงานเอง)

---

## Workflow เต็มรอบ — จาก plan ถึง merge

**ก่อนเริ่ม (ไม่บังคับ)** — **ba** เขียน BRD (`write-brd`) ถ้าเป็นฟีเจอร์ใหม่ที่ยังไม่มีใครวิเคราะห์ สรุปว่าทำไมต้องทำ ใครเกี่ยวข้อง ข้ามได้ถ้าเป็นแค่ bug fix เล็กๆ — เป็น input ให้ข้อ 1 ด้านล่าง **ไม่ใช่ขั้นตอนบังคับก่อนเริ่มงาน**

1. **pm/ba** เรียก skill `nexus-plan-work` แตกเป็น epic → story → task พร้อม assign คนและ `repositoryId` ให้ครบทุก field ตั้งแต่ต้น (field ที่ขาดตอนสร้าง แก้ทีหลังยาก) — **จุดเริ่มงานจริงในระบบ**, ไม่ใช่ BRD
2. **dev** เรียก skill `nexus-pick-up-task` หยิบ task ที่ได้รับมอบหมาย → เปิด branch ใหม่ (`<type>/<nexus-task-key>-<short-desc>`) → implement → เปิด PR (ไม่ push ตรง `main`/`master` เด็ดขาด)
3. **qa** เรียก skill `nexus-pick-up-task` เทส task ที่ dev ส่งมา — **ผ่าน**: รอคนอื่น approve PR แล้ว merge (ห้าม merge เอง) จากนั้นอัปเดต status ใน Nexus ให้ตรงกับที่ merge จริง — **ไม่ผ่าน**: comment สิ่งที่พังพร้อม attach evidence, ปรับ status กลับเป็น "needs rework", reassign กลับ dev แล้ววนกลับข้อ 2

**Agent App** (ด้านบน) เป็นอีกทางที่ dev/qa ใช้ trigger ข้อ 2-3 อัตโนมัติ — spawn skill/CLI ให้เองทันทีที่ task ถูกมอบหมาย แทนที่จะต้องเปิด Claude Code มาเรียกเอง

กติกาเสริมที่ต้องรู้ (รายละเอียดเต็มที่ [`team-setup/TEAM-WORKFLOW.md`](team-setup/TEAM-WORKFLOW.md)):
- รันหลาย session พร้อมกันในคนละ role บน repo เดียวกัน ต้องแยก [git worktree](https://code.claude.com/docs/en/worktrees) ต่อ branch — ใช้ working tree เดียวกันชนกันแน่นอน
- dev เปลี่ยน API contract ต้อง `add_task_comment` ทั้ง task ตัวเองและ task พี่น้อง (หาได้จาก `list_story_tasks`) ไม่ใช่บอกกันแค่ในแชท

---

## สิทธิ์จริงของแต่ละ role (บังคับจริงฝั่ง server ไม่ใช่แค่ convention)

| สิทธิ์ | pm | ba | dev | qa |
|---|:-:|:-:|:-:|:-:|
| สร้าง task ใหม่ | ✓ | ✓ | ✗ | ✗ |
| มอบหมายงานให้ใครก็ได้ | ✓ | ✗ | เฉพาะที่ตัวเองถืออยู่ | เฉพาะที่ตัวเองถืออยู่ |
| แก้/เปลี่ยน status task | ✓ | เฉพาะที่ตัวเองถืออยู่ | เฉพาะที่ตัวเองถืออยู่ | เฉพาะที่ตัวเองถืออยู่ |

ถ้าเจอ error 403 ตอนเรียก tool — นั่นคือ permission boundary จริง ไม่ใช่บั๊ก บอก agent ตรงๆ ว่าทำไม่ได้ แล้วขอให้ pm/dev (แล้วแต่กรณี) เป็นคนทำแทน ไม่ต้องลองซ้ำ

---

## เพิ่ม skill ใหม่

1. **เลือกที่เก็บ**: ผูกกับ role เดียว (เช่น dev อยากมีเอกสารแบบใหม่) → ใส่ตรง `.agents/skills/<skill-name>/` ใน repo นี้เลย (หรือใน `roles/<role>/.agents/skills/` ที่ `claude-templates` ถ้าอยากให้ repo อื่นใช้ซ้ำได้ด้วย) — ผูกกับ PM tool ตรงๆ (เรียก MCP tool เฉพาะของ Nexus) → ใส่ระดับบนสุดคู่กับ `nexus-plan-work`/`nexus-pick-up-task`
2. สร้างโฟลเดอร์ + ไฟล์:
   ```bash
   mkdir -p .agents/skills/<skill-name>
   ```
3. เขียน frontmatter ให้ครบใน `SKILL.md` — Claude ใช้ `description` ตัดสินใจว่าจะเรียก skill นี้เมื่อไหร่ ต้องเจาะจงและมีตัวอย่างประโยคจริงประกอบ ไม่ใช่แค่คำกว้างๆ:
   ```yaml
   ---
   name: <skill-name>
   description: Use when ... — e.g. "..."
   metadata:
     version: "1.0.0"
   ---
   ```
4. โครงเนื้อหาที่ skill อื่นในนี้ใช้ตรงกัน (ดู `roles/ba/.agents/skills/write-brd/SKILL.md` เป็นตัวอย่าง): ย่อหน้าสั้นๆ ว่าทำไมต้องมี skill นี้ → `## Steps` เป็นลำดับเลข → ปิดท้ายด้วย `## What this skill does not do` กันไม่ให้ agent ทำเกินขอบเขตที่ตั้งใจไว้
5. ถ้า skill นี้เรียก MCP tool ใหม่ที่ยังไม่มีในบรรทัด `tools:` ของ `.agents/agents/<role>.md` **ต้องเพิ่มชื่อ tool นั้นเข้าไปด้วย** ไม่งั้น agent เรียกไม่ได้เลย (ถูก block ฝั่ง client ไม่ใช่ 403 จาก server — ดู `tools:` ใน `pm.md` เป็นตัวอย่างรายการ)
6. อยากให้ role นั้นเรียก skill นี้เป็นค่าเริ่มต้นเสมอ ไม่ใช่แค่หวังให้ Claude เดาถูกจาก description — เพิ่มบรรทัดอ้างชื่อ skill ตรงๆ ไว้ในเนื้อหา `.agents/agents/<role>.md` (ดู `pm.md` ส่วน "Nexus (MCP)" ที่บังคับให้เรียก `nexus-plan-work` ก่อนสร้าง task ทุกครั้งเป็นตัวอย่าง)
7. ไม่ต้อง symlink เพิ่ม — `.claude/skills` ชี้ไปที่ `.agents/skills` อยู่แล้วจากส่วนที่ 2 restart session หรือเปิด Claude Code ใหม่ก็เห็น skill ใหม่ทันที
8. อยากให้ repo อื่นใช้ซ้ำได้ — copy `SKILL.md` กลับไปไว้ที่ `claude-templates/roles/<role>/.agents/skills/` ด้วย ไม่งั้นทีมอื่นต้องเริ่มเขียนใหม่จากศูนย์

---

## ปัญหาที่เจอบ่อย

- **`whoami` ไม่รู้จักชื่อ / skill ไม่ขึ้นใน `/skills`** — ยังไม่ได้ login หรือยังไม่ได้ reload หลังติดตั้ง plugin (ส่วนที่ 1)
- **`@agent-xxx` หา agent ไม่เจอ** — ยังไม่ได้ทำส่วนที่ 2 ใน repo นี้ หรือ symlink `.claude/agents` หาย/พัง เช็คด้วย `ls -la .claude/`
- **agent บอกว่าไม่รู้จัก skill ที่ควรจะมี** — ลองถาม agent ตรงๆ ว่า "มี skill อะไรใช้ได้บ้าง" ถ้าไม่เจอ skill ที่ควรมี ให้เช็ค `.claude/skills/` ว่ามีไฟล์ครบไหม

## Reference

- [`roles/README.md`](roles/README.md) — รายละเอียด role package แต่ละตัว, วิธีแยก dev เป็น frontend/backend
- [`team-setup/README.md`](team-setup/README.md) — รายละเอียด AGENTS.md/TEAM-WORKFLOW.md/settings
- [`nexus-mcp`](https://github.com/tanakorncode/nexus-mcp) — MCP server + skill 2 ตัวหลัก, multi-editor support (Antigravity ฯลฯ)
