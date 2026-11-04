// Devolutions Cloud in the RDM card (src-tauri/src/dvc.rs): the vaults'
// folders, their entries (connections, credentials, password lists) with the
// details but never a password, «Copia password» (Rust puts it on the
// clipboard, private, and empties it), a new credential or a «Lista Password»
// made from a folder after a preview and a second click, read back and
// checked; a customer (Zammad organization, 3CX contact) tied to a folder.
// Nothing is deleted. The view lives outside the card (rdm.ts rebuilds the
// card at each update): what is typed stays.

import { h, clear } from "./dom";
import { State } from "../core/state";
import { Bridge, type DvcBrowse, type DvcDetails, type DvcItem, type DvcOutcome } from "../core/bridge";
import { t } from "../core/i18n";
import { Sound } from "../core/sound";
import { kindLabel } from "./rdm";

const COLOR = "#E8542A";

type Form =
  | { kind: "cred"; name: string; user: string; domain: string; password: string; description: string }
  | { kind: "list"; name: string; recurse: boolean };

const dv = {
  el: null as HTMLElement | null,
  vault: "",
  path: "",
  browse: null as DvcBrowse | null,
  open: new Set<string>(),
  details: new Map<string, DvcDetails | string>(),
  form: null as Form | null,
  preview: null as string[] | null,
  result: null as DvcOutcome | null,
  busy: false,
  error: "",
  note: "",
  noteTimer: 0,
  tie: "",
};

const errText = (e: unknown) => String(e).replace(/^Error:\s*/, "");

/** Opens the cloud view on a folder (a customer tied to it, rdm.ts rdmLookFor). */
export function dvcGoTo(vault: string, path: string) {
  dv.vault = vault;
  void go(path);
}

/** The customers tied to folders, lower case → folder. */
function ties(): Record<string, { vault: string; path: string }> {
  return State.settings.integrationConfig.rdmFolders ?? {};
}

/** The folder tied to a customer, if any. */
export function dvcFolderFor(customer: string): { vault: string; path: string } | null {
  return ties()[customer.trim().toLowerCase()] ?? null;
}

function tieFolder(customer: string, folder: { vault: string; path: string } | null) {
  const key = customer.trim().toLowerCase();
  if (!key) return;
  const all = { ...ties() };
  if (folder) all[key] = folder;
  else delete all[key];
  State.settings.integrationConfig.rdmFolders = all;
  void Bridge.saveSettings(State.settings);
}

async function go(path: string) {
  dv.path = path;
  dv.form = null;
  dv.preview = null;
  dv.result = null;
  dv.error = "";
  dv.open.clear();
  dv.browse = await Bridge.dvcBrowse(dv.vault, path);
  if (dv.browse) dv.vault = dv.browse.vault;
  draw();
  State.notify();
}

function say(text: string) {
  dv.note = text;
  window.clearTimeout(dv.noteTimer);
  dv.noteTimer = window.setTimeout(() => { dv.note = ""; draw(); }, 6000);
  draw();
}

async function copyPassword(e: DvcItem, row: number | null) {
  try {
    const secs = await Bridge.dvcCopyPassword(e.vault, e.id, row);
    Sound.play("blip");
    say(t("Password negli appunti: si svuotano tra {s} secondi.", { s: secs }));
  } catch (err) {
    Sound.play("error");
    say(errText(err));
  }
}

async function toggleDetails(e: DvcItem) {
  if (dv.open.has(e.id)) {
    dv.open.delete(e.id);
    draw();
    return;
  }
  dv.open.add(e.id);
  if (!dv.details.has(e.id) || typeof dv.details.get(e.id) === "string") {
    dv.details.set(e.id, t("Leggo…"));
    draw();
    try {
      dv.details.set(e.id, await Bridge.dvcDetails(e.vault, e.id));
    } catch (err) {
      dv.details.set(e.id, errText(err));
    }
  }
  draw();
  State.notify();
}

