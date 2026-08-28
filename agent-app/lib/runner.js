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

  // Piping stdout/stderr (to capture them here) means the child sees a
  // non-TTY and most well-behaved CLIs — claude included, being Node-based
  // — silently drop their own color output as a result. FORCE_COLOR is the
  // de-facto Node ecosystem convention (chalk, ansi-colors, picocolors all
  // respect it) to override that auto-detection.
  const child = spawn(cmd, args, {
    cwd: workDir || undefined,
    shell: false,
    env: { ...process.env, FORCE_COLOR: "1" },
    // stdin explicitly closed: this is always a one-shot, fire-and-forget
    // run with nothing to pipe in. Left as Node's default ("pipe"), the
    // child sees an open-but-silent stdin and — claude specifically —
    // burns 3s waiting for input that will never come, then logs a
    // stderr warning about it. Closing it outright means claude sees EOF
    // immediately instead of a live inherited/piped stdin from Agent App
    // itself (Electron apps have no real stdin worth inheriting here).
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buffer = "";

  const flush = (chunk, isErr) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) onLine(isErr ? `[stderr] ${line}` : line);
  };

  child.stdout.on("data", (d) => flush(d, false));
  child.stderr.on("data", (d) => flush(d, true));

  let cancelled = false;

  child.on("error", (err) => {
    onLine(`[error] failed to start: ${err.message}`);
    onDone({ ok: false, error: err.message });
  });

  child.on("close", (code) => {
    if (buffer) onLine(buffer);
    if (cancelled) {
      onLine("[cancelled by user]");
      onDone({ ok: false, cancelled: true });
    } else {
      onDone({ ok: code === 0, exitCode: code });
    }
  });

  return {
    kill: () => {
      cancelled = true;
      child.kill();
    },
  };
}

module.exports = { runJob };
