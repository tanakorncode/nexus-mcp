// Small ANSI SGR-code renderer for the activity window's terminal-style
// log view (GitLab-job-log look). Loaded as a plain <script> in the
// renderer (no bundler, no nodeIntegration) — pure function, safe to also
// `require()` from the main process, so it's written to work either way.
//
// Deliberately not a full ANSI parser (no 256-color/RGB SGR codes, no
// cursor movement) — covers what real CLI tool output actually uses in
// practice (basic 16 colors + bold + reset), and unescaped/escaped text
// is always HTML-escaped first so nothing in the underlying content
// (which traces back to Nexus task/comment text) can inject markup.

const FG = {
  30: "#6e7681", 31: "#f85149", 32: "#3fb950", 33: "#d29922",
  34: "#58a6ff", 35: "#bc8cff", 36: "#39c5cf", 37: "#c9d1d9",
  90: "#6e7681", 91: "#ffa198", 92: "#56d364", 93: "#e3b341",
  94: "#79c0ff", 95: "#d2a8ff", 96: "#56d4dd", 97: "#f0f6fc",
};
const BG = {
  40: "#6e7681", 41: "#f85149", 42: "#3fb950", 43: "#d29922",
  44: "#58a6ff", 45: "#bc8cff", 46: "#39c5cf", 47: "#c9d1d9",
};

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ansiToHtml(text) {
  const escaped = escapeHtml(text);
  const parts = escaped.split(/\x1b\[([0-9;]*)m/);
  // parts alternates: [plainText, codes, plainText, codes, ...]
  let html = "";
  let open = false;
  let style = { bold: false, fg: null, bg: null };

  const closeSpan = () => { if (open) { html += "</span>"; open = false; } };
  const openSpan = () => {
    const decl = [];
    if (style.bold) decl.push("font-weight:bold");
    if (style.fg) decl.push(`color:${style.fg}`);
    if (style.bg) decl.push(`background:${style.bg}`);
    html += decl.length ? `<span style="${decl.join(";")}">` : "<span>";
    open = true;
  };

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (!parts[i]) continue;
      if (!open && (style.bold || style.fg || style.bg)) openSpan();
      else if (!open) { html += parts[i]; continue; }
      html += parts[i];
    } else {
      const codes = parts[i].split(";").filter(Boolean).map(Number);
      if (codes.length === 0) codes.push(0);
      for (const code of codes) {
        if (code === 0) { style = { bold: false, fg: null, bg: null }; }
        else if (code === 1) style.bold = true;
        else if (code === 22) style.bold = false;
        else if (code === 39) style.fg = null;
        else if (code === 49) style.bg = null;
        else if (FG[code]) style.fg = FG[code];
        else if (BG[code]) style.bg = BG[code];
      }
      closeSpan();
    }
  }
  closeSpan();
  return html;
}

if (typeof module !== "undefined") module.exports = { ansiToHtml };