/** The form's step: preview (`confirm` false) or the write, read back and checked. */
async function submit(confirm: boolean) {
  const f = dv.form;
  if (!f || dv.busy) return;
  dv.busy = true;
  dv.error = "";
  draw();
  try {
    const out = f.kind === "cred"
      ? await Bridge.dvcNewCredential({ vault: dv.vault, folder: dv.path, name: f.name, user: f.user, domain: f.domain, password: f.password, description: f.description, confirm })
      : await Bridge.dvcNewPasswordList({ vault: dv.vault, folder: dv.path, name: f.name, source: dv.path, recurse: f.recurse, confirm });
    if (confirm) {
      dv.result = out;
      dv.preview = null;
      if (f.kind === "cred") f.password = "";
      dv.form = null;
      Sound.play(out.rows.every((r) => r.userOk && r.passwordOk) ? "send" : "error");
      dv.busy = false;
      const keep = dv.result;
      await go(dv.path);
      dv.result = keep;
    } else {
      dv.preview = out.preview;
    }
  } catch (err) {
    dv.error = errText(err);
    Sound.play("error");
  }
  dv.busy = false;
  draw();
  State.notify();
}

const ICON: Record<string, string> = { Credential: "🔑", PasswordList: "📋" };

function icon(e: DvcItem): string {
  if (e.cred === "PasswordList") return ICON.PasswordList;
  if (e.kind.startsWith("Credential")) return ICON.Credential;
  return "";
}

function isConnection(e: DvcItem): boolean {
  return e.kind !== "Group" && !e.kind.startsWith("Credential");
}

function btn(text: string, onclick: () => void, title = ""): HTMLElement {
  return h("button", { class: "link-btn", style: `color:${COLOR}d9`, text, title,
    onclick: (ev: Event) => { ev.stopPropagation(); onclick(); } });
}

/** A field of a form: its value lives in the form, not in the input. */
function field(label: string, value: string, set: (v: string) => void, type = "text", placeholder = ""): HTMLElement {
  const input = h("input", { class: "nc-input dvc-input", type, value, placeholder, spellcheck: "false", autocomplete: "off", "data-k": label }) as HTMLInputElement;
  input.addEventListener("input", () => { set(input.value); if (dv.preview) { dv.preview = null; draw(); input.focus(); } });
  input.addEventListener("keydown", (e) => e.stopPropagation());
  input.addEventListener("paste", (e) => e.stopPropagation());
  return h("label", { class: "dvc-field" }, h("span", { text: label }), input);
}

function formPart(): HTMLElement | null {
  const f = dv.form;
  if (!f) return null;
  const box = h("div", { class: "dvc-form" });
  if (f.kind === "cred") {
    box.append(h("b", { text: t("Nuova credenziale in «{p}»", { p: dv.path }) }),
      field(t("Nome"), f.name, (v) => { f.name = v; }),
      field(t("Utente"), f.user, (v) => { f.user = v; }),
      field(t("Dominio"), f.domain, (v) => { f.domain = v; }, "text", t("facoltativo")),
      field(t("Password"), f.password, (v) => { f.password = v; }, "password"),
      field(t("Descrizione"), f.description, (v) => { f.description = v; }, "text", t("facoltativa")));
  } else {
    const rec = h("input", { type: "checkbox" }) as HTMLInputElement;
    rec.checked = f.recurse;
    rec.addEventListener("change", () => { f.recurse = rec.checked; dv.preview = null; draw(); });
    box.append(h("b", { text: t("Lista password dalle credenziali di «{p}»", { p: dv.path }) }),
      field(t("Nome"), f.name, (v) => { f.name = v; }),
      h("label", { class: "dvc-check" }, rec, h("span", { text: t("anche dalle sottocartelle") })));
  }
  if (dv.preview) {
    box.append(h("div", { class: "dvc-preview" }, ...dv.preview.map((l) => h("div", { text: l }))));
  }
  if (dv.error) box.append(h("div", { class: "notion-note bad", text: dv.error }));
  box.append(h("div", { class: "dvc-actions" },
    dv.preview
      ? h("button", { class: "teams-btn light dvc-go", text: dv.busy ? t("Scrivo e verifico…") : t("Conferma e crea"), disabled: dv.busy ? "true" : undefined,
        onclick: (e: Event) => { e.stopPropagation(); void submit(true); } })
      : h("button", { class: "teams-btn plain", text: dv.busy ? t("Controllo…") : t("Anteprima"), disabled: dv.busy ? "true" : undefined,
        onclick: (e: Event) => { e.stopPropagation(); void submit(false); } }),
    h("button", { class: "teams-btn plain", text: t("Annulla"),
      onclick: (e: Event) => { e.stopPropagation(); dv.form = null; dv.preview = null; dv.error = ""; draw(); State.notify(); } })));
  return box;
}

