const $ = (id) => document.getElementById(id);

let presets = {};
let repoMap = [];
let readyStatusesByProjectId = {};

// Purely about pm-system reachability — never about whether the form is
// filled in (see #configBanner for that, a separate concern). No
// "disconnected" state here (unlike agent-app's WebSocket) — polling either
// succeeds or fails on its own schedule, there's no persistent connection to
// drop.
const STATUS_LABELS = {
  idle: "ยังไม่ได้เชื่อมต่อ",
  connecting: "กำลังเริ่มต้น…",
  connected: "เชื่อมต่อแล้ว — poll ล่าสุดสำเร็จ",
  unauthorized: "เข้าสู่ระบบไม่สำเร็จ",
  error: "poll ล่าสุดล้มเหลว",
  paused: "หยุดชั่วคราว (ปิด Enabled ไว้จาก tray menu)",
};

function renderStatus({ status, detail, config }) {
  $("statusDot").className = "status-dot " + status.replace(/\s+/g, "-");
  $("statusText").textContent = (STATUS_LABELS[status] ?? status) + (detail ? ` — ${detail}` : "");

  const banner = $("configBanner");
  if (config && !config.complete) {
    banner.textContent = `⚠ ยังกรอกไม่ครบ ยังไม่เริ่ม poll — ขาด: ${config.missing.join(", ")}`;
    banner.style.display = "block";
  } else {
    banner.style.display = "none";
  }
}

$("openLogBtn").addEventListener("click", () => window.nexusAgent.openLog());
window.nexusAgent.getStatus().then(renderStatus);
window.nexusAgent.onStatusUpdate(renderStatus);

// Project list is the same for every row — fetched once, cached. Repo list
// and status list are per-project — fetched lazily as each project gets
// picked, also cached.
let projects = [];
let projectsError = null;
const repoCache = new Map(); // projectId -> repos array
const statusCache = new Map(); // projectId -> statuses array

async function ensureProjectsLoaded() {
  if (projects.length || projectsError) return;
  const result = await window.nexusAgent.listProjects();
  if (result.ok) projects = result.data;
  else projectsError = result.error;
}

async function reposForProject(projectId) {
  if (!projectId) return [];
  if (repoCache.has(projectId)) return repoCache.get(projectId);
  const result = await window.nexusAgent.listRepositories(projectId);
  const repos = result.ok ? result.data : [];
  repoCache.set(projectId, repos);
  return repos;
}

async function statusesForProject(projectId) {
  if (!projectId) return [];
  if (statusCache.has(projectId)) return statusCache.get(projectId);
  const result = await window.nexusAgent.listStatuses(projectId);
  const statuses = result.ok ? result.data : [];
  statusCache.set(projectId, statuses);
  return statuses;
}

// One project can have several repo mappings (or one "whole project"
// fallback) — grouping by projectId means picking the project once per
// group instead of repeating it on every single row, and lets the
// ready-status picker live once per project too.
function groupRepoMap() {
  const groups = [];
  const byProjectId = new Map();
  repoMap.forEach((row, i) => {
    if (row.projectId && byProjectId.has(row.projectId)) {
      byProjectId.get(row.projectId).entries.push({ row, i });
      return;
    }
    const group = { projectId: row.projectId, projectName: row.projectName, entries: [{ row, i }] };
    groups.push(group);
    if (row.projectId) byProjectId.set(row.projectId, group);
  });
  return groups;
}

async function renderStatusChips(container, projectId) {
  container.innerHTML = "";
  if (!projectId) return;

  const statuses = await statusesForProject(projectId);
  if (statuses.length === 0) {
    const empty = document.createElement("div");
    empty.className = "status-chip-empty";
    empty.textContent = "โหลดรายชื่อสถานะไม่สำเร็จ หรือโปรเจกต์นี้ยังไม่มีสถานะ";
    container.appendChild(empty);
    return;
  }

  const chipsWrap = document.createElement("div");
  chipsWrap.className = "status-chips";
  const selected = new Set(readyStatusesByProjectId[projectId] ?? []);

  for (const s of statuses) {
    const label = document.createElement("label");
    label.className = "status-chip" + (selected.has(s.name) ? " checked" : "");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(s.name);
    checkbox.addEventListener("change", () => {
      const set = new Set(readyStatusesByProjectId[projectId] ?? []);
      if (checkbox.checked) set.add(s.name);
      else set.delete(s.name);
      readyStatusesByProjectId[projectId] = [...set];
      label.classList.toggle("checked", checkbox.checked);
    });
    const text = document.createElement("span");
    text.textContent = s.name;
    label.append(checkbox, text);
    chipsWrap.appendChild(label);
  }
  container.appendChild(chipsWrap);
}

