import React from "react";
import Editor from "@monaco-editor/react";
import { loader } from "@monaco-editor/react";
import { useResolvedTheme } from "../lib/theme.js";

// Monaco code editor for the FileBrowser — replaces the bare <textarea> with
// line numbers + syntax highlighting, while keeping the SAME contract the file
// browser already speaks: a controlled `value` + `onChange`, plus `readOnly`.
//
// SELF-HOSTED, NO CDN. @monaco-editor/react defaults to pulling Monaco off a
// jsdelivr AMD loader at runtime — wrong for a self-hosted control panel that
// must work offline / on a closed network. We import a LEAN slice of the ESM
// build (editor core + only the languages we open) and `loader.config({ monaco })`
// so the wrapper uses our bundled instance instead of reaching out to a CDN.
//
// This module is meant to be LAZY-imported (React.lazy) by the FileBrowser, so
// the Monaco chunk + workers only download once a user actually opens a file —
// they never weigh on first paint or any other route.

// --- lean language set: editor core + just what config/log files need ---------
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/language/json/monaco.contribution";        // JSON: full service (validate/format) → json.worker
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution";     // ini / cfg / conf / properties
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution";     // xml
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";   // yaml / yml
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution"; // .sh (kgsm scripts) — bonus

// Workers (Vite `?worker` → bundled, hashed, no CDN). Only the editor base
// worker and the JSON service worker are ever requested by our language set;
// ini/xml/yaml/shell are pure Monarch tokenizers (highlighting, no worker).
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

if (typeof self !== "undefined") {
  self.MonacoEnvironment = {
    getWorker(_workerId, label) {
      if (label === "json") return new JsonWorker();
      return new EditorWorker();
    },
  };
}

// Hand the wrapper OUR bundled monaco so it never falls back to the CDN loader.
loader.config({ monaco });

// --- a minimal `log` language (Monaco ships none) -----------------------------
// Colors timestamps and severity words so a tailed server log is readable. Pure
// tokenizer; no validation, no worker.
if (!monaco.languages.getLanguages().some((l) => l.id === "log")) {
  monaco.languages.register({ id: "log" });
  monaco.languages.setMonarchTokensProvider("log", {
    tokenizer: {
      root: [
        [/\b\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2}(\.\d+)?)?/, "log-time"],
        [/\b\d{2}:\d{2}:\d{2}(\.\d+)?\b/, "log-time"],
        [/\b(ERROR|FATAL|CRITICAL|SEVERE|PANIC)\b/, "log-error"],
        [/\b(WARN|WARNING)\b/, "log-warn"],
        [/\b(INFO|NOTICE)\b/, "log-info"],
        [/\b(DEBUG|TRACE|VERBOSE)\b/, "log-debug"],
        [/"[^"]*"/, "string"],
        [/'[^']*'/, "string"],
        [/\b\d+(\.\d+)?\b/, "number"],
      ],
    },
  });
}

// --- map a filename to a registered language id -------------------------------
const EXT_LANG = {
  json: "json", json5: "json",
  ini: "ini", cfg: "ini", conf: "ini", cnf: "ini", properties: "ini", env: "ini", toml: "ini",
  xml: "xml", svg: "xml", xsd: "xml", config: "xml",
  yaml: "yaml", yml: "yaml",
  sh: "shell", bash: "shell",
  log: "log",
};
function languageForPath(path) {
  if (!path) return "plaintext";
  const base = String(path).split("/").pop().toLowerCase();
  const ext = base.includes(".") ? base.split(".").pop() : "";
  return EXT_LANG[ext] || "plaintext";
}

// --- our palette as a Monaco theme, SAMPLED FROM the CSS tokens ----------------
// Monaco can't read CSS custom properties, so we sample the resolved design
// tokens off <html> at theme-apply time and (re)define the editor theme. This is
// called once up-front (boot theme) and again whenever the theme store flips
// (light/dark) — see the component below — so the editor follows the rest of the
// app instead of restating a hardcoded palette that drifts.
function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}
const noHash = (c) => String(c).replace("#", "");

