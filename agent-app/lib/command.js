// Turns a command template like `claude -p "{{prompt}}"` plus a real prompt
// string into a safe { cmd, args } for spawn(cmd, args, { shell: false }).
//
// Deliberately never builds a shell string and never runs with shell: true —
// the prompt text comes from Nexus task/comment content (user-controlled),
// so passing it through a shell would be a command-injection risk if it
// ever contained characters like `; rm -rf` or `$(...)`. Tokenizing the
// template BEFORE substitution and injecting the prompt as a single argv
// element after avoids that entirely: the prompt is never parsed as shell
// syntax, no matter what it contains.

const PLACEHOLDER = "{{prompt}}";

function tokenize(template) {
  const tokens = [];
  let current = "";
  let quote = null;

  for (const ch of template) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === " ") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function buildCommand(template, prompt) {
  const tokens = tokenize(template).map((t) => (t === PLACEHOLDER ? prompt : t));
  if (tokens.length === 0) throw new Error("command template is empty");
  return { cmd: tokens[0], args: tokens.slice(1) };
}

module.exports = { buildCommand, tokenize, PLACEHOLDER };
