// Devolutions Cloud inside the RDM card (src-tauri/src/dvc.rs): vault pills,
// lightweight folder tree rail, flat center list with shaded gradient icon
// boxes and animated shimmer while loading, right detail pane (pop-in drawer
// when narrow), favorites and recents (integrationConfig.rdmPins and rdmRecent,
// never secrets), and preview-confirmed creation forms.
// Passwords are never stored in DOM or settings: «Copia password (30 s)» uses
// Rust's private 30s clipboard, and «Mostra» asks Rust for a 30s reveal.

import { h, clear, svg, drainBar } from "./dom";
import { ICONS } from "./icons";
import { State } from "../core/state";
import { Bridge, type DvcBrowse, type DvcDetails, type DvcItem, type DvcOutcome } from "../core/bridge";
import { t } from "../core/i18n";
import { frameFor } from "../core/motion";
import { Sound } from "../core/sound";
import { openClientCard } from "./clientcard";
import {
  dvcToRef,
  getDvcPins,
  getDvcRecents,
  isPinnedRef,
  kindInfo,
  rdmCopyText,
  rdmFolderTail,
  rdmHoverBtn,
  rdmSkelRows,
  rdmTag,
  rdmToneBox,
  recordDvcRecent,
  renderHighlight,
  togglePinRef,
} from "./rdm";

type Form =
  | { kind: "cred"; name: string; user: string; domain: string; password: string; description: string }
  | { kind: "list"; name: string; recurse: boolean };

/** How long a password shown with «Mostra» stays visible. */
const SHOW_MS = 30_000;

const dv = {
  ws: null as HTMLElement | null,
  onHeaderSync: null as (() => void) | null,
  vault: "",
  path: "",
  browse: null as DvcBrowse | null,
  loadingBrowse: false,
  warmState: "idle" as "idle" | "warming" | "ready",
  /** Cached folder reads ("vault|path" → DvcBrowse), cleared on sync or write. */
  browseCache: new Map<string, DvcBrowse>(),
  /** Folders expanded in the left tree rail ("vault|path"). */
  treeOpen: new Set<string>(),
  autoExpandedRoot: false,
  /** Center filter when search is empty: "browse" | "pins" | "recents". */
  filter: "browse" as "browse" | "pins" | "recents",
  /** Search query mirrored from rdm.ts. */
  searchQuery: "",
  searchFound: [] as DvcItem[],
  searchLoading: false,
  /** Highlighted keyboard row key. */
  activeKey: "",
  /** Entry whose details are shown in the right pane / drawer. */
  sel: "",
  selItem: null as DvcItem | null,
  details: new Map<string, DvcDetails | string>(),
  /** Passwords shown with «Mostra»: "id|row" → password, hidden after SHOW_MS. */
  shown: new Map<string, string>(),
  shownTimers: new Map<string, number>(),
  shownUntil: new Map<string, number>(),
  revealing: "",
  copiedKey: "",
  copiedTimer: 0,
  clipWait: null as { key: string; until: number; totalMs: number; note: string } | null,
  clipWaitTimer: 0,
  form: null as Form | null,
  preview: null as string[] | null,
  result: null as DvcOutcome | null,
  busy: false,
  error: "",
  note: "",
  noteTimer: 0,
  tieOpen: false,
  tie: "",
  onClearSearch: null as (() => void) | null,
};

const errText = (e: unknown) => String(e).replace(/^Error:\s*/, "");
const cacheKey = (vault: string, path: string) => `${vault}|${path.toLowerCase()}`;

function warmOnce() {
  if (dv.warmState === "warming" || dv.warmState === "ready") return;
  dv.warmState = "warming";
  dv.onHeaderSync?.();
  void Bridge.dvcWarm()
    .then(() => {
      dv.warmState = "ready";
      dv.onHeaderSync?.();
    })
    .catch(() => {
      dv.warmState = "idle";
      dv.onHeaderSync?.();
    });
}

/** Exposes current vault name, warm status and tied customers for the Panoramica header. */
export function dvcStateSummary() {
  const b = dv.browse;
  const vaultName = b?.vaults.find((v) => v.id === dv.vault)?.name ?? b?.vaults[0]?.name ?? "";
  const tied = dv.path ? tiesForPath(dv.vault, dv.path) : [];
  return {
    warmState: dv.warmState,
    vaultName,
    inFolder: !!dv.path,
    tied,
    untie: (name: string) => { tieFolder(name, null); draw(); dv.onHeaderSync?.(); },
  };
}

export function dvcToggleTieInput() {
  if (!dv.path) return;
  dv.tieOpen = !dv.tieOpen;
  draw();
  if (dv.tieOpen) {
    frameFor(dv.ws, () => dv.ws?.querySelector<HTMLInputElement>('.dvc-tie input')?.focus());
  }
}

export function dvcSetFilter(f: "browse" | "pins" | "recents") {
  dv.filter = f;
  dv.onClearSearch?.();
  draw();
}

/** Clears cached folder listings (called on Sincronizza or after creating an item). */
export function dvcResetCache() {
  dv.browseCache.clear();
  dv.details.clear();
  dv.autoExpandedRoot = false;
  if (dv.ws && dv.browse) void reloadExpanded();
}

