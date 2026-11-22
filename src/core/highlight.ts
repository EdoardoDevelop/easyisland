// Colours in the code of the chat's answers (22 Nov 2026, Edoardo): highlight.js
// with only the languages EasyIsland's work meets (scripts, web, data, the
// project's own), so the bundle stays small. Its output is HTML that
// highlight.js escapes itself; the colours are ours (highlight.css).

import hljs from "highlight.js/lib/core";
import "./highlight.css";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import dos from "highlight.js/lib/languages/dos";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGS = { bash, cpp, csharp, css, diff, dockerfile, dos, go, ini, java, javascript, json, markdown, nginx, php, powershell, python, rust, shell, sql, typescript, xml, yaml };
for (const [name, lang] of Object.entries(LANGS)) hljs.registerLanguage(name, lang);
// Names the engines write that highlight.js does not know as such.
hljs.registerAliases(["ps1", "ps", "pwsh"], { languageName: "powershell" });
hljs.registerAliases(["cmd", "bat", "batch"], { languageName: "dos" });
hljs.registerAliases(["html", "svg", "vue"], { languageName: "xml" });
hljs.registerAliases(["toml", "conf", "env"], { languageName: "ini" });
hljs.registerAliases(["jsonc", "json5"], { languageName: "json" });

/** Past this, the code stays plain (a long log pasted back would cost every redraw). */
const MAX = 40_000;
/** Without a language, guessed only on this much and among these. */
const GUESS_MAX = 6_000;
const GUESS = ["powershell", "bash", "json", "javascript", "typescript", "python", "sql", "xml", "css", "yaml", "rust", "csharp"];

/**
 * `code` with its colours in `into` (a <code>); plain text when the language
 * is unknown, the code too long, or the guess unsure. Returns the language used.
 */
export function highlightInto(into: HTMLElement, code: string, lang: string): string {
  into.textContent = code;
  if (!code || code.length > MAX) return "";
  const name = lang.trim().toLowerCase().split(/\s+/)[0] ?? "";
  try {
    if (name && hljs.getLanguage(name)) {
      into.innerHTML = hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
      into.classList.add("hljs");
      return name;
    }
    if (name || code.length > GUESS_MAX) return "";
    const guess = hljs.highlightAuto(code, GUESS);
    // A weak guess colours prose and logs wrongly: plain is better.
    if (!guess.language || guess.relevance < 6) return "";
    into.innerHTML = guess.value;
    into.classList.add("hljs");
    return guess.language;
  } catch {
    into.textContent = code;
    return "";
  }
}