function resultPart(): HTMLElement | null {
  const r = dv.result;
  if (!r) return null;
  const ok = r.rows.every((x) => x.userOk && x.passwordOk);
  return h("div", { class: ok ? "dvc-result ok" : "dvc-result bad" },
    h("b", { text: ok ? t("Creata e verificata ✓") : t("Creata, ma la verifica non torna: controlla in RDM") }),
    ...r.rows.map((x) => h("div", { text: `${x.userOk && x.passwordOk ? "✓" : "✗"} ${x.row}${x.userOk ? "" : ` · ${t("utente diverso")}`}${x.passwordOk ? "" : ` · ${t("password diversa")}`}` })),
    btn(t("Chiudi"), () => { dv.result = null; draw(); State.notify(); }));
}

function detailsPart(e: DvcItem): HTMLElement | null {
  if (!dv.open.has(e.id)) return null;
  const d = dv.details.get(e.id);
  if (!d) return null;
  if (typeof d === "string") return h("div", { class: "dvc-details" }, h("span", { class: "notion-note", text: d }));
  const line = (label: string, value: string, copy = false) => value
    ? h("div", { class: "dvc-kv" }, h("span", { text: label }), h("b", { text: value }),
      copy ? btn(t("Copia"), () => void navigator.clipboard.writeText(value).then(() => say(t("Copiato: {h}", { h: value })))) : null)
    : null;
  const box = h("div", { class: "dvc-details" },
    line(t("Utente"), d.domain ? `${d.domain}\\${d.user}` : d.user, true),
    line(t("Host"), d.host, true),
    line(t("Descrizione"), d.description),
    d.length ? h("div", { class: "dvc-kv" }, h("span", { text: t("Password") }), h("b", { text: t("{n} caratteri", { n: d.length }) }),
      btn(t("Copia password"), () => void copyPassword(e, null))) : null);
  if (d.rows.length) {
    box.append(h("div", { class: "dvc-rows" }, ...d.rows.map((r, i) => h("div", { class: "dvc-row" },
      h("b", { text: r.name || "—" }),
      h("span", { text: [r.domain ? `${r.domain}\\${r.user}` : r.user, r.host].filter(Boolean).join(" · ") }),
      r.length ? btn(t("Copia password"), () => void copyPassword(e, i)) : h("small", { text: t("senza password") })))));
  }
  return box;
}

function entryRow(e: DvcItem): HTMLElement {
  const open = dv.open.has(e.id);
  const mark = icon(e);
  return h("div", { class: "dvc-entry" },
    h("div", { class: "int-page rdm-row", role: "button", title: [e.folder, e.host].filter(Boolean).join(" · ") || e.name,
      onclick: () => void toggleDetails(e) },
    mark ? h("span", { class: "dvc-icon", text: mark }) : h("span", { class: "rdm-kind", text: kindLabel(e.kind) }),
    h("span", { class: "int-name", text: e.name }),
    e.user ? h("span", { class: "int-ago", text: e.user }) : null,
    h("span", { class: "dvc-tools" },
      isConnection(e) ? btn(t("Apri"), () => void Bridge.rdmOpen({ id: e.id, name: e.name, group: e.folder, host: e.host, kind: e.kind })
        .then(() => Sound.play("blip")).catch((err) => say(errText(err))), t("Apri in Remote Desktop Manager")) : null,
      e.kind.startsWith("Credential") && e.cred !== "PasswordList" ? btn("🔑", () => void copyPassword(e, null), t("Copia password")) : null,
      h("span", { class: "dvc-chev", text: open ? "▾" : "▸" }))),
    detailsPart(e));
}

function crumbs(b: DvcBrowse): HTMLElement {
  const bar = h("div", { class: "dvc-crumbs" });
  if (b.vaults.length > 1) {
    const pick = h("select", { class: "dvc-vault" }) as HTMLSelectElement;
    for (const v of b.vaults) pick.append(h("option", { value: v.id, text: v.name }));
    pick.value = b.vault;
    pick.addEventListener("change", () => { dv.vault = pick.value; void go(""); });
    bar.append(pick);
  } else {
    bar.append(btn(`☁ ${b.vaults[0]?.name ?? "Cloud"}`, () => void go("")));
  }
  const parts = b.path ? b.path.split("\\") : [];
  parts.forEach((p, i) => {
    bar.append(h("span", { class: "dvc-sep", text: "›" }));
    const to = parts.slice(0, i + 1).join("\\");
    bar.append(i === parts.length - 1 ? h("b", { text: p }) : btn(p, () => void go(to)));
  });
  return bar;
}