async function reloadExpanded() {
  await go(dv.path, { keepSel: true });
  for (const key of [...dv.treeOpen]) {
    const idx = key.indexOf("|");
    if (idx < 0) continue;
    const vault = key.slice(0, idx);
    const path = key.slice(idx + 1);
    if (vault !== dv.vault) continue;
    const b = await Bridge.dvcBrowse(vault, path).catch(() => null);
    if (b) dv.browseCache.set(cacheKey(vault, b.path), b);
  }
  draw();
}

/** Updates the search results shown inside the DVC 3-zone workspace. */
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
  dv.filter = "browse";
  dv.searchQuery = "";
  dv.searchFound = [];
  void go(path);
}

/** The cloud view on an entry's folder, with its pane open (the search field, rdm.ts rdmShowEntry). */
export async function dvcShowEntry(e: DvcItem) {
  dv.vault = e.vault;
  dv.filter = "browse";
  dv.searchQuery = "";
  dv.searchFound = [];
  await go(e.folder);
  const here = dv.browse?.entries.find((x) => x.id === e.id) ?? e;
  if (dv.sel !== here.id) await openDetails(here);
  dv.ws?.querySelector(".rdm-flat-row.on")?.scrollIntoView({ block: "nearest" });
}

function ties(): Record<string, { vault: string; path: string }> {
  return State.settings.integrationConfig.rdmFolders ?? {};
}

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
  if (b) dv.browseCache.set(cacheKey(b.vault, b.path), b);
  return b;
}

async function ensureAncestorsOpen(vault: string, path: string) {
  const parts = path.split("\\").filter(Boolean);
  let cur = "";
  for (let i = 0; i < parts.length; i++) {
    cur = cur ? `${cur}\\${parts[i]}` : parts[i];
    const k = cacheKey(vault, cur);
    dv.treeOpen.add(k);
    if (!dv.browseCache.has(k)) await fetchBrowse(vault, cur);
  }
}

async function go(path: string, opts: { keepSel?: boolean } = {}) {
  dv.path = path;
  dv.filter = "browse";
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
  const cached = dv.browseCache.get(cacheKey(dv.vault, path));
  if (!cached) {
    dv.loadingBrowse = true;
    draw();
  }
  const b = await fetchBrowse(dv.vault, path);
  dv.loadingBrowse = false;
  if (b) {
    dv.browse = b;
    dv.vault = b.vault;
    if (!dv.browseCache.has(cacheKey(b.vault, ""))) {
      await fetchBrowse(b.vault, "");
    }
    if (!b.path && !dv.autoExpandedRoot && b.folders.length === 1) {
      dv.autoExpandedRoot = true;
      const only = b.folders[0];
      dv.treeOpen.add(cacheKey(b.vault, only.path));
      await fetchBrowse(b.vault, only.path);
    } else if (b.path) {
      await ensureAncestorsOpen(b.vault, b.path);
    }
  }
  draw();
  dv.onHeaderSync?.();
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
    const key = `${e.id}|${row ?? ""}`;
    dv.copiedKey = key;
    window.clearTimeout(dv.copiedTimer);
    dv.copiedTimer = window.setTimeout(() => { dv.copiedKey = ""; draw(); }, 2500);
    const ms = Math.max(1000, secs * 1000);
    const note = t("Password negli appunti: si svuotano tra {s} secondi.", { s: secs });
    dv.clipWait = { key, until: Date.now() + ms, totalMs: ms, note };
    window.clearTimeout(dv.clipWaitTimer);
    dv.clipWaitTimer = window.setTimeout(() => { dv.clipWait = null; draw(); }, ms);
    dvcSay(note);
    dv.onHeaderSync?.();
  } catch (err) {
    Sound.play("error");
    dvcSay(errText(err));
  }
}

