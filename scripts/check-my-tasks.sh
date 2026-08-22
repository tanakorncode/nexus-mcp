#!/bin/zsh
# Notification-only Nexus task check — read-only, never edits files or writes code.
# Run manually to test: ./scripts/check-my-tasks.sh
# Scheduled via ~/Library/LaunchAgents/com.pea-thailand.nexus-task-check.plist

set -euo pipefail

# The repo whose .mcp.json / NEXUS_API_URL this check runs against.
REPO_DIR="/Volumes/T7-Shield/projects/pea/pea-thailand-backoffice-be"
CLAUDE_BIN="/opt/homebrew/bin/claude"

cd "$REPO_DIR"

"$CLAUDE_BIN" -p "เช็คว่ามี task ของฉันใน Nexus ที่ยังไม่เสร็จ (status ไม่ใช่ Done) และไม่ติด blockedBy ที่ยังไม่เสร็จไหม ใช้ mcp__nexus-mcp__whoami หา identity ก่อน ถ้า get_current_project หาไม่เจอให้ใช้ list_projects แล้วเลือกโปรเจกที่เจอ แล้ว list_my_tasks ดึงรายการ ถ้าเจอ task ที่พร้อมทำอย่างน้อย 1 อัน ให้เรียก Bash รัน osascript แจ้งเตือนผ่าน macOS notification บอกจำนวนและชื่อ task ถ้าไม่เจอเลยไม่ต้องทำอะไร ห้ามแก้ไฟล์ใดๆ ในระบบเด็ดขาด" \
  --mcp-config .mcp.json \
  --strict-mcp-config \
  --allowedTools "mcp__nexus-mcp__whoami mcp__nexus-mcp__list_my_tasks mcp__nexus-mcp__get_current_project mcp__nexus-mcp__list_projects Bash(osascript*)" \
  --output-format text
