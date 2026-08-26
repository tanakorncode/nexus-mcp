const jobsEl = document.getElementById("jobs");
const logEl = document.getElementById("log");
const headerTextEl = document.getElementById("log-header-text");
const cancelBtn = document.getElementById("cancelBtn");

const jobs = new Map(); // id -> { id, prompt, lines: [], done }
let activeId = null;

function dotClass(job) {
  if (job.done === null) return "running";
  return job.done.ok ? "ok" : "fail";
}

function renderJobList() {
  jobsEl.innerHTML = "";
  for (const job of [...jobs.values()].reverse()) {
    const div = document.createElement("div");
    div.className = "job" + (job.id === activeId ? " active" : "");
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = job.prompt.split("\n")[0].slice(0, 40);
    const dot = document.createElement("span");
    dot.className = `dot ${dotClass(job)}`;
    div.appendChild(dot);
    div.appendChild(title);
    div.addEventListener("click", () => {
      activeId = job.id;
      renderJobList();
      renderLog();
    });
    jobsEl.appendChild(div);
  }
}

function appendLogLine(line) {
  const div = document.createElement("div");
  const isStderr = line.startsWith("[stderr] ");
  div.className = "logline" + (isStderr ? " stderr" : "");
  div.innerHTML = ansiToHtml(line);
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function renderLog() {
  const job = jobs.get(activeId);
  logEl.innerHTML = "";
  headerTextEl.textContent = job ? job.prompt.replace(/\n/g, "  ·  ") : "";
  cancelBtn.style.display = job && job.done === null ? "block" : "none";
  if (!job) return;
  for (const line of job.lines) appendLogLine(line);
}

cancelBtn.addEventListener("click", () => {
  if (activeId) window.nexusAgent.cancelJob(activeId);
});

function upsert(job) {
  jobs.set(job.id, job);
  if (activeId === null) activeId = job.id;
  renderJobList();
  if (activeId === job.id) renderLog();
}

window.nexusAgent.getRecentJobs().then((recent) => {
  for (const job of recent) upsert(job);
});

window.nexusAgent.onJobNew((job) => upsert(job));

window.nexusAgent.onJobLine(({ id, line }) => {
  const job = jobs.get(id);
  if (!job) return;
  job.lines.push(line);
  if (id === activeId) appendLogLine(line);
});

window.nexusAgent.onJobDone(({ id, result }) => {
  const job = jobs.get(id);
  if (!job) return;
  job.done = result;
  renderJobList();
  if (id === activeId) {
    cancelBtn.style.display = "none";
    appendLogLine(
      result.cancelled
        ? "\x1b[1m\x1b[33m✗ ยกเลิกแล้ว\x1b[0m"
        : result.ok
          ? "\x1b[1m\x1b[32m✓ เสร็จแล้ว\x1b[0m"
          : `\x1b[1m\x1b[31m✗ ล้มเหลว (${result.error ?? `exit code ${result.exitCode}`})\x1b[0m`,
    );
  }
});
