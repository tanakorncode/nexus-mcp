const { spawn } = require("child_process");
const { buildCommand } = require("./command");

// claude --output-format stream-json --verbose prints one JSON object per
// line as it works (assistant text/tool calls, tool results), then a final
// line with type: "result" carrying the same summary fields the old
// single-blob --output-format json used to hold (is_error,
// permission_denials, total_cost_usd, duration_ms, usage, result text) —
// confirmed by running both formats directly, not guessed. Swapped to this
// from plain --output-format json specifically because that mode prints
// nothing at all until the whole run finishes — Activity showed total
// silence for however long a real task took, which is exactly what an
// "Activity" window exists to not do. Parses every stdout line
// independently as it arrives, not as one accumulated blob at the end.
//
// Anything that isn't a recognized JSON stream-event line (plain-text
// presets — Codex, Gemini CLI, a Custom command) is passed through to
// onLine completely unchanged — this format detection is per-line, not
// tied to which preset is configured, so it doesn't break non-Claude
// presets at all.
function formatStreamEvent(evt) {
  switch (evt.type) {
    case "assistant": {
      const lines = [];
      for (const block of evt.message?.content ?? []) {
        if (block.type === "text" && block.text?.trim()) {
          lines.push(...block.text.split("\n"));
        } else if (block.type === "tool_use") {
          const detail = summarizeToolInput(block.input);
          lines.push(`[tool] ${block.name}${detail ? `: ${detail}` : ""}`);
        }
        // "thinking" blocks deliberately skipped — often empty/redacted
        // even when present, and full reasoning text is too verbose for a
        // progress log whose job is "is this still moving," not a
        // transcript.
      }
      return lines;
    }
    case "user": {
      const lines = [];
      for (const block of evt.message?.content ?? []) {
        if (block.type !== "tool_result") continue;
        const raw = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
        const preview = raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
        lines.push(`${block.is_error ? "[tool error]" : "[tool result]"} ${preview}`);
      }
      return lines;
    }
    case "system":
      return evt.subtype === "init" ? ["[session started]"] : [];
    default:
      // rate_limit_event and anything else new/unrecognized — not useful
      // as progress output, silently skipped rather than dumping raw JSON.
      return [];
  }
}

function summarizeToolInput(input) {
  if (!input || typeof input !== "object") return "";
  return input.command ?? input.file_path ?? input.pattern ?? input.query ?? "";
}

// Runs the configured command for one event, streaming formatted progress
// to onLine as it arrives (so a progress window can show live output) and
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
  let finalResult = null; // set when a stream line with type: "result" arrives

  const flush = (chunk, isErr) => {
    const text = chunk.toString();
    buffer += text;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line, isErr);
  };

  function handleLine(line, isErr) {
    if (isErr) {
      onLine(`[stderr] ${line}`);
      return;
    }
    const trimmed = line.trim();
    let evt = null;
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed.type === "string") evt = parsed;
      } catch {
        // not JSON (or not a stream-event shape) — falls through to plain passthrough below
      }
    }

    if (!evt) {
      onLine(line);
      return;
    }
    if (evt.type === "result") {
      finalResult = evt;
      if (evt.result) onLine(evt.result);
      return;
    }
    for (const formatted of formatStreamEvent(evt)) onLine(formatted);
  }

  child.stdout.on("data", (d) => flush(d, false));
  child.stderr.on("data", (d) => flush(d, true));

  let cancelled = false;

  child.on("error", (err) => {
    onLine(`[error] failed to start: ${err.message}`);
    onDone({ ok: false, error: err.message });
  });

  child.on("close", (code) => {
    if (buffer) handleLine(buffer, false);
    if (cancelled) {
      onLine("[cancelled by user]");
      onDone({ ok: false, cancelled: true });
      return;
    }

    // Only claude's --output-format stream-json produces a type: "result"
    // line; other presets (Codex, Gemini CLI, a custom plain-text command)
    // never set finalResult and fall through to the exit-code-only
    // behavior below, unchanged.
    if (finalResult) {
      const { is_error, permission_denials, subtype, total_cost_usd, duration_ms, usage } = finalResult;
      const denied = permission_denials?.length ? permission_denials : [];
      const ok = code === 0 && !is_error && denied.length === 0;
      if (denied.length) {
        const names = denied.map((d) => d.tool_name).join(", ");
        onLine(`[blocked] permission denied for: ${names} — nobody was present to approve; add the tool to --allowedTools if this should be unattended`);
      }
      // costUsd/durationMs/tokens only ever come from claude's own
      // --output-format stream-json (this whole branch is claude-only to
      // begin with) — left undefined for any other preset, which
      // summarizeUsage() in history.js treats as "unknown cost", distinct
      // from a real $0 run.
      onDone({
        ok,
        exitCode: code,
        subtype,
        blockedTools: denied.map((d) => d.tool_name),
        costUsd: typeof total_cost_usd === "number" ? total_cost_usd : undefined,
        durationMs: typeof duration_ms === "number" ? duration_ms : undefined,
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
      });
      return;
    }

    onDone({ ok: code === 0, exitCode: code });
  });

  return {
    kill: () => {
      cancelled = true;
      child.kill();
    },
  };
}

module.exports = { runJob };