function tiePart(): HTMLElement | null {
  if (!dv.path) return null;
  const here = Object.entries(ties()).filter(([, f]) => f.vault === dv.vault && f.path.toLowerCase() === dv.path.toLowerCase());
  const input = h("input", { class: "nc-input dvc-input", value: dv.tie, spellcheck: "false", "data-k": "tie",
    placeholder: t("Cliente di Zammad o 3CX (es. Farmacia Falchi)") }) as HTMLInputElement;
  input.addEventListener("input", () => { dv.tie = input.value; });
  const add = () => {
    if (!dv.tie.trim()) return;
    tieFolder(dv.tie, { vault: dv.vault, path: dv.path });
    say(t("«{c}» porta a questa cartella.", { c: dv.tie.trim() }));
    dv.tie = "";
  };
  input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") add(); });
  return h("div", { class: "dvc-tie" },
    h("span", { class: "dvc-tie-label", text: t("Cliente") }),
    ...here.map(([name]) => h("span", { class: "dvc-chip" }, h("span", { text: name }),
      h("button", { text: "✕", title: t("Scollega"), onclick: (e: Event) => { e.stopPropagation(); tieFolder(name, null); draw(); } }))),
    input, btn(t("Collega"), add, t("Su un ticket Zammad o una chiamata 3CX di questo cliente, RDM apre questa cartella")));
}

function draw() {
  const el = dv.el;
  if (!el) return;
  const focused = el.ownerDocument.activeElement;
  const keep = focused instanceof HTMLInputElement && el.contains(focused) ? focused.dataset.k ?? "" : "";
  clear(el);
  const b = dv.browse;
  if (!b || !b.vaults.length) {
    el.append(h("div", { class: "notion-note", text: t("Nessun vault letto: premi Sincronizza (in alto) dopo aver messo indirizzo, Key e Secret in Impostazioni → Remote Desktop Manager.") }));
    return;
  }
  el.append(crumbs(b));
  for (const f of b.folders) {
    el.append(h("div", { class: "int-page rdm-row dvc-folder", role: "button", onclick: () => void go(f.path) },
      h("span", { class: "dvc-icon", text: "📁" }), h("span", { class: "int-name", text: f.name }),
      h("span", { class: "int-ago", text: String(f.count) })));
  }
  for (const e of b.entries) el.append(entryRow(e));
  if (!b.folders.length && !b.entries.length) el.append(h("div", { class: "notion-note", text: t("Cartella vuota.") }));
  const res = resultPart();
  if (res) el.append(res);
  const form = formPart();
  if (form) el.append(form);
  else if (b.path) {
    el.append(h("div", { class: "rdm-actions" },
      btn(t("+ Credenziale"), () => { dv.form = { kind: "cred", name: "", user: "", domain: "", password: "", description: "" }; dv.result = null; draw(); State.notify(); }),
      btn(t("+ Lista password da questa cartella"), () => { dv.form = { kind: "list", name: t("Lista Password"), recurse: false }; dv.result = null; draw(); State.notify(); })));
  }
  const tie = tiePart();
  if (tie) el.append(tie);
  if (dv.note) el.append(h("div", { class: "notion-note", text: dv.note }));
  // The field being typed in keeps the caret across a redraw.
  if (keep) {
    const again = Array.from(el.querySelectorAll("input")).find((i) => i.dataset.k === keep);
    again?.focus();
  }
}

/** The view, the same element at every rebuild of the card. */
export function dvcView(): HTMLElement {
  if (!dv.el) {
    dv.el = h("div", { class: "dvc-view", onpointerdown: () => void Bridge.focusWindow(true) });
    void go(dv.path);
  } else if (!dv.form) {
    // A sync may have changed the folder: read it again (from the saved list).
    void Bridge.dvcBrowse(dv.vault, dv.path).then((b) => { if (b && !dv.form) { dv.browse = b; draw(); } });
  }
  return dv.el;
}
