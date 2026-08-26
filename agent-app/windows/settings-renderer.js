const $ = (id) => document.getElementById(id);

let presets = {};
let repoMap = [];

// Purely about the socket connection itself — never about whether the
// form is filled in (see #configBanner for that, a separate concern).
const STATUS_LABELS = {
  idle: "ยังไม่ได้เชื่อมต่อ",
  connecting: "กำลังเชื่อมต่อ…",
  connected: "เชื่อมต่อแล้ว",
  disconnected: "ขาดการเชื่อมต่อ — กำลังลองใหม่อัตโนมัติ",
  unauthorized: "เข้าสู่ระบบไม่สำเร็จ",
  error: "เชื่อมต่อ server ไม่สำเร็จ",
  paused: "หยุดชั่วคราว (ปิด Enabled ไว้จาก tray menu)",
};

function renderStatus({ status, detail, config }) {
  $("statusDot").className = "status-dot " + status.replace(/\s+/g, "-");
  $("statusText").textContent = (STATUS_LABELS[status] ?? status) + (detail ? ` — ${detail}` : "");

  const banner = $("configBanner");
  if (config && !config.complete) {
    banner.textContent = `⚠ ยังกรอกไม่ครบ ยังไม่เริ่มเชื่อมต่อ — ขาด: ${config.missing.join(", ")}`;
    banner.style.display = "block";
  } else {
    banner.style.display = "none";
  }
}

$("openLogBtn").addEventListener("click", () => window.nexusAgent.openLog());
window.nexusAgent.getStatus().then(renderStatus);
window.nexusAgent.onStatusUpdate(renderStatus);

// Project list is the same for every row — fetched once, cached. Repo list
// is per-project — fetched lazily as each project gets picked, also cached.
let projects = [];
let projectsError = null;
const repoCache = new Map(); // projectId -> repos array

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

  for (let i = 0; i < repoMap.length; i++) {
    const row = repoMap[i];
    const div = document.createElement("div");
    div.className = "repo-row";

    const projectSelect = document.createElement("select");
    const blankOpt = new Option("— เลือก Project —", "");
    projectSelect.appendChild(blankOpt);
    for (const p of projects) {
      const opt = new Option(p.name, p.id, false, p.id === row.projectId);
      projectSelect.appendChild(opt);
    }

    const repoSelect = document.createElement("select");
    repoSelect.appendChild(new Option("— ทั้งโปรเจก (ไม่มี repo) —", ""));
    if (row.projectId) {
      const repos = await reposForProject(row.projectId);
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

    projectSelect.addEventListener("change", () => {
      const p = projects.find((p) => p.id === projectSelect.value);
      repoMap[i].projectId = projectSelect.value || null;
      repoMap[i].projectName = p?.name ?? null;
      // Repo choice doesn't carry over to a different project.
      repoMap[i].repositoryId = null;
      repoMap[i].repoName = null;
      renderRepoTable();
    });
    repoSelect.addEventListener("change", () => {
      const repos = repoCache.get(row.projectId) ?? [];
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
      repoMap.splice(i, 1);
      renderRepoTable();
    });

    div.append(projectSelect, repoSelect, pathInput, browseBtn, removeBtn);
    container.appendChild(div);
  }
}

$("addRepoBtn").addEventListener("click", () => {
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
  // The repo-mapping table caches "not logged in" as a permanent failure
  // (ensureProjectsLoaded only skips re-fetching once it has *something*,
  // success or error) — clear that now that a login just succeeded, or a
  // repo table that loaded before the person logged in stays stuck showing
  // the old error forever.
  projectsError = null;
  renderRepoTable();
});

$("logoutBtn").addEventListener("click", async () => {
  await window.nexusAgent.logout();
  renderAuthStatus(null);
});

refreshAuthStatus();

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
  $("serverUrl").value = settings.serverUrl;
  $("preset").value = settings.preset;
  $("command").value = settings.command;
  $("historyRetentionDays").value = String(settings.historyRetentionDays ?? 7);
  repoMap = (settings.repoMap ?? []).map((r) => ({ ...r }));
  renderRepoTable();

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
  const saved = await window.nexusAgent.saveSettings({
    ...current,
    serverUrl: $("serverUrl").value.trim(),
    preset: $("preset").value,
    command: $("command").value.trim(),
    historyRetentionDays: Number($("historyRetentionDays").value),
    repoMap: validRepoMap,
  });

  // Deliberately doesn't close the window — closing right after Save would
  // hide the exact status transition (connecting/connected/rejected) this
  // screen exists to show. Left for the person to close once they've seen it.
  const saveStatus = $("testStatus");
  if (validRepoMap.length === 0) {
    saveStatus.textContent = "บันทึกแล้ว — แต่ยังไม่มี repo mapping เลยสักอัน (ต้องมีอย่างน้อย 1 อัน ถึงจะเริ่มเชื่อมต่อได้)";
    saveStatus.className = "status err";
  } else {
    saveStatus.textContent = "✓ บันทึกแล้ว — ดูสถานะเชื่อมต่อด้านบน";
    saveStatus.className = "status ok";
  }
  console.log("saved settings:", saved);
});

init();
