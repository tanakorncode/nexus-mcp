const $ = (id) => document.getElementById(id);

let presets = {};
let repoMap = [];

function renderRepoTable() {
  const container = $("repoTable");
  container.innerHTML = "";
  repoMap.forEach((row, i) => {
    const div = document.createElement("div");
    div.className = "repo-row";
    div.innerHTML = `
      <input type="text" placeholder="ชื่อ repo (ต้องตรงกับใน Nexus)" value="${row.repoName ?? ""}" data-field="repoName" />
      <input type="text" placeholder="/path/to/local/checkout" value="${row.path ?? ""}" data-field="path" />
      <button class="small" data-action="browse">เลือก…</button>
      <button class="small danger-ghost" data-action="remove">ลบ</button>
    `;
    div.querySelector('[data-field="repoName"]').addEventListener("input", (e) => {
      repoMap[i].repoName = e.target.value;
    });
    div.querySelector('[data-field="path"]').addEventListener("input", (e) => {
      repoMap[i].path = e.target.value;
    });
    div.querySelector('[data-action="browse"]').addEventListener("click", async () => {
      const dir = await window.nexusAgent.chooseFolder();
      if (dir) {
        repoMap[i].path = dir;
        renderRepoTable();
      }
    });
    div.querySelector('[data-action="remove"]').addEventListener("click", () => {
      repoMap.splice(i, 1);
      renderRepoTable();
    });
    container.appendChild(div);
  });
}

$("addRepoBtn").addEventListener("click", () => {
  repoMap.push({ repoName: "", path: "" });
  renderRepoTable();
});

$("detectBtn").addEventListener("click", async () => {
  const result = $("identityResult");
  result.textContent = "กำลังค้นหา…";
  result.className = "";
  const identity = await window.nexusAgent.resolveIdentity();
  if (identity.error) {
    result.textContent = `✗ ${identity.error}`;
    result.className = "err";
    return;
  }
  $("memberId").value = identity.memberId;
  result.textContent = `✓ พบแล้ว: ${identity.name} (${identity.email})`;
  result.className = "ok";
});

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
  $("memberId").value = settings.memberId;
  $("secret").value = settings.secret;
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
  await window.nexusAgent.saveSettings({
    ...current,
    serverUrl: $("serverUrl").value.trim(),
    memberId: $("memberId").value.trim(),
    secret: $("secret").value.trim(),
    preset: $("preset").value,
    command: $("command").value.trim(),
    historyRetentionDays: Number($("historyRetentionDays").value),
    repoMap: repoMap.filter((r) => r.repoName.trim() && r.path.trim()),
  });
  window.close();
});

init();
