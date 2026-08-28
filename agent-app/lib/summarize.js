// Turns a raw Nexus event (from notify-server, same shape pm-system
// publishes) into the prompt text handed to the configured AI command.

// `claude -p` (and any other one-shot CLI this gets pointed at) runs a
// single turn and exits — it cannot wait for a reply, and nobody is
// watching this process's output live. Without this, the model's
// reasonable-by-default move on an ambiguous "status changed"/"new
// comment" event is to ask a clarifying question — which then just
// becomes the entire output, the job exits having done nothing, and the
// question is never seen by anyone. Observed for real, not theoretical:
// a run against a task.status_changed event asked "do you want a code
// review or something else?" and stopped there. This header exists to
// close that dead end.
const UNATTENDED_HEADER =
  "[Unattended automated run — nobody is watching this session live, so do not stop to ask a clarifying question; there is no one to answer it, and this process exits after one turn regardless. If a subagent's own description matches this event, delegate to it directly. Otherwise use your best judgment on the most reasonable action, and record what you did — and why, if a real judgment call was involved — as a comment on the task via the Nexus MCP tools, instead of pausing to ask.]\n\n";

function taskLabel(task) {
  if (!task) return "unknown task";
  return task.taskKey ? `${task.taskKey} — ${task.name}` : task.name;
}

function summarize(event, payload) {
  const task = payload?.task;
  const label = taskLabel(task);
  const url = task?.url ? `\n${task.url}` : "";
  const repo = task?.repository?.name ? ` [${task.repository.name}]` : "";
  const labelWithRepo = `${label}${repo}`;

  const body = (() => {
    switch (event) {
      case "task.status_changed":
        return `[Nexus] ${labelWithRepo}\nStatus changed: ${payload.from} → ${payload.to}${url}`;
      case "task.comment_created": {
        const author = payload.comment?.author?.name ?? "someone";
        const content = payload.comment?.content ?? "";
        return `[Nexus] ${labelWithRepo}\nNew comment from ${author}: "${content}"${url}`;
      }
      default:
        return `[Nexus] ${event} on ${labelWithRepo}${url}`;
    }
  })();

  return UNATTENDED_HEADER + body;
}

module.exports = { summarize };
