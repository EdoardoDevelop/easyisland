// Light theme (Impostazioni → Aspetto → Modalità, asked by Edoardo on 25 Oct
// 2026). The island and the settings were drawn dark only, with hundreds of
// colours written straight in the CSS; keeping a second hand-written copy in
// step would never work. So at build time (a Vite plugin, also in dev) every
// CSS file of the island and of the settings gets, after its own rules, the
// same rules again under html[data-scheme="light"] with the colours turned:
// greys flip (dark backgrounds become light, white text becomes dark),
// white veils become black veils, bright coloured text gets darker so it reads
// on white, coloured buttons and tints keep their colour. Rules without
// colours, @keyframes and @font-face are left alone. The page sets
// data-scheme (src/core/uistyle.ts); without it nothing of this applies.
// A rule that comes out wrong is fixed by hand in src/style-light.css and
// src/settings/settings-light.css (loaded after, not transformed).

const COLOR_PROPS = /^(color|background(-color|-image)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|box-shadow|text-shadow|fill|stroke|caret-color|text-decoration-color|column-rule-color|--[\w-]+)$/;

/** Files that get a light copy: the island's and the settings' own styles. */
export function wantsLight(id) {
  const f = id.replace(/\\/g, "/").split("?")[0];
  return /\/src\/(style|style-windows|settings\/settings|settings\/settings-windows)\.css$/.test(f);
}

// ── Colours ───────────────────────────────────────────────────────────────────

function parseColor(s) {
  s = s.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const v = p.map((x) => (x.endsWith("%") ? (parseFloat(x) / 100) * (p.indexOf(x) === 3 ? 1 : 255) : parseFloat(x)));
    if (v.some((x) => Number.isNaN(x))) return null;
    return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 };
  }
  if (s === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (s === "black") return { r: 0, g: 0, b: 0, a: 1 };
  return null;
}

function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h / 6, s, l };
}

function fromHsl({ h, s, l }) {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255 };
}

function out({ r, g, b, a }) {
  const c = (v) => Math.round(Math.max(0, Math.min(255, v)));
  const al = Math.round(Math.max(0, Math.min(1, a)) * 1000) / 1000;
  return al >= 1 ? `rgb(${c(r)}, ${c(g)}, ${c(b)})` : `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${al})`;
}

/**
 * One colour, light. `role`: "text" (what is written), "shadow", or "fill"
 * (backgrounds, borders). `onColour`: the rule paints a coloured background,
 * so its text stays as it is.
 */
function lightColor(c, role, onColour) {
  const hsl = toHsl(c);
  const grey = hsl.s < 0.22 || (hsl.l < 0.12 || hsl.l > 0.94);
  if (role === "shadow") {
    // Shadows stay dark but softer; glows (light shadows) keep their colour.
    if (hsl.l < 0.3) return { ...c, a: c.a * 0.45 };
    return c;
  }
  if (onColour && role === "text") return c;
  if (grey) {
    // Translucent: white veils become black veils (a little stronger, black reads less on white), dark veils fade.
    if (c.a < 1) {
      if (hsl.l > 0.5) return { r: 0, g: 0, b: 0, a: Math.min(1, c.a * 1.15) };
      return { r: 0, g: 0, b: 0, a: c.a * 0.35 };
    }
    // Solid: flip the lightness, keeping a hint of the hue.
    const l = role === "text" ? Math.max(0.08, Math.min(0.62, 1 - hsl.l)) : Math.min(0.99, 1 - hsl.l * 0.9);
    return { ...fromHsl({ h: hsl.h, s: Math.min(hsl.s, 0.12), l }), a: c.a };
  }
  if (role === "text") {
    // Bright coloured text is too pale on white: same hue, darker.
    if (hsl.l > 0.42) return { ...fromHsl({ h: hsl.h, s: Math.min(1, hsl.s * 1.05), l: Math.max(0.26, Math.min(0.36, 1 - hsl.l)) }), a: Math.max(c.a, 0.85) };
    return c;
  }
  // Coloured fills and borders: very dark tones (a tinted dark panel) become pale tints; the rest stays.
  if (hsl.l < 0.22 && c.a > 0.6) return { ...fromHsl({ h: hsl.h, s: Math.min(hsl.s, 0.5), l: 0.93 }), a: c.a };
  return c;
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/g;

function roleOf(prop) {
  if (prop === "color" || prop === "caret-color" || prop === "fill" || prop === "text-decoration-color") return "text";
  if (prop.endsWith("shadow")) return "shadow";
  // The accent and the text on it stay as they are.
  if (prop.startsWith("--") && /accent/.test(prop)) return "keep";
  if (prop.startsWith("--")) return /ink|text|dim|fg/.test(prop) ? "text" : /shadow/.test(prop) ? "shadow" : "fill";
  return "fill";
}

function lightValue(prop, value, onColour) {
  const role = roleOf(prop);
  if (role === "keep") return value;
  return value.replace(COLOR_RE, (m) => {
    const c = parseColor(m);
    return c ? out(lightColor(c, role, onColour)) : m;
  });
}

/** Does this rule paint a coloured (not grey) solid background? */
function paintsColour(decls) {
  for (const [p, v] of decls) {
    if (p !== "background" && p !== "background-color") continue;
    const m = v.match(COLOR_RE);
    if (!m) continue;
    const c = parseColor(m[0]);
    if (!c) continue;
    const hsl = toHsl(c);
    if (hsl.s >= 0.22 && hsl.l >= 0.22 && hsl.l <= 0.94 && c.a >= 0.6) return true;
  }
  return /var\(--(accent|red|green|amber|indigo|cyan|pink)/.test(decls.map(([p, v]) => (p.startsWith("background") ? v : "")).join(" "));
}

// ── CSS ───────────────────────────────────────────────────────────────────────

/** Splits a block of CSS into rules: [{ sel, body }] and at-rules [{ at, body }]. Comments are dropped. */
function rules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const outRules = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < css.length && depth) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    // A stray ";" statement before the rule (e.g. @import) is skipped.
    const sel = head.slice(head.lastIndexOf(";") + 1).trim();
    if (sel.startsWith("@")) outRules.push({ at: sel, body });
    else if (sel) outRules.push({ sel, body });
    i = j;
  }
  return outRules;
}

