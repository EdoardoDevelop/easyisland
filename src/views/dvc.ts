// Devolutions Cloud inside the RDM card (src-tauri/src/dvc.rs): vault pills,
// breadcrumbs, collapsible inline folders and client groups, favorites and
// recents (integrationConfig.rdmPins and rdmRecent, never secrets), rich 2-line
// entry cards with inline SVG type icons and quick actions, search grouped by
// folder, side-by-side detail pane when wide, and preview-confirmed creation
// forms. Passwords are never stored in DOM or settings: «Copia password» uses
// Rust's private 30s clipboard, and the eye asks Rust for a 30s reveal.

import { h, clear, svg } from "./dom";
import { ICONS } from "./icons";
import { State } from "../core/state";
import { Bridge, type DvcBrowse, type DvcDetails, type DvcItem, type DvcOutcome } from "../core/bridge";
import { t } from "../core/i18n";
import { Sound } from "../core/sound";
import {
  dvcToRef,
  getDvcPins,
  getDvcRecents,
  isPinnedRef,
  kindInfo,
  rdmActionBtn,
  rdmCopyText,
  rdmFolderTail,
  rdmIconChip,
  rdmKindPill,
  rdmSectionHead,
  recordDvcRecent,
  togglePinRef,
} from "./rdm";

type Form =
  | { kind: "cred"; name: string; user: string; domain: string; password: string; description: string }
  | { kind: "list"; name: string; recurse: boolean };

/** How long a password shown with the eye stays visible. */
const SHOW_MS = 30_000;
const INITIAL_RECENTS = 5;

const dv = {
  el: null as HTMLElement | null,
  vault: "",
  path: "",
  browse: null as DvcBrowse | null,
  /** Cached folder reads ("vault|path" → DvcBrowse), cleared on sync or write. */
  browseCache: new Map<string, DvcBrowse>(),
  /** Subfolders expanded inline ("vault|path"). */
  expanded: new Set<string>(),
  loadingFolders: new Set<string>(),
  /** Search query mirrored from rdm.ts so results live inside the split layout. */
  searchQuery: "",
  searchFound: [] as DvcItem[],
  searchLoading: false,
  /** Collapsed group ids for search groups, pins and recents. */
  collapsedGroups: new Set<string>(),
  showAllRecents: false,
  /** Highlighted keyboard row key. */
  activeKey: "",
  /** The entry whose details are in the pane (below, or beside when wide). */
  sel: "",
  selItem: null as DvcItem | null,
  details: new Map<string, DvcDetails | string>(),
  /** Passwords shown with the eye: "id|row" → password, hidden again after SHOW_MS. */
  shown: new Map<string, string>(),
  shownTimers: new Map<string, number>(),
  revealing: "",
  form: null as Form | null,
  preview: null as string[] | null,
  result: null as DvcOutcome | null,
  busy: false,
  error: "",
  note: "",
  noteTimer: 0,
  tieOpen: false,
  tie: "",
  /** Callback to tell rdm.ts when user clicks a folder/entry from search. */
  onClearSearch: null as (() => void) | null,
};

const errText = (e: unknown) => String(e).replace(/^Error:\s*/, "");
const cacheKey = (vault: string, path: string) => `${vault}|${path.toLowerCase()}`;

/** Clears cached folder listings (called on Sincronizza or after creating an item). */
export function dvcResetCache() {
  dv.browseCache.clear();
  dv.details.clear();
  if (dv.el && dv.browse) {
    void reloadExpanded();
  }
}

async function reloadExpanded() {
  await go(dv.path, { keepSel: true });
  for (const key of [...dv.expanded]) {
    const idx = key.indexOf("|");
    if (idx < 0) continue;
    const vault = key.slice(0, idx);
    const path = key.slice(idx + 1);
    if (vault !== dv.vault) continue;
    const b = await Bridge.dvcBrowse(vault, path).catch(() => null);
    if (b) {
      dv.browseCache.set(cacheKey(vault, b.path), b);
    }
  }
  draw();
}

/** Updates the search results shown inside the DVC split workspace. */
export function dvcSetSearch(query: string, found: DvcItem[], loading: boolean, onClear?: () => void) {
  dv.searchQuery = query;
  dv.searchFound = found;
  dv.searchLoading = loading;
  if (onClear) dv.onClearSearch = onClear;
  draw();
}

