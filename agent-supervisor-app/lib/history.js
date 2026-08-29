const fs = require("fs");
const path = require("path");

function historyPath(userDataDir) {
  return path.join(userDataDir, "history.jsonl");
}

// Appends one completed job as a JSON line. Only finished jobs are
// persisted — a still-running job only exists in main.js's in-memory
// recentJobs until it completes.
function appendJob(userDataDir, job) {
  const line = JSON.stringify({
    id: job.id,
    prompt: job.prompt,
    workDir: job.workDir,
    lines: job.lines,
    done: job.done,
    finishedAt: Date.now(),
  });
  fs.appendFileSync(historyPath(userDataDir), line + "\n", "utf8");
}

// Reads history.jsonl, drops anything older than retentionDays, and
// rewrites the file with just what's kept — so it doesn't grow forever.
// Returns the kept entries, oldest first.
function loadHistory(userDataDir, retentionDays) {
  const file = historyPath(userDataDir);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const kept = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.finishedAt >= cutoff) kept.push(entry);
    } catch {
      // corrupt line — drop it rather than fail the whole load
    }
  }

  fs.writeFileSync(file, kept.map((e) => JSON.stringify(e)).join("\n") + (kept.length ? "\n" : ""), "utf8");
  return kept;
}

// Recomputed fresh from history.jsonl on every call rather than kept as a
// running in-memory tally — the file is already the source of truth
// (loadHistory prunes it to the retention window on every read/write), so a
// separate running total would just be one more thing that could drift
// from what's actually on disk after a retention change or app restart.
// costUsd is only known for jobs that ran via claude's own
// --output-format json (see runner.js) — a job from another preset (or one
// persisted before this field existed) has done.costUsd === undefined,
// counted in `unknownCost` rather than silently treated as $0.
function summarizeUsage(userDataDir, retentionDays) {
  const entries = loadHistory(userDataDir, retentionDays);
  let costUsd = 0;
  let unknownCost = 0;
  let ok = 0;
  let failed = 0;
  for (const entry of entries) {
    if (entry.done?.ok) ok++;
    else failed++;
    if (typeof entry.done?.costUsd === "number") costUsd += entry.done.costUsd;
    else unknownCost++;
  }
  return { jobs: entries.length, ok, failed, costUsd, unknownCost };
}

module.exports = { appendJob, loadHistory, summarizeUsage };