function decls(body) {
  const list = [];
  // Split on ";" outside parentheses (data: URLs, gradients).
  let depth = 0, start = 0;
  for (let k = 0; k <= body.length; k++) {
    const ch = body[k];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if ((ch === ";" || k === body.length) && depth === 0) {
      const d = body.slice(start, k);
      start = k + 1;
      const c = d.indexOf(":");
      if (c < 0) continue;
      list.push([d.slice(0, c).trim().toLowerCase(), d.slice(c + 1).trim()]);
    }
  }
  return list;
}

/**
 * The selector under html[data-scheme="light"], merged into a leading html[…] or
 * :root. Inside :where(), so the copy weighs exactly as the original: it wins
 * over it by coming later, and loses, as the original did, to more specific
 * rules (".switch.on" over ".switch").
 */
function scope(sel) {
  const attr = ':where([data-scheme="light"])';
  return sel.split(/,(?![^(]*\))/).map((s) => {
    s = s.trim();
    if (s.startsWith(":root")) return `:root${attr}${s.slice(5)}`;
    const m = /^html((?:\[[^\]]*\]|\.[\w-]+|:not\([^)]*\))*)/.exec(s);
    if (m) return `html${m[1]}${attr}${s.slice(m[0].length)}`;
    return `:where(html[data-scheme="light"]) ${s}`;
  }).join(", ");
}

function lightRules(css) {
  let res = "";
  for (const r of rules(css)) {
    if (r.at) {
      if (/^@(media|supports|container)/.test(r.at)) {
        const inner = lightRules(r.body);
        if (inner) res += `${r.at} {\n${inner}}\n`;
      }
      continue;
    }
    const ds = decls(r.body);
    const onColour = paintsColour(ds);
    const changed = [];
    for (const [p, v] of ds) {
      if (p === "color-scheme") {
        changed.push(`${p}: light`);
        continue;
      }
      if (!COLOR_PROPS.test(p)) continue;
      const lv = lightValue(p, v, onColour);
      if (lv !== v) changed.push(`${p}: ${lv}`);
    }
    if (changed.length) res += `${scope(r.sel)} { ${changed.join("; ")} }\n`;
  }
  return res;
}

/** The CSS with its light copy after it. */
export function withLight(css) {
  return `${css}\n/* light theme, generated by scripts/light-css.mjs */\n${lightRules(css)}`;
}

/** The Vite plugin. */
export function lightTheme() {
  return {
    name: "easyisland-light-theme",
    enforce: "pre",
    transform(code, id) {
      if (!wantsLight(id)) return null;
      return { code: withLight(code), map: null };
    },
  };
}