/** Opens the cloud view on a folder (a customer tied to it, rdm.ts rdmLookFor). */
export function dvcGoTo(vault: string, path: string) {
  dv.vault = vault;
  dv.searchQuery = "";
  dv.searchFound = [];
  void go(path);
}

/** The cloud view on an entry's folder, with its pane open (the search field, rdm.ts rdmShowEntry). */
export async function dvcShowEntry(e: DvcItem) {
  dv.vault = e.vault;
  dv.searchQuery = "";
  dv.searchFound = [];
  await go(e.folder);
  const here = dv.browse?.entries.find((x) => x.id === e.id) ?? e;
  if (dv.sel !== here.id) await openDetails(here);
  dv.el?.querySelector(".dvc-entry.on")?.scrollIntoView({ block: "nearest" });
}

/** The customers tied to folders, lower case → folder. */
function ties(): Record<string, { vault: string; path: string }> {
  return State.settings.integrationConfig.rdmFolders ?? {};
}

/** The folder tied to a customer, if any. */
export function dvcFolderFor(customer: string): { vault: string; path: string } | null {
  return ties()[customer.trim().toLowerCase()] ?? null;
}

function tiesForPath(vault: string, path: string): string[] {
  const low = path.toLowerCase();
  return Object.entries(ties())
    .filter(([, f]) => f.vault === vault && f.path.toLowerCase() === low)
    .map(([name]) => name);
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

async function fetchBrowse(vault: string, path: string): Promise<DvcBrowse | null> {
  const b = await Bridge.dvcBrowse(vault, path).catch(() => null);
  if (b) {
    dv.browseCache.set(cacheKey(b.vault, b.path), b);
  }
  return b;
}

async function go(path: string, opts: { keepSel?: boolean } = {}) {
  dv.path = path;
  dv.form = null;
  dv.preview = null;
  dv.result = null;
  dv.error = "";
  dv.tieOpen = false;
  if (!opts.keepSel) {
    dv.sel = "";
    dv.selItem = null;
    hideAll();
  }
  const b = await fetchBrowse(dv.vault, path);
  if (b) {
    dv.browse = b;
    dv.vault = b.vault;
  }
  draw();
  State.notify();
}

export function dvcSay(text: string) {
  dv.note = text;
  window.clearTimeout(dv.noteTimer);
  dv.noteTimer = window.setTimeout(() => { dv.note = ""; draw(); }, 5000);
  draw();
}

async function copyPassword(e: DvcItem, row: number | null) {
  try {
    const secs = await Bridge.dvcCopyPassword(e.vault, e.id, row);
    recordDvcRecent(e);
    Sound.play("blip");
    dvcSay(t("Password negli appunti: si svuotano tra {s} secondi.", { s: secs }));
  } catch (err) {
    Sound.play("error");
    dvcSay(errText(err));
  }
}

async function copyUser(e: DvcItem) {
  let user = (e.user ?? "").trim();
  if (!user) {
    const cached = dv.details.get(e.id);
    if (cached && typeof cached !== "string") {
      user = cached.user.trim();
    } else {
      try {
        const d = await Bridge.dvcDetails(e.vault, e.id);
        dv.details.set(e.id, d);
        user = d.user.trim();
      } catch (err) {
        Sound.play("error");
        dvcSay(errText(err));
        return;
      }
    }
  }
  if (!user) {
    dvcSay(t("Nessun utente salvato in questa voce."));
    return;
  }
  recordDvcRecent(e);
  await rdmCopyText(user, t("Utente copiato: {u}", { u: user }), dvcSay);
}

async function openInRdm(e: DvcItem) {
  try {
    recordDvcRecent(e);
    await Bridge.rdmOpen(dvcToRef(e));
    Sound.play("blip");
    dvcSay(t("Aperto «{n}» in RDM.", { n: e.name }));
  } catch (err) {
    Sound.play("error");
    dvcSay(errText(err));
  }
}

function hideAll() {
  for (const timer of dv.shownTimers.values()) window.clearTimeout(timer);
  dv.shownTimers.clear();
  dv.shown.clear();
}

/** The eye: the password asked now (dvc_reveal), shown until clicked again or SHOW_MS. */
async function toggleShown(e: DvcItem, row: number | null) {
  const key = `${e.id}|${row ?? ""}`;
  if (dv.shown.has(key)) {
    dv.shown.delete(key);
    window.clearTimeout(dv.shownTimers.get(key));
    draw();
    return;
  }
  dv.revealing = key;
  draw();
  try {
    dv.shown.set(key, await Bridge.dvcReveal(e.vault, e.id, row));
    dv.shownTimers.set(key, window.setTimeout(() => { dv.shown.delete(key); dv.shownTimers.delete(key); draw(); }, SHOW_MS));
  } catch (err) {
    dvcSay(errText(err));
  }
  dv.revealing = "";
  draw();
}

async function openDetails(e: DvcItem) {
  hideAll();
  dv.sel = e.id;
  dv.selItem = e;
  recordDvcRecent(e);
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

/** A click on an entry: its details in the pane; again on it, the pane closes. */
async function toggleDetails(e: DvcItem) {
  if (dv.sel === e.id) {
    hideAll();
    dv.sel = "";
    dv.selItem = null;
    draw();
    return;
  }
  await openDetails(e);
}

/** Expands or collapses a subfolder inline, fetching it once and caching. */
async function toggleFolderInline(vault: string, path: string) {
  const key = cacheKey(vault, path);
  if (dv.expanded.has(key)) {
    dv.expanded.delete(key);
    draw();
    return;
  }
  dv.expanded.add(key);
  if (!dv.browseCache.has(key)) {
    dv.loadingFolders.add(key);
    draw();
    await fetchBrowse(vault, path);
    dv.loadingFolders.delete(key);
  }
  draw();
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
      dv.browseCache.delete(cacheKey(dv.vault, dv.path));
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

function isConnection(e: DvcItem): boolean {
  return e.kind !== "Group" && !e.kind.startsWith("Credential");
}

function canCopyPassword(e: DvcItem): boolean {
  return e.kind !== "Group" && e.cred !== "PasswordList";
}

function btn(text: string, onclick: () => void, title = ""): HTMLElement {
  return h("button", { class: "link-btn", text, title,
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

/** A password: hidden (dots), SVG eye shows it for SHOW_MS, «Copia» puts it on the private clipboard. */
function secret(e: DvcItem, row: number | null, length: number): HTMLElement {
  const key = `${e.id}|${row ?? ""}`;
  const shown = dv.shown.get(key);
  return h("span", { class: "dvc-secret" },
    h("b", { class: shown ? "dvc-pw shown" : "dvc-pw", text: shown ?? "•".repeat(Math.min(Math.max(length, 6), 14)) }),
    h("button", {
      class: shown ? "dvc-eye on" : "dvc-eye",
      title: shown ? t("Nascondi la password") : t("Mostra la password (per 30 secondi)"),
      onclick: (ev: Event) => { ev.stopPropagation(); void toggleShown(e, row); },
    }, dv.revealing === key ? h("span", { text: "…" }) : svg(shown ? ICONS.eyeOff : ICONS.eye, 14, { stroke: 1.7 })),
    rdmActionBtn(t("Copia"), ICONS.rdmKey, t("Copia password negli appunti privati per 30s (Alt+P)"), () => void copyPassword(e, row), {
      primary: true,
      act: row === null ? "copy-pw" : undefined,
    }));
}

function findEntryById(id: string): DvcItem | null {
  if (!id) return null;
  if (dv.selItem && dv.selItem.id === id) return dv.selItem;
  const fromCur = dv.browse?.entries.find((x) => x.id === id);
  if (fromCur) return fromCur;
  const fromSearch = dv.searchFound.find((x) => x.id === id);
  if (fromSearch) return fromSearch;
  for (const b of dv.browseCache.values()) {
    const hit = b.entries.find((x) => x.id === id);
    if (hit) return hit;
  }
  return null;
}

/** The pane of the entry picked: everything about it, the password hidden. */
function panePart(): HTMLElement | null {
  const e = findEntryById(dv.sel);
  if (!e) return null;
  const d = dv.details.get(e.id);
  const info = kindInfo(e.kind, e.cred);
  const pinned = isPinnedRef(e.id, e.vault);
  const pane = h("div", { class: "dvc-pane" });
  pane.append(h("div", { class: "dvc-pane-head" },
    rdmIconChip(e.kind, e.cred),
    h("div", { class: "dvc-pane-title" },
      h("b", { text: e.name }),
      h("span", { class: "dvc-pane-sub", text: info.label })),
    isConnection(e) ? rdmActionBtn(t("Apri in RDM"), ICONS.arrowUpRight, t("Apri in RDM (Alt+O)"), () => void openInRdm(e), { primary: true, act: "open" }) : null,
    rdmActionBtn(null, ICONS.star, pinned ? t("Togli dai preferiti") : t("Aggiungi ai preferiti"), () => { togglePinRef(dvcToRef(e)); draw(); }, { on: pinned }),
    h("button", { class: "dvc-close", title: t("Chiudi"), onclick: (ev: Event) => { ev.stopPropagation(); dv.sel = ""; dv.selItem = null; hideAll(); draw(); } }, svg(ICONS.xmark, 13))));

  if (!d || typeof d === "string") {
    pane.append(h("div", { class: "notion-note", text: d ?? t("Leggo…") }));
    return pane;
  }

  const copyVal = (value: string, label: string, act?: string, tipText?: string) =>
    rdmActionBtn(t("Copia"), ICONS.copy, tipText ?? t("Copia"), () => {
      recordDvcRecent(e);
      void rdmCopyText(value, t("{l} copiato", { l: label }), dvcSay);
    }, { act });

  const line = (label: string, value: string, actionEl?: HTMLElement | null) => value
    ? h("div", { class: "dvc-kv" },
      h("span", { class: "dvc-kv-k", text: label }),
      h("b", { class: "dvc-kv-v", text: value }),
      actionEl ?? null)
    : null;

  const kindText = d.cred === "PasswordList" ? t("Lista password") : d.kind.startsWith("Credential") ? t("Credenziale") : info.label;
  const parts: (HTMLElement | null)[] = [
    line(t("Host"), d.host, d.host ? copyVal(d.host, t("Host")) : null),
    line(t("Indirizzo"), d.url ?? "", d.url ? copyVal(d.url, t("Indirizzo")) : null),
    line(t("Utente"), d.user, d.user ? copyVal(d.user, t("Utente"), "copy-user", t("Copia utente (Alt+U)")) : null),
    line(t("Dominio"), d.domain),
    d.length ? h("div", { class: "dvc-kv" }, h("span", { class: "dvc-kv-k", text: t("Password") }), secret(e, null, d.length)) : null,
    d.linked ? line(t("Credenziale"), d.linked) : null,
    !d.user && !d.length && !d.rows.length && d.cred !== "PasswordList" ? h("div", { class: "notion-note", text: t("Nessun utente né password in questa voce.") }) : null,
    line(t("Tipo"), kindText),
    d.folder ? line(t("Cartella"), d.folder, btn(t("Apri cartella"), () => { dv.onClearSearch?.(); dvcGoTo(e.vault, d.folder); })) : null,
    d.description ? h("div", { class: "dvc-kv dvc-desc" }, h("span", { class: "dvc-kv-k", text: t("Descrizione") }), h("b", { class: "dvc-kv-v", text: d.description })) : null,
  ];
  for (const p of parts) if (p) pane.append(p);

  if (d.rows.length) {
    pane.append(h("div", { class: "dvc-rows" },
      h("div", { class: "rdm-subhead", text: t("Voci nella lista ({n})", { n: d.rows.length }) }),
      ...d.rows.map((r, i) => {
        const who = [r.domain ? `${r.domain}\\${r.user}` : r.user, r.host].filter(Boolean).join(" · ");
        return h("div", { class: "dvc-row" },
          h("div", { class: "dvc-row-head" },
            h("b", { text: r.name || "—" }),
            who ? h("span", { text: who }) : null,
            r.user ? copyVal(r.user, t("Utente")) : null),
          r.length ? secret(e, i, r.length) : h("small", { text: t("senza password") }));
      })));
  }
  return pane;
}

/** Rich 2-line card for any DVC entry (folder browse, pins, recents, or search results). */
function entryRow(e: DvcItem, opts: { showFolder?: boolean; navKeyPrefix?: string } = {}): HTMLElement {
  const open = dv.sel === e.id;
  const navKey = `${opts.navKeyPrefix ?? "e"}:${e.vault}:${e.id}`;
  const isActive = dv.activeKey === navKey;
  const pinned = isPinnedRef(e.id, e.vault);
  const conn = isConnection(e);
  const hasPw = canCopyPassword(e);
  const userText = (e.user ?? "").trim();
  const folderText = opts.showFolder ? rdmFolderTail(e.folder, 2) : "";

  const row = h("div", {
    class: `rdm-row rdm-entry-card rdm-nav-item${open ? " on" : ""}${isActive ? " is-active" : ""}`,
    role: "button",
    tabindex: "-1",
    "data-nav-key": navKey,
    title: [e.folder, e.host, userText].filter(Boolean).join(" · ") || e.name,
    onclick: () => { dv.activeKey = navKey; void toggleDetails(e); },
  },
  h("div", { class: "rdm-entry-top" },
    rdmIconChip(e.kind, e.cred),
    rdmKindPill(e.kind, e.cred),
    h("span", { class: "rdm-entry-name", text: e.name }),
    h("div", { class: "rdm-row-actions" },
      conn ? rdmActionBtn(t("Apri"), ICONS.arrowUpRight, t("Apri in RDM (Alt+O)"), () => void openInRdm(e), { primary: true, act: "open" }) : null,
      hasPw ? rdmActionBtn(conn ? null : t("Password"), ICONS.rdmKey, t("Copia password negli appunti privati per 30s (Alt+P)"), () => void copyPassword(e, null), { primary: !conn, act: "copy-pw" }) : null,
      userText || hasPw ? rdmActionBtn(null, ICONS.user, t("Copia utente (Alt+U)"), () => void copyUser(e), { act: "copy-user" }) : null,
      e.host ? rdmActionBtn(null, ICONS.copy, t("Copia host"), () => { recordDvcRecent(e); void rdmCopyText(e.host, t("Copiato: {h}", { h: e.host }), dvcSay); }) : null,
      rdmActionBtn(null, ICONS.star, pinned ? t("Togli dai preferiti") : t("Aggiungi ai preferiti"), () => { togglePinRef(dvcToRef(e)); draw(); }, { on: pinned }))),
  (e.host || userText || folderText)
    ? h("div", { class: "rdm-entry-meta" },
      e.host ? h("span", { class: "rdm-meta-chip mono", text: e.host }) : null,
      userText ? h("span", { class: "rdm-meta-item" }, svg(ICONS.user, 11, { stroke: 1.7 }), h("span", { text: userText })) : null,
      folderText ? h("span", { class: "rdm-meta-folder" }, svg(ICONS.rdmFolder, 11, { stroke: 1.7 }), h("span", { text: folderText })) : null)
    : null);

  return h("div", { class: open ? "dvc-entry on" : "dvc-entry" }, row);
}

/** A folder row: clicking expands/collapses inline; «Entra» sets it as the breadcrumb path. */
function folderBlock(vault: string, f: { name: string; path: string; count: number }, depth = 0): HTMLElement {
  const fKey = cacheKey(vault, f.path);
  const expanded = dv.expanded.has(fKey);
  const loading = dv.loadingFolders.has(fKey);
  const navKey = `f:${vault}:${f.path}`;
  const isActive = dv.activeKey === navKey;
  const tiedNames = tiesForPath(vault, f.path);

  const head = h("div", {
    class: `rdm-folder-card dvc-folder rdm-nav-item${expanded ? " open" : ""}${isActive ? " is-active" : ""}`,
    role: "button",
    tabindex: "-1",
    "data-nav-key": navKey,
    onclick: () => { dv.activeKey = navKey; void toggleFolderInline(vault, f.path); },
  },
  h("span", { class: "rdm-folder-chev" }, svg(expanded ? ICONS.chevronDown : ICONS.chevronRight, 13, { stroke: 2 })),
  rdmIconChip("Group"),
  h("span", { class: "rdm-folder-name", text: f.name }),
  ...tiedNames.map((n) => h("span", { class: "rdm-tie-badge", text: n, title: t("Cliente collegato") })),
  h("span", { class: "rdm-count-pill", text: String(f.count) }),
  h("div", { class: "rdm-row-actions" },
    rdmActionBtn(t("Entra"), ICONS.chevronRight, t("Apri solo questa cartella"), () => void go(f.path))));

  const wrap = h("div", { class: "rdm-folder-block" }, head);
  if (expanded) {
    const kids = h("div", { class: "rdm-folder-kids" });
    if (loading) {
      kids.append(h("div", { class: "rdm-inline-note", text: t("Leggo…") }));
    } else {
      const sub = dv.browseCache.get(fKey);
      if (sub) {
        if (depth < 4) {
          for (const sf of sub.folders) kids.append(folderBlock(vault, sf, depth + 1));
        } else {
          for (const sf of sub.folders) {
            kids.append(h("div", { class: "rdm-folder-card dvc-folder rdm-nav-item", role: "button", tabindex: "-1", onclick: () => void go(sf.path) },
              rdmIconChip("Group"), h("span", { class: "rdm-folder-name", text: sf.name }), h("span", { class: "rdm-count-pill", text: String(sf.count) })));
          }
        }
        for (const e of sub.entries) kids.append(entryRow(e));
        if (!sub.folders.length && !sub.entries.length) {
          kids.append(h("div", { class: "rdm-inline-note", text: t("Cartella vuota.") }));
        }
      }
    }
    wrap.append(kids);
  }
  return wrap;
}

function vaultBar(b: DvcBrowse): HTMLElement | null {
  if (b.vaults.length <= 1) return null;
  return h("div", { class: "rdm-vault-tabs" },
    ...b.vaults.map((v) => h("button", {
      class: v.id === b.vault ? "zm-tab rdm-vault-tab on" : "zm-tab rdm-vault-tab",
      onclick: (e: Event) => { e.stopPropagation(); if (v.id !== dv.vault) { dv.vault = v.id; void go(""); } },
    }, svg(ICONS.cloud, 12, { stroke: 1.7 }), h("span", { text: v.name }))));
}

function crumbs(b: DvcBrowse): HTMLElement | null {
  if (!b.path && b.vaults.length > 1) return null;
  const vaultName = b.vaults.find((v) => v.id === b.vault)?.name ?? b.vaults[0]?.name ?? "Cloud";
  const bar = h("div", { class: "dvc-crumbs" });
  bar.append(h("button", {
    class: b.path ? "dvc-crumb-btn" : "dvc-crumb-btn on",
    onclick: (e: Event) => { e.stopPropagation(); void go(""); },
  }, svg(ICONS.cloud, 13, { stroke: 1.7 }), h("span", { text: vaultName })));
  const parts = b.path ? b.path.split("\\") : [];
  parts.forEach((p, i) => {
    bar.append(h("span", { class: "dvc-sep", text: "›" }));
    const to = parts.slice(0, i + 1).join("\\");
    if (i === parts.length - 1) {
      bar.append(h("b", { class: "dvc-crumb-here", text: p }));
    } else {
      bar.append(btn(p, () => void go(to)));
    }
  });
  if (b.path) {
    const tiedHere = tiesForPath(dv.vault, b.path);
    bar.append(h("span", { class: "zm-grow" }));
    if (!tiedHere.length && !dv.tieOpen) {
      bar.append(btn(t("+ Collega cliente"), () => { dv.tieOpen = true; draw(); }, t("Collega questa cartella a un cliente di Zammad o 3CX")));
    }
  }
  return bar;
}

function tiePart(): HTMLElement | null {
  if (!dv.path) return null;
  const here = tiesForPath(dv.vault, dv.path);
  if (!here.length && !dv.tieOpen) return null;
  const input = h("input", {
    class: "nc-input dvc-input",
    value: dv.tie,
    spellcheck: "false",
    "data-k": "tie",
    placeholder: t("Cliente di Zammad o 3CX (es. Farmacia Falchi)"),
  }) as HTMLInputElement;
  input.addEventListener("input", () => { dv.tie = input.value; });
  const add = () => {
    if (!dv.tie.trim()) return;
    tieFolder(dv.tie, { vault: dv.vault, path: dv.path });
    dvcSay(t("«{c}» porta a questa cartella.", { c: dv.tie.trim() }));
    dv.tie = "";
    dv.tieOpen = false;
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") add();
    else if (e.key === "Escape") { dv.tieOpen = false; draw(); }
  });
  return h("div", { class: "dvc-tie" },
    h("span", { class: "dvc-tie-label", text: t("Cliente") }),
    ...here.map((name) => h("span", { class: "dvc-chip" },
      h("span", { text: name }),
      h("button", { title: t("Scollega"), onclick: (e: Event) => { e.stopPropagation(); tieFolder(name, null); draw(); } }, svg(ICONS.xmark, 10)))),
    input,
    btn(t("Collega"), add, t("Su un ticket Zammad o una chiamata 3CX di questo cliente, RDM apre questa cartella")));
}

function appendPinnedAndRecents(el: HTMLElement) {
  const pins = getDvcPins().map((p) => findEntryById(p.id) ?? p);
  const pinIds = new Set(pins.map((p) => p.id));
  if (pins.length) {
    const open = !dv.collapsedGroups.has("sec:pins");
    const toggle = () => {
      if (open) dv.collapsedGroups.add("sec:pins");
      else dv.collapsedGroups.delete("sec:pins");
      draw();
    };
    el.append(rdmSectionHead("sec:pins", t("Preferiti"), pins.length, ICONS.star, open, toggle));
    if (open) {
      for (const p of pins) el.append(entryRow(p, { showFolder: true, navKeyPrefix: "pin" }));
    }
  }

  const allRecents = getDvcRecents().filter((r) => !pinIds.has(r.id));
  if (allRecents.length) {
    const open = !dv.collapsedGroups.has("sec:recents");
    const toggle = () => {
      if (open) dv.collapsedGroups.add("sec:recents");
      else dv.collapsedGroups.delete("sec:recents");
      draw();
    };
    el.append(rdmSectionHead("sec:recents", t("Recenti"), allRecents.length, ICONS.history, open, toggle));
    if (open) {
      const shown = dv.showAllRecents ? allRecents : allRecents.slice(0, INITIAL_RECENTS);
      for (const r of shown) el.append(entryRow(r, { showFolder: true, navKeyPrefix: "rec" }));
      if (allRecents.length > INITIAL_RECENTS) {
        el.append(h("div", { class: "rdm-more-row" },
          btn(dv.showAllRecents ? t("Mostra meno") : t("Mostra tutti ({n})", { n: allRecents.length }), () => {
            dv.showAllRecents = !dv.showAllRecents;
            draw();
          })));
      }
    }
  }
}

function appendSearchResults(el: HTMLElement) {
  const q = dv.searchQuery.trim();
  if (dv.searchLoading && !dv.searchFound.length) {
    el.append(h("div", { class: "rdm-empty-state" }, h("span", { text: t("Cerco nel cloud…") })));
    return;
  }
  const folders = dv.searchFound.filter((x) => x.kind === "Group");
  const entries = dv.searchFound.filter((x) => x.kind !== "Group");

  if (!folders.length && !entries.length) {
    el.append(h("div", { class: "rdm-empty-state" },
      svg(ICONS.search, 22, { stroke: 1.5 }),
      h("b", { text: t("Niente nel cloud con «{q}»", { q }) }),
      h("span", { text: t("Prova con il nome del cliente, un IP, un utente o il tipo di connessione.") })));
    return;
  }

  if (folders.length) {
    const secKey = "srch:folders";
    const open = !dv.collapsedGroups.has(secKey);
    el.append(rdmSectionHead(secKey, t("Cartelle"), folders.length, ICONS.rdmFolder, open, () => {
      if (open) dv.collapsedGroups.add(secKey); else dv.collapsedGroups.delete(secKey);
      draw();
    }));
    if (open) {
      for (const f of folders) {
        const path = f.path || [f.folder, f.name].filter(Boolean).join("\\");
        const navKey = `sf:${f.vault}:${path}`;
        el.append(h("div", {
          class: `rdm-folder-card dvc-folder rdm-nav-item${dv.activeKey === navKey ? " is-active" : ""}`,
          role: "button",
          tabindex: "-1",
          "data-nav-key": navKey,
          onclick: () => { dv.onClearSearch?.(); dvcGoTo(f.vault, path); },
        },
        rdmIconChip("Group"),
        h("span", { class: "rdm-folder-name", text: f.name }),
        f.folder ? h("span", { class: "rdm-meta-folder", text: rdmFolderTail(f.folder, 2) }) : null,
        h("div", { class: "rdm-row-actions" },
          rdmActionBtn(t("Apri"), ICONS.chevronRight, t("Apri questa cartella"), () => { dv.onClearSearch?.(); dvcGoTo(f.vault, path); }))));
      }
    }
  }

  // Group entries by folder / customer so results for the same client stay together.
  const groups = new Map<string, DvcItem[]>();
  for (const e of entries) {
    const key = e.folder || t("Radice");
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  for (const [folder, items] of groups) {
    const grpKey = `srch:${folder.toLowerCase()}`;
    const open = !dv.collapsedGroups.has(grpKey);
    const label = rdmFolderTail(folder, 3) || folder;
    el.append(rdmSectionHead(grpKey, label, items.length, ICONS.rdmFolder, open, () => {
      if (open) dv.collapsedGroups.add(grpKey); else dv.collapsedGroups.delete(grpKey);
      draw();
    }));
    if (open) {
      for (const e of items) el.append(entryRow(e, { showFolder: false, navKeyPrefix: "srch" }));
    }
  }
}

/** Folders, entries, the forms, the customer: the list's part of the view. */
function appendList(el: HTMLElement, b: DvcBrowse) {
  if (dv.searchQuery.trim()) {
    appendSearchResults(el);
    return;
  }
  const vb = vaultBar(b);
  if (vb) el.append(vb);
  const cr = crumbs(b);
  if (cr) el.append(cr);
  const tie = tiePart();
  if (tie) el.append(tie);

  if (!b.path) appendPinnedAndRecents(el);

  if (b.folders.length || b.entries.length) {
    if (!b.path && (getDvcPins().length || getDvcRecents().length)) {
      el.append(h("div", { class: "rdm-subhead", text: t("Cartelle e voci") }));
    }
    for (const f of b.folders) el.append(folderBlock(b.vault, f, 0));
    for (const e of b.entries) el.append(entryRow(e));
  } else {
    el.append(h("div", { class: "rdm-empty-state compact" },
      svg(ICONS.rdmFolder, 20, { stroke: 1.5 }),
      h("b", { text: t("Cartella vuota.") })));
  }

  const res = resultPart();
  if (res) el.append(res);
  const form = formPart();
  if (form) el.append(form);
  else if (b.path) {
    el.append(h("div", { class: "rdm-actions dvc-folder-actions" },
      btn(t("+ Credenziale"), () => { dv.form = { kind: "cred", name: "", user: "", domain: "", password: "", description: "" }; dv.result = null; draw(); State.notify(); }),
      btn(t("+ Lista password da questa cartella"), () => { dv.form = { kind: "list", name: t("Lista Password"), recurse: false }; dv.result = null; draw(); State.notify(); })));
  }
}

function draw() {
  const el = dv.el;
  if (!el) return;
  const focused = el.ownerDocument.activeElement;
  const keep = focused instanceof HTMLInputElement && el.contains(focused) ? focused.dataset.k ?? "" : "";
  const scrolled = el.querySelector(".dvc-list")?.scrollTop ?? 0;
  const paneScrolled = el.querySelector(".dvc-pane")?.scrollTop ?? 0;
  clear(el);

  const b = dv.browse;
  if (!b || !b.vaults.length) {
    el.append(h("div", { class: "rdm-empty-state" },
      svg(ICONS.cloud, 24, { stroke: 1.5 }),
      h("b", { text: t("Devolutions Cloud non sincronizzato") }),
      h("span", { text: t("Nessun vault letto: premi Sincronizza (in alto) dopo aver messo indirizzo, Key e Secret in Impostazioni → Remote Desktop Manager.") })));
    return;
  }

  const list = h("div", { class: "dvc-list" });
  const pane = dv.form ? null : panePart();
  el.append(h("div", { class: pane ? "dvc-split with-pane" : "dvc-split" }, list, pane));
  appendList(list, b);

  if (dv.note) {
    el.append(h("div", { class: "rdm-toast", text: dv.note }));
  }

  list.scrollTop = scrolled;
  if (pane) pane.scrollTop = paneScrolled;
  if (keep) {
    const again = Array.from(el.querySelectorAll("input")).find((i) => i.dataset.k === keep);
    again?.focus();
  }
}

/** Handles Escape inside DVC (returns true if something was closed). */
export function dvcHandleEscape(): boolean {
  if (dv.form) {
    dv.form = null;
    dv.preview = null;
    dv.error = "";
    draw();
    return true;
  }
  if (dv.sel) {
    hideAll();
    dv.sel = "";
    dv.selItem = null;
    draw();
    return true;
  }
  return false;
}

/** Sets active keyboard row key inside DVC so redraws preserve selection. */
export function dvcSetActiveKey(key: string) {
  dv.activeKey = key;
}

/** The view, the same element at every rebuild of the card. */
export function dvcView(): HTMLElement {
  if (!dv.el) {
    dv.el = h("div", { class: "dvc-view", onpointerdown: (e: Event) => void Bridge.focusWindow(true, e) });
    void Bridge.dvcWarm();
    void go(dv.path);
  } else {
    if (!dv.el.isConnected) void Bridge.dvcWarm();
    if (!dv.form && !dv.searchQuery.trim()) {
      void fetchBrowse(dv.vault, dv.path).then((b) => { if (b && !dv.form) { dv.browse = b; draw(); } });
    }
  }
  return dv.el;
}