async function renderRepoTable() {
  const container = $("repoTable");
  const errorEl = $("repoTableError");
  await ensureProjectsLoaded();

  if (projectsError) {
    errorEl.textContent = `โหลดรายชื่อ Project ไม่สำเร็จ: ${projectsError} — เข้าสู่ระบบก่อน (ด้านบน) แล้วลองใหม่`;
    errorEl.style.display = "block";
    container.innerHTML = "";
    return;
  }
  errorEl.style.display = "none";
  container.innerHTML = "";

  const groups = groupRepoMap();
  const usedProjectIds = new Set(groups.map((g) => g.projectId).filter(Boolean));

  for (const group of groups) {
    const groupEl = document.createElement("div");
    groupEl.className = "repo-group";

    const projectSelect = document.createElement("select");
    projectSelect.appendChild(new Option("— เลือก Project —", ""));
    for (const p of projects) {
      if (p.id !== group.projectId && usedProjectIds.has(p.id)) continue;
      projectSelect.appendChild(new Option(p.name, p.id, false, p.id === group.projectId));
    }

    const addRepoBtn = document.createElement("button");
    addRepoBtn.className = "small ghost-link";
    addRepoBtn.textContent = "+ เพิ่ม repo";
    addRepoBtn.disabled = !group.projectId;

    const removeGroupBtn = document.createElement("button");
    removeGroupBtn.className = "small danger-ghost";
    removeGroupBtn.textContent = "ลบกลุ่มนี้";

    projectSelect.addEventListener("change", () => {
      const oldProjectId = group.projectId;
      const p = projects.find((p) => p.id === projectSelect.value);
      for (const { i } of group.entries) {
        repoMap[i].projectId = projectSelect.value || null;
        repoMap[i].projectName = p?.name ?? null;
        repoMap[i].repositoryId = null;
        repoMap[i].repoName = null;
      }
      // Ready-statuses were keyed to the old project — a different project
      // has an entirely different set of real status names, carrying them
      // over would silently "select" statuses that don't exist there.
      if (oldProjectId && oldProjectId !== projectSelect.value) delete readyStatusesByProjectId[oldProjectId];
      renderRepoTable();
    });
    addRepoBtn.addEventListener("click", () => {
      repoMap.push({
        projectId: group.projectId,
        projectName: group.projectName,
        repositoryId: null,
        repoName: null,
        path: "",
      });
      renderRepoTable();
    });
    removeGroupBtn.addEventListener("click", () => {
      const name = group.projectName ?? "(ยังไม่ได้เลือก Project)";
      const count = group.entries.length;
      if (!confirm(`ลบ mapping ทั้งหมดของ "${name}" (${count} รายการ)? ยังไม่มีผลจนกว่าจะกด Save`)) return;
      const indices = new Set(group.entries.map((e) => e.i));
      repoMap = repoMap.filter((_, i) => !indices.has(i));
      if (group.projectId) delete readyStatusesByProjectId[group.projectId];
      renderRepoTable();
    });

    const actions = document.createElement("div");
    actions.className = "repo-group-actions";
    actions.append(addRepoBtn, removeGroupBtn);

    const header = document.createElement("div");
    header.className = "repo-group-header";
    header.append(actions, projectSelect);
    groupEl.appendChild(header);

    const rowsEl = document.createElement("div");
    rowsEl.className = "repo-group-rows";

    for (const { row, i } of group.entries) {
      const repoSelect = document.createElement("select");
      repoSelect.appendChild(new Option("— ทั้งโปรเจก (ไม่มี repo) —", ""));
      if (group.projectId) {
        const repos = await reposForProject(group.projectId);
        for (const r of repos) {
          repoSelect.appendChild(new Option(r.name, r.id, false, r.id === row.repositoryId));
        }
      } else {
        repoSelect.disabled = true;
      }

      const pathInput = document.createElement("input");
      pathInput.type = "text";
      pathInput.placeholder = "/path/to/local/checkout";
      pathInput.value = row.path ?? "";

      const browseBtn = document.createElement("button");
      browseBtn.className = "small";
      browseBtn.textContent = "เลือก…";

      const removeBtn = document.createElement("button");
      removeBtn.className = "small danger-ghost";
      removeBtn.textContent = "ลบ";

      repoSelect.addEventListener("change", () => {
        const repos = repoCache.get(group.projectId) ?? [];
        const r = repos.find((r) => r.id === repoSelect.value);
        repoMap[i].repositoryId = repoSelect.value || null;
        repoMap[i].repoName = r?.name ?? null;
      });
      pathInput.addEventListener("input", (e) => {
        repoMap[i].path = e.target.value;
      });
      browseBtn.addEventListener("click", async () => {
        const dir = await window.nexusAgent.chooseFolder();
        if (dir) {
          repoMap[i].path = dir;
          renderRepoTable();
        }
      });
      removeBtn.addEventListener("click", () => {
        const hasData = row.repoName || row.path?.trim();
        if (hasData && !confirm(`ลบ mapping นี้ (${row.repoName ?? "ทั้งโปรเจก"} → ${row.path || "(ยังไม่ได้ตั้ง path)"})?`)) return;
        repoMap.splice(i, 1);
        renderRepoTable();
      });

      const rowEl = document.createElement("div");
      rowEl.className = "repo-row-line";
      rowEl.append(repoSelect, pathInput, browseBtn, removeBtn);
      rowsEl.appendChild(rowEl);
    }

    groupEl.appendChild(rowsEl);

    if (group.projectId) {
      const statusLabel = document.createElement("div");
      statusLabel.className = "hint";
      statusLabel.style.marginTop = "2px";
      statusLabel.textContent = "สถานะที่นับว่า \"พร้อมทำ\" สำหรับโปรเจกต์นี้:";
      groupEl.appendChild(statusLabel);
      const chipsContainer = document.createElement("div");
      groupEl.appendChild(chipsContainer);
      renderStatusChips(chipsContainer, group.projectId);
    }

    container.appendChild(groupEl);
  }
}

