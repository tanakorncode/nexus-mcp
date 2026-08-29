// Turns a freshly-claimed task into the prompt text handed to the
// configured AI command. Same unattended-run guardrail agent-app's
// summarize.js established (claude -p runs one turn and exits — nobody is
// watching live to answer a clarifying question), adapted here for "this
// task was just auto-claimed by a supervisor process" rather than "an event
// happened to a task I already owned." Also explicitly tells the model to
// hand the task off normally when done — this app's own job ends at
// spawning the run (see task-poller.js/main.js); it deliberately does not
// implement its own hand-off, relying on the same skill flow a
// human-triggered dev/qa run already uses.
const UNATTENDED_HEADER =
  "[Unattended automated run — this task was auto-claimed by a supervisor process watching the whole project's backlog, not assigned to you by a person. Nobody is watching this session live, so do not stop to ask a clarifying question; there is no one to answer it, and this process exits after one turn regardless. If a subagent's own description matches this kind of work, delegate to it directly. Otherwise use your best judgment on the most reasonable action, and record what you did — and why, if a real judgment call was involved — as a comment on the task via the Nexus MCP tools, instead of pausing to ask. When you're done, hand the task off through this repo's normal status/assignee workflow — do not leave it assigned to the supervisor account.]\n\n";

function taskLabel(task) {
  return task.taskKey ? `${task.taskKey} — ${task.name}` : task.name;
}

function summarizeClaimedTask(task) {
  const label = taskLabel(task);
  const url = task.url ? `\n${task.url}` : "";
  const repo = task.repository?.name ? ` [${task.repository.name}]` : "";
  const body = `[Nexus] ${label}${repo}\nสถานะ: ${task.status}${url}`;
  return UNATTENDED_HEADER + body;
}

module.exports = { summarizeClaimedTask };
