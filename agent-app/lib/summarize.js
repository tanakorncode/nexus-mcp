// Turns a raw Nexus event (from notify-server, same shape pm-system
// publishes) into the prompt text handed to the configured AI command.

function taskLabel(task) {
  if (!task) return "unknown task";
  return task.taskKey ? `${task.taskKey} — ${task.name}` : task.name;
}

function summarize(event, payload) {
  const task = payload?.task;
  const label = taskLabel(task);
  const url = task?.url ? `\n${task.url}` : "";

  switch (event) {
    case "task.status_changed":
      return `[Nexus] ${label}\nStatus changed: ${payload.from} → ${payload.to}${url}`;
    case "task.comment_created": {
      const author = payload.comment?.author?.name ?? "someone";
      const content = payload.comment?.content ?? "";
      return `[Nexus] ${label}\nNew comment from ${author}: "${content}"${url}`;
    }
    default:
      return `[Nexus] ${event} on ${label}${url}`;
  }
}

module.exports = { summarize };