$("addProjectBtn").addEventListener("click", () => {
  repoMap.push({ projectId: null, projectName: null, repositoryId: null, repoName: null, path: "" });
  renderRepoTable();
});

function renderAuthStatus(user) {
  if (user) {
    $("loginStatusText").textContent = `เข้าสู่ระบบเป็น ${user.name} (${user.email})`;
    $("loginBtn").style.display = "none";
    $("logoutBtn").style.display = "";
  } else {
    $("loginStatusText").textContent = "ยังไม่ได้เข้าสู่ระบบ";
    $("loginBtn").style.display = "";
    $("logoutBtn").style.display = "none";
  }
}

async function refreshAuthStatus() {
  const { user } = await window.nexusAgent.getAuthStatus();
  renderAuthStatus(user);
}

$("loginBtn").addEventListener("click", async () => {
  $("loginStatusText").textContent = "กำลังเปิด browser ให้เข้าสู่ระบบ…";
  $("loginBtn").disabled = true;
  const result = await window.nexusAgent.login();
  $("loginBtn").disabled = false;
  if (!result.ok) {
    $("loginStatusText").textContent = `✗ ${result.error}`;
    return;
  }
  renderAuthStatus(result.user);
  projectsError = null;
  renderRepoTable();
});

$("logoutBtn").addEventListener("click", async () => {
  await window.nexusAgent.logout();
  renderAuthStatus(null);
});

refreshAuthStatus();

// costUsd/unknownCost only come from claude's own --output-format json — a
// job run via another preset (Codex, Gemini CLI, Custom) has no cost figure
// at all, so this is worded as "known cost" rather than implying the
// unknown ones were free.
async function refreshUsageSummary() {
  const el = $("usageSummary");
  const summary = await window.nexusAgent.getUsageSummary();
  if (summary.jobs === 0) {
    el.textContent = "ยังไม่มีงานที่เสร็จในช่วงที่เก็บประวัติไว้";
    return;
  }
  const parts = [`${summary.jobs} งาน (${summary.ok} สำเร็จ, ${summary.failed} ล้มเหลว)`];
  if (summary.jobs > summary.unknownCost) {
    parts.push(`ใช้ไปประมาณ $${summary.costUsd.toFixed(4)}`);
  }
  if (summary.unknownCost > 0) {
    const label = summary.jobs === summary.unknownCost ? "ไม่ทราบ cost" : `${summary.unknownCost} งานไม่ทราบ cost`;
    parts.push(`${label} (เฉพาะ Claude Code preset ที่มีข้อมูลนี้)`);
  }
  el.textContent = parts.join(" — ");
}