function defineKgsmTheme(resolved) {
  const light = resolved === "light";
  const T = {
    bg:        cssVar("--surface-0", light ? "#ECEFF4" : "#0E141C"),
    surface2:  cssVar("--surface-2", light ? "#F1F4F8" : "#161C25"),
    fg1:       cssVar("--fg-1", light ? "#101826" : "#F2F5F9"),
    fg3:       cssVar("--fg-3", light ? "#5F6B7A" : "#7C8899"),
    fg4:       cssVar("--fg-4", light ? "#97A2B0" : "#515E70"),
    teal:      cssVar("--krystal-teal", light ? "#1E7E9C" : "#40A0C0"),
    tealHover: cssVar("--krystal-teal-hover", light ? "#2A93B3" : "#5DB5D2"),
    green:     cssVar("--success-fg", light ? "#15803D" : "#4ADE80"),
    amber:     cssVar("--warning-fg", light ? "#B45309" : "#FBBF24"),
    rose:      cssVar("--danger-fg", light ? "#B91C1C" : "#FB7185"),
    sky:       cssVar("--info-fg", light ? "#0369A1" : "#7DD3FC"),
  };
  // Low-alpha overlays (selection, line highlight, indent guides, scrollbar) must
  // match the theme's polarity — white-alpha on dark, black-alpha on light — or
  // they vanish / smear. Derive them from the resolved theme rather than hardcode.
  const veil = (aa) => (light ? "#000000" : "#FFFFFF") + aa;

  monaco.editor.defineTheme("kgsm", {
    base: light ? "vs" : "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: noHash(T.fg3), fontStyle: "italic" },
      { token: "string", foreground: noHash(T.green) },
      { token: "number", foreground: noHash(T.amber) },
      { token: "keyword", foreground: noHash(T.teal) },
      { token: "type", foreground: noHash(T.sky) },
      { token: "key", foreground: noHash(T.tealHover) },        // ini / yaml keys
      { token: "delimiter", foreground: noHash(T.fg3) },
      { token: "tag", foreground: noHash(T.teal) },             // xml tags
      { token: "attribute.name", foreground: noHash(T.sky) },
      { token: "attribute.value", foreground: noHash(T.green) },
      { token: "metatag", foreground: noHash(T.fg3) },
      { token: "log-time", foreground: noHash(T.fg3) },
      { token: "log-error", foreground: noHash(T.rose), fontStyle: "bold" },
      { token: "log-warn", foreground: noHash(T.amber), fontStyle: "bold" },
      { token: "log-info", foreground: noHash(T.teal) },
      { token: "log-debug", foreground: noHash(T.fg4) },
    ],
    colors: {
      "editor.background": T.bg,
      "editor.foreground": T.fg1,
      "editorLineNumber.foreground": T.fg4,
      "editorLineNumber.activeForeground": T.fg3,
      "editorCursor.foreground": T.teal,
      "editor.selectionBackground": T.teal + "33",
      "editor.lineHighlightBackground": veil("08"),
      "editor.inactiveSelectionBackground": T.teal + "1F",
      "editorIndentGuide.background1": veil("0A"),
      "editorIndentGuide.activeBackground1": veil("1F"),
      "editorWhitespace.foreground": veil("14"),
      "editorWidget.background": T.surface2,
      "editorWidget.border": veil("1F"),
      "input.background": T.bg,
      "scrollbarSlider.background": veil("14"),
      "scrollbarSlider.hoverBackground": veil("24"),
    },
  });
}

// Define once up-front from the boot theme so the first mount paints correctly
// even before the component's effect runs.
defineKgsmTheme(typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark");

const OPTIONS = {
  minimap: { enabled: false },
  fontFamily: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontSize: 13,
  lineHeight: 21,
  tabSize: 4,
  scrollBeyondLastLine: false,
  automaticLayout: true,            // track the flex container's size changes
  fixedOverflowWidgets: true,       // find widget escapes the card's overflow:hidden
  renderWhitespace: "selection",
  smoothScrolling: true,
  cursorBlinking: "smooth",
  stickyScroll: { enabled: false },
  padding: { top: 12, bottom: 12 },
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
};

// `value` / `onChange` / `readOnly` mirror the textarea the FileBrowser used, so
// the dirty/etag/save flow upstream is untouched. `path` gives Monaco a stable
// per-file model (separate undo history + scroll position per file).
//
// `wrap` is off by default and belongs to PROSE, not code: a config file or a log
// line means something by its column, and folding one onto the next reads as a
// second line that isn't there. A memory's note has no columns and is written on a
// phone, where an unwrapped sentence runs off the side and cannot be read at all.
export default function CodeEditor({ value, onChange, path, readOnly = false, wrap = false }) {
  // Follow the app theme: redefine "kgsm" from the now-resolved CSS tokens and
  // re-apply it to every live editor whenever the theme flips (light/dark/auto).
  const resolved = useResolvedTheme();
  React.useEffect(() => {
    defineKgsmTheme(resolved);
    monaco.editor.setTheme("kgsm");
  }, [resolved]);
  return (
    <Editor
      className="fb-editor__monaco"
      height="100%"
      theme="kgsm"
      path={path || undefined}
      language={languageForPath(path)}
      value={value}
      onChange={(v) => onChange && onChange(v ?? "")}
      options={{ ...OPTIONS, readOnly, wordWrap: wrap ? "on" : "off" }}
      loading={<div className="fb-editor__empty"><span className="oauth-spinner" /> Loading editor…</div>}
    />
  );
}

export { languageForPath };
