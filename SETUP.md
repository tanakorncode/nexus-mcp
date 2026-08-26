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

## วิธีเรียกใช้แต่ละ role

**เรียกตรงๆ (การันตีว่าถูกตัว)**
```
@agent-pm ช่วยวางแผน sprint หน้าให้หน่อย
@agent-ba เขียน BRD ให้ feature ล็อกอิน
@agent-dev หยิบงาน PEA-T050 มาทำ
@agent-qa เทส task ที่ dev ส่งมาให้หน่อย
```

**พิมพ์ปกติ** — Claude เทียบคำขอกับ `description` ของแต่ละ agent แล้วเลือกเรียกให้เองถ้าตรง แต่ไม่การันตี 100% ว่าจะเลือกถูก — ถ้าอยากชัวร์ใช้ `@agent-` แบบข้างบน

**เปิด terminal เป็น role นั้นทั้ง session** (เหมาะกับ dedicate tmux pane ต่อ role)
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

## สิทธิ์จริงของแต่ละ role (บังคับจริงฝั่ง server ไม่ใช่แค่ convention)

| สิทธิ์ | pm | ba | dev | qa |
|---|:-:|:-:|:-:|:-:|
| สร้าง task ใหม่ | ✓ | ✓ | ✗ | ✗ |
| มอบหมายงานให้ใครก็ได้ | ✓ | ✗ | เฉพาะที่ตัวเองถืออยู่ | เฉพาะที่ตัวเองถืออยู่ |
| แก้/เปลี่ยน status task | ✓ | เฉพาะที่ตัวเองถืออยู่ | เฉพาะที่ตัวเองถืออยู่ | เฉพาะที่ตัวเองถืออยู่ |

ถ้าเจอ error 403 ตอนเรียก tool — นั่นคือ permission boundary จริง ไม่ใช่บั๊ก บอก agent ตรงๆ ว่าทำไม่ได้ แล้วขอให้ pm/dev (แล้วแต่กรณี) เป็นคนทำแทน ไม่ต้องลองซ้ำ

---

## ปัญหาที่เจอบ่อย

- **`whoami` ไม่รู้จักชื่อ / skill ไม่ขึ้นใน `/skills`** — ยังไม่ได้ login หรือยังไม่ได้ reload หลังติดตั้ง plugin (ส่วนที่ 1)
- **`@agent-xxx` หา agent ไม่เจอ** — ยังไม่ได้ทำส่วนที่ 2 ใน repo นี้ หรือ symlink `.claude/agents` หาย/พัง เช็คด้วย `ls -la .claude/`
- **agent บอกว่าไม่รู้จัก skill ที่ควรจะมี** — ลองถาม agent ตรงๆ ว่า "มี skill อะไรใช้ได้บ้าง" ถ้าไม่เจอ skill ที่ควรมี ให้เช็ค `.claude/skills/` ว่ามีไฟล์ครบไหม

## Reference

- [`roles/README.md`](roles/README.md) — รายละเอียด role package แต่ละตัว, วิธีแยก dev เป็น frontend/backend
- [`team-setup/README.md`](team-setup/README.md) — รายละเอียด AGENTS.md/TEAM-WORKFLOW.md/settings
- [`nexus-mcp`](https://github.com/tanakorncode/nexus-mcp) — MCP server + skill 2 ตัวหลัก, multi-editor support (Antigravity ฯลฯ)
