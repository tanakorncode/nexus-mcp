const jobsEl = document.getElementById("jobs");
const logEl = document.getElementById("log");
const headerTextEl = document.getElementById("log-header-text");
const cancelBtn = document.getElementById("cancelBtn");
const retryBtn = document.getElementById("retryBtn");

function canRetry(job) {
  return job && job.done !== null && !job.done.ok && job.workDir;
}

const jobs = new Map(); // id -> { id, prompt, lines: [], done }
let activeId = null;

function dotClass(job) {
  if (job.done === null) return "running";
  return job.done.ok ? "ok" : "fail";
}

// job.id is a Date.now() string set at job creation — reuse it as the
// timestamp rather than tracking a separate startedAt field.
function jobTime(job, opts) {
  const ms = Number(job.id);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString("th-TH", opts);
}

function renderJobList() {
  jobsEl.innerHTML = "";
  for (const job of [...jobs.values()].reverse()) {
    const div = document.createElement("div");
    div.className = "job" + (job.id === activeId ? " active" : "");
    div.title = jobTime(job, { dateStyle: "medium", timeStyle: "medium" });
    const dot = document.createElement("span");
    dot.className = `dot ${dotClass(job)}`;
    const body = document.createElement("div");
    body.className = "job-body";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = job.prompt.split("\n")[0].slice(0, 40);
    const time = document.createElement("div");
    time.className = "time";
    time.textContent = jobTime(job, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    body.appendChild(title);
    body.appendChild(time);
    div.appendChild(dot);
    div.appendChild(body);
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
  headerTextEl.textContent = job
    ? `[${jobTime(job, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}]  ${job.prompt.replace(/\n/g, "  ·  ")}`
    : "";
  cancelBtn.style.display = job && job.done === null ? "block" : "none";
  retryBtn.style.display = canRetry(job) ? "block" : "none";
  if (!job) return;
  for (const line of job.lines) appendLogLine(line);
}

cancelBtn.addEventListener("click", () => {
  if (activeId) window.nexusAgent.cancelJob(activeId);
});

retryBtn.addEventListener("click", async () => {
  if (!activeId) return;
  const result = await window.nexusAgent.retryJob(activeId);
  // Switch to watching the new attempt live, rather than leaving the old
  // (failed/cancelled) one showing — retrying is a deliberate "watch this
  // again" action, unlike a background event arriving while you're
  // looking at something else.
  if (result.ok && result.id) {
    activeId = result.id;
    // job:new for the new job may already have arrived and been upserted
    // before this promise resolved (upsert() only renders when activeId
    // already matches, which it didn't yet) — render now so the header,
    // job list highlight, and Cancel button don't keep showing the old
    // (retried-from) job while the new one is actually running.
    renderJobList();
    renderLog();
  }
});

function upsert(job) {
  jobs.set(job.id, job);
  if (activeId === null) activeId = job.id;
  renderJobList();
  if (activeId === job.id) renderLog();
}

window.nexusAgent.getRecentJobs().then((recent) => {
  for (const job of recent) upsert(job);
}).catch((err) => {
  // Silently swallowing this once already hid a real bug (a
  // non-cloneable value in a job object made the whole IPC call reject,
  // and this window just showed the empty state forever with zero
  // indication anything was wrong).
  document.getElementById("empty").textContent = `โหลดรายการงานไม่สำเร็จ: ${err.message}`;
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
    retryBtn.style.display = canRetry(job) ? "block" : "none";
    appendLogLine(
      result.cancelled
        ? "\x1b[1m\x1b[33m✗ ยกเลิกแล้ว\x1b[0m"
        : result.ok
          ? "\x1b[1m\x1b[32m✓ เสร็จแล้ว\x1b[0m"
          : `\x1b[1m\x1b[31m✗ ล้มเหลว (${result.error ?? `exit code ${result.exitCode}`})\x1b[0m`,
    );
  }
});