async function copyUser(e: DvcItem) {
  let user = (e.user ?? "").trim();
  if (!user) {
    const cached = dv.details.get(e.id);
    if (cached && typeof cached !== "string") user = cached.user.trim();
    else {
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
  dv.onHeaderSync?.();
}

async function openInRdm(e: DvcItem) {
  try {
    recordDvcRecent(e);
    await Bridge.rdmOpen(dvcToRef(e));
    Sound.play("blip");
    dvcSay(t("Aperto «{n}» in RDM.", { n: e.name }));
    dv.onHeaderSync?.();
  } catch (err) {
    Sound.play("error");
    dvcSay(errText(err));
  }
}

function hideAll() {
  for (const timer of dv.shownTimers.values()) window.clearTimeout(timer);
  dv.shownTimers.clear();
  dv.shownUntil.clear();
  dv.shown.clear();
}

async function toggleShown(e: DvcItem, row: number | null) {
  const key = `${e.id}|${row ?? ""}`;
  if (dv.shown.has(key)) {
    dv.shown.delete(key);
    dv.shownUntil.delete(key);
    window.clearTimeout(dv.shownTimers.get(key));
    draw();
    return;
  }
  dv.revealing = key;
  draw();
  try {
    dv.shown.set(key, await Bridge.dvcReveal(e.vault, e.id, row));
    dv.shownUntil.set(key, Date.now() + SHOW_MS);
    dv.shownTimers.set(key, window.setTimeout(() => {
      dv.shown.delete(key);
      dv.shownUntil.delete(key);
      dv.shownTimers.delete(key);
      draw();
    }, SHOW_MS));
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
  dv.form = null;
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
  dv.onHeaderSync?.();
  State.notify();
}

async function toggleTreeFolder(vault: string, path: string) {
  const k = cacheKey(vault, path);
  if (dv.treeOpen.has(k)) {
    dv.treeOpen.delete(k);
    draw();
    return;
  }
  dv.treeOpen.add(k);
  if (!dv.browseCache.has(k)) {
    await fetchBrowse(vault, path);
  }
  draw();
}

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

function btn(text: string, onclick: () => void, title = ""): HTMLElement {
  return h("button", { class: "link-btn", text, title, onclick: (ev: Event) => { ev.stopPropagation(); onclick(); } });
}

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

/** Right detail pane (3-zone on wide, pop-in drawer on narrow). */
function detailPane(): HTMLElement {
  const pane = h("div", { class: "rdm-detail-pane" });
  const e = findEntryById(dv.sel);
  if (!e) {
    pane.append(h("div", { class: "rdm-detail-empty" },
      svg(ICONS.rdmKey, 26, { stroke: 1.4 }),
      h("b", { text: t("Seleziona una voce") }),
      h("span", { text: t("Frecce ↑ ↓ per scorrere, Invio per i dettagli, Alt+P per copiare la password.") })));
    return pane;
  }

  const d = dv.details.get(e.id);
  const info = kindInfo(e.kind, e.cred);
  const pinned = isPinnedRef(e.id, e.vault);
  const conn = isConnection(e);
  const vaultName = dv.browse?.vaults.find((v) => v.id === e.vault)?.name ?? "";

  pane.append(h("div", { class: "rdm-detail-bar" },
    h("button", { class: "rdm-back-btn", onclick: (ev: Event) => { ev.stopPropagation(); dv.sel = ""; dv.selItem = null; hideAll(); draw(); } },
      svg(ICONS.chevronLeft, 12, { stroke: 2 }), h("span", { text: t("Elenco") })),
    h("button", { class: "dvc-close", title: t("Chiudi"), onclick: (ev: Event) => { ev.stopPropagation(); dv.sel = ""; dv.selItem = null; hideAll(); draw(); } },
      svg(ICONS.xmark, 13))));

  pane.append(h("div", { class: "rdm-detail-hero" },
    rdmToneBox(e.kind, e.cred, "lg"),
    h("div", { class: "rdm-detail-titles" },
      h("span", { class: "rdm-kicker", text: info.longLabel }),
      h("b", { class: "rdm-detail-name", text: e.name }))));

  const pwKey = `${e.id}|`;
  const shownPw = dv.shown.get(pwKey);
  const justCopied = dv.copiedKey === pwKey;

  pane.append(h("div", { class: "rdm-detail-actions" },
    conn ? h("button", {
      class: "rdm-big-btn primary",
      "data-act": "open",
      title: t("Apri in RDM (Alt+O)"),
      onclick: () => void openInRdm(e),
    }, svg(ICONS.arrowUpRight, 13, { stroke: 1.9 }), h("span", { text: t("Apri") })) : null,
    h("button", {
      class: pinned ? "rdm-big-btn on" : "rdm-big-btn",
      title: pinned ? t("Togli dai preferiti") : t("Aggiungi ai preferiti"),
      onclick: () => { togglePinRef(dvcToRef(e)); draw(); dv.onHeaderSync?.(); },
    }, svg(ICONS.star, 13), h("span", { text: t("Preferito") }))));

  if (!d || typeof d === "string") {
    const previewKv = h("div", { class: "rdm-kv-list" });
    if (e.host) {
      previewKv.append(h("div", { class: "rdm-kv-row" },
        h("span", { class: "rdm-kv-k", text: t("Host") }),
        h("b", { class: "rdm-kv-v", text: e.host })));
    }
    if (e.user) {
      previewKv.append(h("div", { class: "rdm-kv-row" },
        h("span", { class: "rdm-kv-k", text: t("Utente") }),
        h("b", { class: "rdm-kv-v", text: e.user })));
    }
    if (previewKv.childElementCount) pane.append(previewKv);
    pane.append(typeof d === "string" && d !== t("Leggo…")
      ? h("div", { class: "notion-note bad", text: d })
      : rdmSkelRows(2));
    return pane;
  }

  const kv = h("div", { class: "rdm-kv-list" });
  const addKv = (label: string, value: string, opts: { act?: string; tip?: string; onAct?: () => void } = {}) => {
    if (!value) return;
    kv.append(h("div", { class: "rdm-kv-row" },
      h("span", { class: "rdm-kv-k", text: label }),
      h("b", { class: "rdm-kv-v", text: value }),
      h("button", {
        class: "rdm-kv-copy",
        "data-act": opts.act,
        title: opts.tip ?? t("Copia"),
        onclick: (ev: Event) => {
          ev.stopPropagation();
          if (opts.onAct) { opts.onAct(); return; }
          recordDvcRecent(e);
          void rdmCopyText(value, t("{l} copiato", { l: label }), dvcSay);
        },
      }, svg(opts.onAct ? ICONS.chevronRight : ICONS.copy, 12, { stroke: 1.8 }))));
  };

  const addPwRow = () => {
    if (!(d.length > 0)) return;
    const pwKey = `${e.id}|`;
    const showDrain = shownPw ? drainBar(dv.shownUntil.get(pwKey) ?? 0, SHOW_MS, { color: "#f59e0b", slim: true }) : null;
    const clipActive = dv.clipWait?.key === pwKey ? dv.clipWait : null;
    const clipDrain = clipActive ? drainBar(clipActive.until, clipActive.totalMs, { color: "#22c55e", slim: true }) : null;
    kv.append(h("div", { class: `rdm-kv-row is-pw${shownPw ? " is-revealed" : ""}${clipDrain ? " has-drain" : ""}` },
      h("span", { class: "rdm-kv-k", text: t("Password") }),
      h("div", { class: "rdm-pw-val" },
        shownPw
          ? h("div", { class: "dvc-pw-stack" }, h("code", { class: "dvc-pw shown", text: shownPw }), showDrain)
          : h("span", { class: "rdm-pw-mask", text: "••••••••" })),
      h("div", { class: "rdm-pw-acts" },
        h("button", {
          class: shownPw ? "rdm-pw-eye on" : "rdm-pw-eye",
          title: shownPw ? t("Nascondi la password") : t("Mostra la password (per 30 secondi)"),
          onclick: (ev: Event) => { ev.stopPropagation(); void toggleShown(e, null); },
        }, svg(shownPw ? ICONS.eyeOff : ICONS.eye, 13, { stroke: 1.7 })),
        h("button", {
          class: justCopied ? "rdm-pw-copy is-copied" : (conn ? "rdm-pw-copy" : "rdm-pw-copy primary"),
          "data-act": "copy-pw",
          title: t("Copia password negli appunti privati per 30s (Alt+P)"),
          onclick: (ev: Event) => { ev.stopPropagation(); void copyPassword(e, null); },
        }, svg(justCopied ? ICONS.check : ICONS.rdmKey, 12, { stroke: 1.9 }),
        h("span", { text: justCopied ? t("Copiata ✓") : t("Copia (30 s)") }))),
      clipDrain));
  };

  addKv(t("Host"), d.host);
  addKv(t("Indirizzo"), d.url ?? "");
  addKv(t("Utente"), d.user, { act: "copy-user", tip: t("Copia utente (Alt+U)") });
  addPwRow();
  addKv(t("Dominio"), d.domain);
  addKv(t("Cartella"), d.folder, {
    tip: t("Apri cartella"),
    onAct: () => { dv.onClearSearch?.(); dvcGoTo(e.vault, d.folder); },
  });
  addKv(t("Cassetta"), vaultName);
  addKv(t("Credenziale"), d.linked ?? "");
  if (d.description) {
    kv.append(h("div", { class: "rdm-kv-row desc" },
      h("span", { class: "rdm-kv-k", text: t("Note") }),
      h("b", { class: "rdm-kv-v", text: d.description })));
  }
  pane.append(kv);

  if (!d.user && !d.length && !d.rows.length && d.cred !== "PasswordList") {
    pane.append(h("div", { class: "notion-note", text: t("Nessun utente né password in questa voce.") }));
  }

  if (d.rows.length) {
    const listWrap = h("div", { class: "dvc-rows" },
      h("div", { class: "rdm-rail-kicker", text: t("Voci nella lista ({n})", { n: d.rows.length }) }));
    d.rows.forEach((r, i) => {
      const rKey = `${e.id}|${i}`;
      const rShown = dv.shown.get(rKey);
      const rCopied = dv.copiedKey === rKey;
      const fullUser = r.domain ? `${r.domain}\\${r.user}` : r.user;
      const rowEl = h("div", { class: "dvc-row" },
        h("div", { class: "dvc-row-head" },
          h("b", { text: r.name || "—" }),
          r.host ? h("span", { text: r.host }) : null));

      if (fullUser) {
        rowEl.append(h("div", { class: "dvc-sub-line" },
          h("span", { class: "dvc-sub-k", text: t("Utente") }),
          h("b", { class: "dvc-sub-v", text: fullUser }),
          h("button", {
            class: "rdm-kv-copy",
            title: t("Copia utente"),
            onclick: (ev: Event) => {
              ev.stopPropagation();
              recordDvcRecent(e);
              void rdmCopyText(fullUser, t("Utente copiato: {u}", { u: fullUser }), dvcSay);
            },
          }, svg(ICONS.copy, 12, { stroke: 1.8 }))));
      }

      if (r.length > 0) {
        const rShowDrain = rShown ? drainBar(dv.shownUntil.get(rKey) ?? 0, SHOW_MS, { color: "#f59e0b", slim: true }) : null;
        const rClipDrain = dv.clipWait?.key === rKey
          ? drainBar(dv.clipWait.until, dv.clipWait.totalMs, { color: "#22c55e", slim: true })
          : null;
        rowEl.append(h("div", { class: `dvc-sub-line is-pw${rShown ? " is-revealed" : ""}${rClipDrain ? " has-drain" : ""}` },
          h("span", { class: "dvc-sub-k", text: t("Password") }),
          rShown
            ? h("div", { class: "dvc-pw-stack dvc-sub-v" }, h("code", { class: "dvc-pw shown", text: rShown }), rShowDrain)
            : h("span", { class: "rdm-pw-mask dvc-sub-v", text: "••••••••" }),
          h("div", { class: "rdm-pw-acts" },
            h("button", {
              class: rShown ? "rdm-pw-eye on" : "rdm-pw-eye",
              title: rShown ? t("Nascondi la password") : t("Mostra la password (per 30 secondi)"),
              onclick: (ev: Event) => { ev.stopPropagation(); void toggleShown(e, i); },
            }, svg(rShown ? ICONS.eyeOff : ICONS.eye, 12, { stroke: 1.7 })),
            h("button", {
              class: rCopied ? "rdm-pw-copy is-copied" : "rdm-pw-copy primary",
              title: t("Copia password negli appunti privati per 30s"),
              onclick: (ev: Event) => { ev.stopPropagation(); void copyPassword(e, i); },
            }, svg(rCopied ? ICONS.check : ICONS.rdmKey, 11, { stroke: 1.9 }),
            h("span", { text: rCopied ? t("Copiata ✓") : t("Copia (30 s)") }))),
          rClipDrain));
      }

      listWrap.append(rowEl);
    });
    pane.append(listWrap);
  }
  return pane;
}

/** Flat Panoramica-style row: gradient icon tile, name + tag, muted host · user, max 2 hover actions. */
function flatEntryRow(e: DvcItem, opts: { showFolder?: boolean; prefix?: string } = {}): HTMLElement {
  const selected = dv.sel === e.id;
  const navKey = `${opts.prefix ?? "e"}:${e.vault}:${e.id}`;
  const isActive = dv.activeKey === navKey;
  const conn = isConnection(e);
  const cachedDetail = dv.details.get(e.id);
  const hasConfirmedPw = typeof cachedDetail === "object" && cachedDetail !== null && cachedDetail.length > 0;
  const userText = (e.user ?? "").trim();
  const folderText = opts.showFolder ? rdmFolderTail(e.folder, 2) : "";
  const subParts = [e.host, userText, folderText].filter(Boolean);
  const q = dv.searchQuery.trim();

  return h("div", {
    class: `rdm-flat-row rdm-nav-item${selected ? " on" : ""}${isActive ? " is-active" : ""}`,
    role: "button",
    tabindex: "-1",
    "data-nav-key": navKey,
    title: [e.folder, e.host, userText].filter(Boolean).join(" · ") || e.name,
    onclick: () => {
      dv.activeKey = navKey;
      if (dv.sel === e.id) { hideAll(); dv.sel = ""; dv.selItem = null; draw(); }
      else void openDetails(e);
    },
    ondblclick: () => { if (conn) void openInRdm(e); },
  },
  rdmToneBox(e.kind, e.cred),
  h("div", { class: "rdm-row-main" },
    h("div", { class: "rdm-row-title" },
      h("span", { class: "rdm-row-name" }, ...(q ? renderHighlight(e.name, q) : [e.name])),
      rdmTag(e.kind, e.cred)),
    subParts.length ? h("div", { class: "rdm-row-sub" },
      ...(q ? renderHighlight(subParts.join(" · "), q) : [subParts.join(" · ")])) : null),
  h("div", { class: "rdm-row-acts" },
    conn ? rdmHoverBtn(t("Apri"), ICONS.arrowUpRight, t("Apri in RDM (Alt+O)"), () => void openInRdm(e), { primary: true, act: "open" }) : null,
    hasConfirmedPw ? rdmHoverBtn(t("Password"), ICONS.rdmKey, t("Copia password negli appunti privati per 30s (Alt+P)"), () => void copyPassword(e, null), { primary: !conn, act: "copy-pw" }) : null,
    userText ? rdmHoverBtn(t("Utente"), ICONS.user, t("Copia utente (Alt+U)"), () => void copyUser(e), { act: "copy-user" }) : null));
}

function flatFolderRow(vault: string, f: { name: string; path: string; count: number }, prefix = "f"): HTMLElement {
  const navKey = `${prefix}:${vault}:${f.path}`;
  const isActive = dv.activeKey === navKey;
  const tied = tiesForPath(vault, f.path);
  const q = dv.searchQuery.trim();
  return h("div", {
    class: `rdm-flat-row folder rdm-nav-item${isActive ? " is-active" : ""}`,
    role: "button",
    tabindex: "-1",
    "data-nav-key": navKey,
    onclick: () => { dv.activeKey = navKey; dv.onClearSearch?.(); void go(f.path, { keepSel: true }); },
  },
  rdmToneBox("Group"),
  h("div", { class: "rdm-row-main" },
    h("div", { class: "rdm-row-title" },
      h("span", { class: "rdm-row-name" }, ...(q ? renderHighlight(f.name, q) : [f.name])),
      ...tied.map((n) => h("button", {
        class: "rdm-tag rdm-tag-btn",
        style: "--tag:#E8542A",
        title: t("Apri scheda cliente di «{name}»", { name: n }),
        text: n,
        onclick: (ev: Event) => { ev.stopPropagation(); openClientCard(n, { source: "rdm" }); },
      }))),
    h("div", { class: "rdm-row-sub", text: t("{n} voci", { n: f.count }) })),
  h("div", { class: "rdm-row-acts" },
    rdmHoverBtn(t("Apri"), ICONS.chevronRight, t("Apri questa cartella"), () => { dv.onClearSearch?.(); void go(f.path, { keepSel: true }); }, { primary: true })));
}

/** Left folder tree rail (3-zone on wide). */
function buildTreeRail(b: DvcBrowse): HTMLElement {
  const pins = getDvcPins();
  const recs = getDvcRecents();
  const q = dv.searchQuery.trim();

  const rail = h("aside", { class: "rdm-tree-rail" });
  if (b.vaults.length > 1) {
    rail.append(h("div", { class: "rdm-rail-kicker", text: t("Cassette") }),
      ...b.vaults.map((v) => h("button", {
        class: v.id === b.vault ? "rdm-rail-btn on" : "rdm-rail-btn",
        onclick: () => { if (v.id !== dv.vault) { dv.vault = v.id; dv.onClearSearch?.(); void go(""); } },
      }, svg(ICONS.cloud, 12, { stroke: 1.7 }), h("span", { text: v.name }))));
  }

  rail.append(h("div", { class: "rdm-rail-kicker", text: t("Vista") }),
    h("button", {
      class: !q && dv.filter === "pins" ? "rdm-rail-btn on" : "rdm-rail-btn",
      onclick: () => dvcSetFilter("pins"),
    }, svg(ICONS.star, 12), h("span", { text: t("Preferiti") }), h("em", { text: String(pins.length) })),
    h("button", {
      class: !q && dv.filter === "recents" ? "rdm-rail-btn on" : "rdm-rail-btn",
      onclick: () => dvcSetFilter("recents"),
    }, svg(ICONS.history, 12, { stroke: 1.7 }), h("span", { text: t("Recenti") }), h("em", { text: String(recs.length) })),
    h("button", {
      class: !q && dv.filter === "browse" && !dv.path ? "rdm-rail-btn on" : "rdm-rail-btn",
      onclick: () => { dv.onClearSearch?.(); void go("", { keepSel: true }); },
    }, svg(ICONS.cloud, 12, { stroke: 1.7 }), h("span", { text: t("Radice") })));

  const rootBrowse = dv.browseCache.get(cacheKey(b.vault, "")) ?? (b.path === "" ? b : null);
  if (rootBrowse?.folders.length) {
    rail.append(h("div", { class: "rdm-rail-kicker", text: t("Cartelle") }));
    const renderNodes = (folders: DvcBrowse["folders"], depth: number) => {
      for (const f of folders) {
        const fk = cacheKey(b.vault, f.path);
        const isOpen = dv.treeOpen.has(fk);
        const isHere = !q && dv.filter === "browse" && dv.path.toLowerCase() === f.path.toLowerCase();
        const sub = dv.browseCache.get(fk);
        const row = h("div", {
          class: isHere ? "rdm-tree-item on" : "rdm-tree-item",
          style: `--depth:${depth}`,
          onclick: () => { dv.onClearSearch?.(); void go(f.path, { keepSel: true }); },
        },
        h("button", {
          class: "rdm-tree-exp",
          title: f.name,
          onclick: (ev: Event) => { ev.stopPropagation(); void toggleTreeFolder(b.vault, f.path); },
        }, svg(isOpen ? ICONS.chevronDown : ICONS.chevronRight, 10, { stroke: 2 })),
        h("button", {
          class: "rdm-tree-lbl",
          title: f.path,
          onclick: (ev: Event) => { ev.stopPropagation(); dv.onClearSearch?.(); void go(f.path, { keepSel: true }); },
        }, h("span", { text: f.name }), h("em", { text: String(f.count) })));
        rail.append(row);
        if (isOpen && sub?.folders.length && depth < 4) {
          renderNodes(sub.folders, depth + 1);
        }
      }
    };
    renderNodes(rootBrowse.folders, 0);
  }
  return rail;
}

function tieInlineBar(): HTMLElement | null {
  if (!dv.path || !dv.tieOpen) return null;
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
    dv.onHeaderSync?.();
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") add();
    else if (e.key === "Escape") { dv.tieOpen = false; draw(); }
  });
  return h("div", { class: "dvc-tie" },
    h("span", { class: "dvc-tie-label", text: t("Cliente") }),
    input,
    btn(t("Collega"), add, t("Su un ticket Zammad o una chiamata 3CX di questo cliente, RDM apre questa cartella")),
    btn(t("Annulla"), () => { dv.tieOpen = false; draw(); }));
}

function buildNarrowStrip(b: DvcBrowse): HTMLElement | null {
  const pins = getDvcPins();
  const recs = getDvcRecents();
  if (b.vaults.length <= 1 && !pins.length && !recs.length) return null;

  const strip = h("div", { class: "rdm-narrow-strip" });
  if (b.vaults.length > 1) {
    for (const v of b.vaults) {
      strip.append(h("button", {
        class: v.id === b.vault ? "rdm-pill on" : "rdm-pill",
        onclick: () => { if (v.id !== dv.vault) { dv.vault = v.id; void go(""); } },
      }, svg(ICONS.cloud, 11, { stroke: 1.7 }), h("span", { text: v.name })));
    }
  }
  strip.append(h("button", {
    class: dv.filter === "browse" ? "rdm-pill on" : "rdm-pill",
    onclick: () => dvcSetFilter("browse"),
  }, svg(ICONS.rdmFolder, 10, { stroke: 1.8 }), h("span", { text: t("Cartelle") })));
  if (pins.length) {
    strip.append(h("button", {
      class: dv.filter === "pins" ? "rdm-pill on" : "rdm-pill",
      onclick: () => dvcSetFilter("pins"),
    }, svg(ICONS.star, 10), h("span", { text: `${t("Preferiti")} · ${pins.length}` })));
  }
  if (recs.length) {
    strip.append(h("button", {
      class: dv.filter === "recents" ? "rdm-pill on" : "rdm-pill",
      onclick: () => dvcSetFilter("recents"),
    }, svg(ICONS.history, 10, { stroke: 1.8 }), h("span", { text: `${t("Recenti")} · ${recs.length}` })));
  }
  return strip;
}

function buildCenterList(b: DvcBrowse): HTMLElement {
  const center = h("div", { class: "rdm-center" });
  const q = dv.searchQuery.trim();

  const narrowStrip = !q ? buildNarrowStrip(b) : null;
  if (narrowStrip) center.append(narrowStrip);

  const tieBar = tieInlineBar();
  if (tieBar) center.append(tieBar);

  const listEl = h("div", { class: "rdm-flat-list" });

  if (q) {
    center.append(h("div", { class: "rdm-zone-head" },
      h("span", { class: "rdm-kicker", text: dv.searchLoading ? t("Cerco nel cloud…") : t("Risultati · {n}", { n: dv.searchFound.length }) })));
    if (dv.searchLoading && !dv.searchFound.length) {
      listEl.append(rdmSkelRows(5));
    } else {
      const folders = dv.searchFound.filter((x) => x.kind === "Group");
      const entries = dv.searchFound.filter((x) => x.kind !== "Group");
      if (!folders.length && !entries.length) {
        listEl.append(h("div", { class: "rdm-empty-state" },
          svg(ICONS.search, 22, { stroke: 1.5 }),
          h("b", { text: t("Niente nel cloud con «{q}»", { q }) }),
          h("span", { text: t("Prova con il nome del cliente, un IP, un utente o il tipo di connessione.") })));
      } else {
        if (folders.length) {
          listEl.append(h("div", { class: "rdm-list-label" }, h("span", { text: t("Cartelle") }), h("em", { text: String(folders.length) })));
          for (const f of folders) {
            listEl.append(flatFolderRow(f.vault, { name: f.name, path: f.path || [f.folder, f.name].filter(Boolean).join("\\"), count: 0 }, "sf"));
          }
        }
        const groups = new Map<string, DvcItem[]>();
        for (const e of entries) {
          const key = e.folder || t("Radice");
          const arr = groups.get(key) ?? [];
          arr.push(e);
          groups.set(key, arr);
        }
        for (const [folder, items] of groups) {
          listEl.append(h("div", { class: "rdm-list-label" },
            h("span", { text: rdmFolderTail(folder, 2) || folder }),
            h("em", { text: String(items.length) })));
          for (const e of items) listEl.append(flatEntryRow(e, { showFolder: false, prefix: "srch" }));
        }
      }
    }
    center.append(listEl);
    return center;
  }

  if (dv.filter === "pins") {
    const pins = getDvcPins().map((p) => findEntryById(p.id) ?? p);
    center.append(h("div", { class: "rdm-zone-head" },
      h("span", { class: "rdm-kicker", text: t("Preferiti") }),
      h("span", { class: "rdm-kicker", text: String(pins.length) })));
    if (pins.length) for (const p of pins) listEl.append(flatEntryRow(p, { showFolder: true, prefix: "pin" }));
    else listEl.append(h("div", { class: "rdm-empty-state" }, svg(ICONS.star, 22), h("b", { text: t("Nessun preferito") })));
    center.append(listEl);
    return center;
  }

  if (dv.filter === "recents") {
    const recs = getDvcRecents();
    center.append(h("div", { class: "rdm-zone-head" },
      h("span", { class: "rdm-kicker", text: t("Recenti") }),
      h("span", { class: "rdm-kicker", text: String(recs.length) })));
    if (recs.length) for (const r of recs) listEl.append(flatEntryRow(r, { showFolder: true, prefix: "rec" }));
    else listEl.append(h("div", { class: "rdm-empty-state" }, svg(ICONS.history, 22, { stroke: 1.5 }), h("b", { text: t("Nessuna voce recente") })));
    center.append(listEl);
    return center;
  }

  // Folder browse mode: subtle breadcrumbs + create links
  const parts = b.path ? b.path.split("\\") : [];
  const headTrail = h("div", { class: "rdm-zone-head" },
    h("div", { class: "rdm-trail" },
      h("button", { class: "rdm-trail-btn", onclick: () => void go("", { keepSel: true }) },
        h("span", { text: b.vaults.find((v) => v.id === b.vault)?.name ?? "Cloud" })),
      ...parts.flatMap((p, i) => {
        const to = parts.slice(0, i + 1).join("\\");
        return [
          h("span", { class: "dvc-sep", text: "›" }),
          i === parts.length - 1
            ? h("b", { class: "rdm-trail-cur", text: p })
            : h("button", { class: "rdm-trail-btn", onclick: () => void go(to, { keepSel: true }) }, h("span", { text: p })),
        ];
      })),
    b.path && !dv.form
      ? h("div", { class: "rdm-zone-acts" },
        btn(t("+ Credenziale"), () => { dv.form = { kind: "cred", name: "", user: "", domain: "", password: "", description: "" }; dv.result = null; draw(); State.notify(); }),
        btn(t("+ Lista"), () => { dv.form = { kind: "list", name: t("Lista Password"), recurse: false }; dv.result = null; draw(); State.notify(); }, t("+ Lista password da questa cartella")))
      : null);
  center.append(headTrail);

  if (dv.loadingBrowse) {
    listEl.append(rdmSkelRows(5));
  } else {
    const res = resultPart();
    if (res) listEl.append(res);
    const form = formPart();
    if (form) {
      listEl.append(form);
    } else {
      if (!b.path) {
        const pins = getDvcPins().map((p) => findEntryById(p.id) ?? p);
        const recs = getDvcRecents().filter((r) => !pins.some((p) => p.id === r.id));
        if (pins.length) {
          listEl.append(h("div", { class: "rdm-list-label" }, h("span", { text: t("Preferiti") }), h("em", { text: String(pins.length) })));
          for (const p of pins) listEl.append(flatEntryRow(p, { showFolder: true, prefix: "pin" }));
        }
        if (recs.length) {
          listEl.append(h("div", { class: "rdm-list-label" }, h("span", { text: t("Recenti") }), h("em", { text: String(recs.length) })));
          for (const r of recs.slice(0, 4)) listEl.append(flatEntryRow(r, { showFolder: true, prefix: "rec" }));
        }
      }

      if (b.folders.length) {
        listEl.append(h("div", { class: "rdm-list-label" }, h("span", { text: t("Cartelle") }), h("em", { text: String(b.folders.length) })));
        for (const f of b.folders) listEl.append(flatFolderRow(b.vault, f));
      }
      if (b.entries.length) {
        if (b.folders.length) {
          listEl.append(h("div", { class: "rdm-list-label" }, h("span", { text: t("Voci") }), h("em", { text: String(b.entries.length) })));
        }
        for (const e of b.entries) listEl.append(flatEntryRow(e));
      }
      if (!b.folders.length && !b.entries.length && (b.path || (!getDvcPins().length && !getDvcRecents().length))) {
        listEl.append(h("div", { class: "rdm-empty-state compact" },
          svg(ICONS.rdmFolder, 20, { stroke: 1.5 }),
          h("b", { text: t("Cartella vuota.") })));
      }
    }
  }

  center.append(listEl);
  return center;
}

function draw() {
  const ws = dv.ws;
  if (!ws) return;
  const focused = ws.ownerDocument.activeElement;
  const keep = focused instanceof HTMLInputElement && ws.contains(focused) ? focused.dataset.k ?? "" : "";
  const listScrolled = ws.querySelector(".rdm-flat-list")?.scrollTop ?? 0;
  const railScrolled = ws.querySelector(".rdm-tree-rail")?.scrollTop ?? 0;
  const detailScrolled = ws.querySelector(".rdm-detail-pane")?.scrollTop ?? 0;
  clear(ws);

  const b = dv.browse;
  if (!b || !b.vaults.length) {
    ws.classList.remove("has-detail");
    if (dv.loadingBrowse) {
      ws.append(h("div", { class: "rdm-center" }, rdmSkelRows(5)));
    } else {
      ws.append(h("div", { class: "rdm-center" },
        h("div", { class: "rdm-empty-state" },
          svg(ICONS.cloud, 24, { stroke: 1.5 }),
          h("b", { text: t("Devolutions Cloud non sincronizzato") }),
          h("span", { text: t("Nessun vault letto: premi Sincronizza (in alto) dopo aver messo indirizzo, Key e Secret in Impostazioni → Remote Desktop Manager.") }))));
    }
    return;
  }

  ws.classList.toggle("has-detail", !!dv.sel);
  ws.append(buildTreeRail(b), buildCenterList(b), detailPane());

  const toastHost = ws.parentElement?.querySelector<HTMLElement>(".rdm-toast");
  if (toastHost) {
    const activeClip = dv.clipWait && dv.clipWait.until > Date.now() ? dv.clipWait : null;
    const text = dv.note || activeClip?.note || "";
    const toastDrain = activeClip ? drainBar(activeClip.until, activeClip.totalMs, { color: "#22c55e" }) : null;
    toastHost.replaceChildren(h("span", { text }), toastDrain ?? "");
    toastHost.classList.toggle("has-drain", !!toastDrain);
    toastHost.style.display = text ? "" : "none";
  }

  const listEl = ws.querySelector(".rdm-flat-list");
  if (listEl) listEl.scrollTop = listScrolled;
  const railEl = ws.querySelector(".rdm-tree-rail");
  if (railEl) railEl.scrollTop = railScrolled;
  const detailEl = ws.querySelector(".rdm-detail-pane");
  if (detailEl) detailEl.scrollTop = detailScrolled;

  if (keep) {
    const again = Array.from(ws.querySelectorAll("input")).find((i) => i.dataset.k === keep);
    again?.focus();
  }
}

export function dvcHandleEscape(): boolean {
  if (dv.tieOpen) {
    dv.tieOpen = false;
    draw();
    return true;
  }
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

export function dvcSetActiveKey(key: string) {
  dv.activeKey = key;
}

/** Mounts Devolutions Cloud inside `ws` and warms the live PowerShell connection. */
export function dvcMount(ws: HTMLElement, onHeaderSync: () => void) {
  const firstMount = dv.ws !== ws;
  dv.ws = ws;
  dv.onHeaderSync = onHeaderSync;
  warmOnce();
  if (firstMount || !dv.browse) {
    void go(dv.path);
  } else {
    draw();
  }
}