async function init() {
  presets = await window.nexusAgent.getPresets();
  const presetSelect = $("preset");
  for (const name of Object.keys(presets)) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    presetSelect.appendChild(opt);
  }

  const settings = await window.nexusAgent.getSettings();
  $("pmSystemUrl").value = settings.pmSystemUrl;
  $("preset").value = settings.preset;
  $("command").value = settings.command;
  $("autoRetryEnabled").checked = settings.autoRetryEnabled !== false;
  $("pollIntervalSec").value = String(Math.round((settings.pollIntervalMs ?? 30_000) / 1000));
  $("maxConcurrentJobs").value = String(settings.maxConcurrentJobs ?? 3);
  $("historyRetentionDays").value = String(settings.historyRetentionDays ?? 7);
  repoMap = (settings.repoMap ?? []).map((r) => ({ ...r }));
  readyStatusesByProjectId = { ...(settings.readyStatusesByProjectId ?? {}) };
  renderRepoTable();
  refreshUsageSummary();

  presetSelect.addEventListener("change", () => {
    const value = presets[presetSelect.value];
    if (presetSelect.value !== "Custom") $("command").value = value;
  });
}

$("testBtn").addEventListener("click", async () => {
  const status = $("testStatus");
  const output = $("testOutput");
  status.textContent = "กำลังทดสอบ…";
  status.className = "status";
  output.style.display = "block";
  output.textContent = "";

  const workDir = repoMap[0]?.path || undefined;
  const result = await window.nexusAgent.testCommand({
    command: $("command").value,
    workDir,
  });

  output.innerHTML = result.lines.length
    ? result.lines.map((line) => ansiToHtml(line)).join("\n")
    : "(ไม่มี output)";
  if (result.ok) {
    status.textContent = workDir ? "✓ รันได้ปกติ" : "✓ รันได้ปกติ (ยังไม่ได้ตั้ง repo — ทดสอบใน working directory ปัจจุบัน)";
    status.className = "status ok";
  } else {
    status.textContent = `✗ ล้มเหลว: ${result.error ?? `exit code ${result.exitCode}`}`;
    status.className = "status err";
  }
});

$("saveBtn").addEventListener("click", async () => {
  const current = await window.nexusAgent.getSettings();
  const validRepoMap = repoMap.filter((r) => r.projectId && r.path?.trim());
  // Only keep readyStatuses for projects that actually survived the
  // repoMap filter above — an orphaned entry for a since-removed project
  // shouldn't linger in settings.json forever.
  const validProjectIds = new Set(validRepoMap.map((r) => r.projectId));
  const cleanedReadyStatuses = {};
  for (const [projectId, names] of Object.entries(readyStatusesByProjectId)) {
    if (validProjectIds.has(projectId) && names.length > 0) cleanedReadyStatuses[projectId] = names;
  }

  const pollIntervalSec = Math.max(10, Number($("pollIntervalSec").value) || 30);
  const maxConcurrentJobs = Math.max(1, Number($("maxConcurrentJobs").value) || 3);

  const saved = await window.nexusAgent.saveSettings({
    ...current,
    pmSystemUrl: $("pmSystemUrl").value.trim(),
    preset: $("preset").value,
    command: $("command").value.trim(),
    autoRetryEnabled: $("autoRetryEnabled").checked,
    pollIntervalMs: pollIntervalSec * 1000,
    maxConcurrentJobs,
    historyRetentionDays: Number($("historyRetentionDays").value),
    repoMap: validRepoMap,
    readyStatusesByProjectId: cleanedReadyStatuses,
  });

  const saveStatus = $("testStatus");
  if (validRepoMap.length === 0) {
    saveStatus.textContent = "บันทึกแล้ว — แต่ยังไม่มีโปรเจกต์ที่จะดูแลเลยสักอัน (ต้องมีอย่างน้อย 1 อัน ถึงจะเริ่ม poll ได้)";
    saveStatus.className = "status err";
  } else {
    const missingStatuses = validRepoMap.some((r) => !cleanedReadyStatuses[r.projectId]?.length);
    saveStatus.textContent = missingStatuses
      ? "บันทึกแล้ว — แต่มีโปรเจกต์ที่ยังไม่ได้เลือกสถานะ \"พร้อมทำ\" เลย จะไม่มี task ถูก claim จากโปรเจกต์นั้น"
      : "✓ บันทึกแล้ว — ดูสถานะด้านบน";
    saveStatus.className = missingStatuses ? "status err" : "status ok";
  }
  console.log("saved settings:", saved);
  refreshUsageSummary();
});

init();
