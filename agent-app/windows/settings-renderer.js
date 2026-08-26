const $ = (id) => document.getElementById(id);

let presets = {};

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
  $("workDir").value = settings.workDir;

  presetSelect.addEventListener("change", () => {
    const value = presets[presetSelect.value];
    if (presetSelect.value !== "Custom") $("command").value = value;
  });
}

$("browseBtn").addEventListener("click", async () => {
  const dir = await window.nexusAgent.chooseFolder();
  if (dir) $("workDir").value = dir;
});

$("testBtn").addEventListener("click", async () => {
  const status = $("testStatus");
  const output = $("testOutput");
  status.textContent = "กำลังทดสอบ…";
  status.className = "status";
  output.style.display = "block";
  output.textContent = "";

  const result = await window.nexusAgent.testCommand({
    command: $("command").value,
    workDir: $("workDir").value,
  });

  output.textContent = result.lines.join("\n") || "(ไม่มี output)";
  if (result.ok) {
    status.textContent = "✓ รันได้ปกติ";
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
    workDir: $("workDir").value.trim(),
  });
  window.close();
});

init();
