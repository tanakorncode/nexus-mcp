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

module.exports = { appendJob, loadHistory };
