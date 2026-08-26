const { spawn } = require("child_process");
const { buildCommand } = require("./command");

// Runs the configured command for one event, streaming raw stdout lines to
// onLine as they arrive (so a progress window can show live output) and
// reporting completion via onDone. Deliberately shell: false — see
// command.js for why.
function runJob({ command, workDir, prompt, onLine, onDone }) {
  let cmd, args;
  try {
    ({ cmd, args } = buildCommand(command, prompt));
  } catch (err) {
    onLine(`[error] ${err.message}`);
    onDone({ ok: false, error: err.message });
    return { kill: () => {} };
  }

  const child = spawn(cmd, args, { cwd: workDir || undefined, shell: false });
  let buffer = "";

  const flush = (chunk, isErr) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) onLine(isErr ? `[stderr] ${line}` : line);
  };

  child.stdout.on("data", (d) => flush(d, false));
  child.stderr.on("data", (d) => flush(d, true));

  child.on("error", (err) => {
    onLine(`[error] failed to start: ${err.message}`);
    onDone({ ok: false, error: err.message });
  });

  child.on("close", (code) => {
    if (buffer) onLine(buffer);
    onDone({ ok: code === 0, exitCode: code });
  });

  return { kill: () => child.kill() };
}

module.exports = { runJob };
