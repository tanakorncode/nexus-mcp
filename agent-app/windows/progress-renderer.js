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

// Every real Nexus-triggered prompt is prefixed with summarize.js's
// UNATTENDED_HEADER — one long line with no embedded newline — so a plain
// prompt.split("\n")[0] grabs that boilerplate instead of the actual task.
// Mirrors main.js's own taskLineOf() (a separate process, no way to share
// the function directly).
function taskLineOf(prompt) {
  return prompt.split("\n").find((l) => l.startsWith("[Nexus]")) ?? prompt.split("\n")[0];
}

function dotClass(job) {
  if (job.done === null) return job.queued ? "queued" : "running";
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
  // Sort by id (a Date.now() string) descending, newest first — not
  // Map insertion order. History hydration inserts newest-first (from
  // getRecentJobs()) while a live onJobNew insert always lands last in
  // Map iteration order (Map.set on a new key always appends), so the
  // two paths disagree about what "insertion order" even means; sorting
  // by the actual timestamp is the only way both end up consistent.
  const sorted = [...jobs.values()].sort((a, b) => Number(b.id) - Number(a.id));
  for (const job of sorted) {
    const div = document.createElement("div");
    div.className = "job" + (job.id === activeId ? " active" : "");
    div.title = jobTime(job, { dateStyle: "medium", timeStyle: "medium" });
    const dot = document.createElement("span");
    dot.className = `dot ${dotClass(job)}`;
    const body = document.createElement("div");
    body.className = "job-body";
    const title = document.createElement("div");
    title.className = "title";
    const retryTag = job.retryCount > 0 ? `↻${job.retryCount} ` : "";
    title.textContent = retryTag + taskLineOf(job.prompt).slice(0, 40);
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
    ? `[${jobTime(job, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}]  ${job.retryCount > 0 ? `↻${job.retryCount} ` : ""}${taskLineOf(job.prompt)}${job.queued ? "  ·  อยู่ในคิว" : ""}`
    : "";
  cancelBtn.style.display = job && job.done === null ? "block" : "none";
  retryBtn.style.display = canRetry(job) ? "block" : "none";
  if (!job) return;
  if (job.queued) {
    logEl.innerHTML = "";
    const note = document.createElement("div");
    note.id = "empty";
    note.textContent = "รอโฟลเดอร์นี้ว่าง — มีงานอื่นทำอยู่ในที่เดียวกัน จะเริ่มทันทีที่งานนั้นเสร็จ";
    logEl.appendChild(note);
    return;
  }
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

// follow: true means "this is a live arrival, jump the log pane to it" —
// used for onJobNew only. History hydration (getRecentJobs) relies on
// arriving newest-first so the first upsert() (which trips the
// activeId===null branch) already lands on the newest job; onJobNew jobs
// arrive one at a time long after that, so without an explicit follow the
// log pane just stayed frozen on whatever was selected when the window
// opened — the sidebar list kept updating (new entries, pulsing dot), but
// the pane everyone's actually watching didn't, which is exactly what
// looked like "Activity doesn't update live, only close+reopen shows it".
function upsert(job, { follow = false } = {}) {
  jobs.set(job.id, job);
  if (activeId === null || follow) activeId = job.id;
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

window.nexusAgent.onJobNew((job) => upsert(job, { follow: true }));

// Fires when a queued job's turn comes up and it actually starts running —
// the job object itself doesn't change shape, just queued flips to false,
// so re-render rather than re-upsert (upsert would also re-follow it,
// which isn't wanted here — only a brand new job arriving should steal
// focus from whatever the user is currently looking at).
window.nexusAgent.onJobStarted(({ id }) => {
  const job = jobs.get(id);
  if (!job) return;
  job.queued = false;
  renderJobList();
  if (id === activeId) renderLog();
});

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
