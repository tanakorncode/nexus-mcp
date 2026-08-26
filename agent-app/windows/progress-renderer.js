const jobsEl = document.getElementById("jobs");
const logEl = document.getElementById("log");

const jobs = new Map(); // id -> { id, prompt, lines, done }
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
    div.innerHTML = `<span class="dot ${dotClass(job)}"></span>${job.prompt.split("\n")[0].slice(0, 40)}`;
    div.addEventListener("click", () => {
      activeId = job.id;
      renderJobList();
      renderLog();
    });
    jobsEl.appendChild(div);
  }
}

function renderLog() {
  const job = jobs.get(activeId);
  logEl.textContent = job ? job.lines.join("\n") : "";
}

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
  if (id === activeId) renderLog();
});

window.nexusAgent.onJobDone(({ id, result }) => {
  const job = jobs.get(id);
  if (!job) return;
  job.done = result;
  renderJobList();
});
