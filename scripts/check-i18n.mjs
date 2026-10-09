// Every string passed to t() / tn() / N_() (src/**/*.ts) and to t() / tf()
// (src-tauri/src/**/*.rs, files that use crate::i18n) must have its English
// in src/i18n/en.json, keyed by the Italian text. Lists what is missing and
// what is no longer used; exits 1 when something is missing.
//
//   npm run check:i18n             the check
//   npm run check:i18n -- --todo   the missing keys as JSON, to fill in

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const table = JSON.parse(readFileSync(join(root, "src/i18n/en.json"), "utf8"));

function files(dir, ext) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, ext));
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

/** The code without its comment lines (their examples are not strings in use). */
const code = (text) => text.split("\n").map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l)).join("\n");

/** The literal's text: escapes as JSON reads them. */
const unescape = (raw) => JSON.parse(`"${raw.replace(/\\'/g, "'")}"`);

const used = new Map(); // key → first place
const note = (key, where) => { if (!used.has(key)) used.set(key, where); };

const STR = String.raw`"((?:[^"\\\n]|\\.)*)"`;
for (const f of files(join(root, "src"), ".ts")) {
  const text = code(readFileSync(f, "utf8"));
  for (const m of text.matchAll(new RegExp(String.raw`\b(?:t|N_)\(\s*${STR}`, "g"))) note(unescape(m[1]), f);
  for (const m of text.matchAll(new RegExp(String.raw`\btn\(\s*${STR}\s*,\s*${STR}`, "g"))) {
    note(unescape(m[1]), f);
    note(unescape(m[2]), f);
  }
}
for (const f of files(join(root, "src-tauri/src"), ".rs")) {
  const text = readFileSync(f, "utf8");
  if (!/i18n::|use crate::i18n/.test(text) && !f.endsWith("i18n.rs")) continue;
  const body = code(text.split("#[cfg(test)]")[0]);
  for (const m of body.matchAll(new RegExp(String.raw`\b(?:t|tf)\(\s*${STR}`, "g"))) note(unescape(m[1]), f);
}

const missing = [...used.keys()].filter((k) => !(k in table));
const unused = Object.keys(table).filter((k) => !used.has(k));

if (process.argv.includes("--todo")) {
  console.log(JSON.stringify(Object.fromEntries(missing.map((k) => [k, ""])), null, 2));
  process.exit(0);
}
for (const k of missing) console.log(`manca: ${JSON.stringify(k)}  (${used.get(k).slice(root.length)})`);
for (const k of unused) console.log(`non usata: ${JSON.stringify(k)}`);
console.log(`${used.size} testi, ${missing.length} senza inglese, ${unused.length} inutilizzati`);
process.exit(missing.length ? 1 : 0);
