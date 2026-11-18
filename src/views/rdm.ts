// Remote Desktop Manager & Devolutions Cloud card (src-tauri/src/rdm.rs,
// src-tauri/src/dvc.rs): Panoramica-inspired 3-zone workspace (left tree rail,
// flat center list with shaded gradient icon boxes, right detail pane — or
// 1-column with pop-in detail drawer when narrow), centerpiece search with
// match highlighting, favorite/recent counters (integrationConfig.rdmPins &
// rdmRecent), and card-scoped keyboard navigation (↑↓, Invio, Esc, Ctrl+F, /,
// Alt+U, Alt+P, Alt+O).

import { h, svg, clear, brandOrDot } from "./dom";
import { ICONS } from "./icons";
import { State, type RdmRef } from "../core/state";
import { Bridge, type DvcItem, type RdmEntry } from "../core/bridge";
import { t } from "../core/i18n";
import { Sound } from "../core/sound";
import { timeAgo } from "./integrations";
import {
  dvcFolderFor,
  dvcGoTo,
  dvcHandleEscape,
  dvcMount,
  dvcResetCache,
  dvcSetActiveKey,
  dvcSetFilter,
  dvcSetSearch,
  dvcShowEntry,
  dvcStateSummary,
  dvcToggleTieInput,
} from "./dvc";

export const RDM = "integration_rdm";
const COLOR = "#E8542A";

export type KindTone = "rdp" | "ssh" | "web" | "vnc" | "vpn" | "ftp" | "cred" | "list" | "folder" | "other";

export interface KindMeta {
  label: string;
  longLabel: string;
  tone: KindTone;
  color: string;
  icon: string;
}

const TONE_COLOR: Record<KindTone, string> = {
  rdp: "#3b82f6",
  ssh: "#10b981",
  web: "#0ea5e9",
  vpn: "#8b5cf6",
  vnc: "#ec4899",
  ftp: "#f59e0b",
  cred: "#eab308",
  list: "#E8542A",
  folder: "#f59e0b",
  other: "#64748b",
};

const rdm = {
  el: null as HTMLElement | null,
  topSlot: null as HTMLElement | null,
  errSlot: null as HTMLElement | null,
  search: null as HTMLInputElement | null,
  clearBtn: null as HTMLButtonElement | null,
  kbdHint: null as HTMLElement | null,
  searchMeta: null as HTMLElement | null,
  workspace: null as HTMLElement | null,
  msg: null as HTMLElement | null,
  query: "",
  found: [] as RdmEntry[],
  cloudFound: [] as DvcItem[],
  searching: false,
  timer: 0,
  note: "",
  noteTimer: 0,
  syncing: false,
  lastCloudAt: 0,
  activeKey: "",
  /** Selected local RDM entry for the detail pane. */
  localSel: null as RdmEntry | null,
  /** Local RDM left-rail filter: "all" (pins+recents), "pins", "recents", or "grp:<name>". */
  localScope: "all",
  openSettings: (() => {}) as () => void,
  redraw: null as (() => void) | null,
};

/** Looks like a host: an IPv4/IPv6 address or a name with a dot, no spaces. */
export function looksLikeHost(text: string): boolean {
  const s = text.trim();
  if (!s || s.length > 253 || /\s/.test(s)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$/.test(s)) return true;
  if (/^\[?[0-9a-f:]+\]?$/i.test(s) && s.includes(":")) return true;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(s);
}

/** True when the RDM integration is on. */
export function rdmActive(): boolean {
  return State.settings.activeIntegrations.includes(RDM);
}

/** A cloud folder's own path (dvc.rs Item: `path` for a folder, else parent + name). */
export function dvcFolderPath(e: DvcItem): string {
  return e.path || [e.folder, e.name].filter(Boolean).join("\\");
}

/** Devolutions Cloud is on (rdm.rs summary `cloud`). */
export function cloudOn(): boolean {
  const cloud = (State.integrations[RDM]?.data as { cloud?: { on?: boolean } } | undefined)?.cloud;
  return !!cloud?.on;
}

/** Key used by views.ts so typing, scrolling or filling forms never detaches the card DOM. */
export function rdmKey(): string {
  if (rdm.query.trim()) return "rdm~searching";
  const info = State.integrations[RDM];
  const data = (info?.data ?? {}) as Record<string, unknown>;
  const cloud = (data.cloud ?? {}) as { on?: boolean; count?: number; at?: number; error?: string | null };
  const pins = (State.settings.integrationConfig.rdmPins ?? [])
    .map((p) => `${p.vault ?? ""}|${p.id}`)
    .join(",");
  return [
    info?.loaded,
    info?.configured,
    info?.error,
    cloud.on,
    cloud.count,
    cloud.at,
    cloud.error,
    data.count,
    data.running,
    data.dataSource,
    data.listError,
    pins,
  ].join("~");
}

/** Type metadata (tag, shaded box tone/color, SVG icon) from RDM's connection type. */
export function kindInfo(kind: string, cred = ""): KindMeta {
  const mk = (label: string, longLabel: string, tone: KindTone, icon: string): KindMeta => ({
    label, longLabel, tone, color: TONE_COLOR[tone], icon,
  });
  if (kind === "Group") return mk(t("Cartella"), t("Cartella"), "folder", ICONS.rdmFolder);
  if (cred === "PasswordList") return mk(t("Lista"), t("Lista password"), "list", ICONS.rdmList);
  if (kind.startsWith("Credential")) return mk(t("Cred"), t("Credenziale"), "cred", ICONS.rdmKey);
  const k = kind.toLowerCase();
  if (k.startsWith("rdp")) return mk("RDP", t("Connessione RDP"), "rdp", ICONS.rdmRdp);
  if (k.startsWith("ssh") || k.includes("putty") || k.includes("terminal") || k.includes("telnet")) {
    return mk("SSH", t("Terminale SSH"), "ssh", ICONS.lineTerminal);
  }
  if (k.startsWith("powershell")) return mk("PS", "PowerShell", "ssh", ICONS.lineTerminal);
  if (k.startsWith("web") || k.includes("http") || k.includes("browser")) return mk("Web", t("Portale Web"), "web", ICONS.rdmWeb);
  if (k.includes("vpn") || k.includes("wireguard") || k.includes("openvpn") || k.includes("forti") || k.includes("cisco")) {
    return mk("VPN", t("Connessione VPN"), "vpn", ICONS.rdmVpn);
  }
  if (k.startsWith("vnc")) return mk("VNC", "VNC", "vnc", ICONS.rdmVnc);
  if (k.includes("teamviewer")) return mk("TV", "TeamViewer", "vnc", ICONS.rdmVnc);
  if (k.includes("anydesk")) return mk("AnyDesk", "AnyDesk", "vnc", ICONS.rdmVnc);
  if (k.includes("sftp")) return mk("SFTP", "SFTP", "ftp", ICONS.rdmFtp);
  if (k.includes("ftp") || k.includes("scp")) return mk("FTP", "FTP", "ftp", ICONS.rdmFtp);
  const short = kind.replace(/([a-z])([A-Z]).*/, "$1").slice(0, 8) || "RDM";
  return mk(short, kind || "RDM", "other", ICONS.rdmRdp);
}

/** "RDP", "SSH", "Web"… from RDM's connection type (used by search.ts too). */
export function kindLabel(kind: string): string {
  return kindInfo(kind).label;
}

/** Last `levels` segments of a folder path ("A\\B\\C" → "B › C"). */
export function rdmFolderTail(group: string, levels = 2): string {
  const parts = group.split(/[\\/]/).filter(Boolean);
  return parts.slice(-levels).join(" › ");
}

// ── Shared Panoramica-style UI primitives ────────────────────────────────────

/** Shaded gradient icon tile (matching dashboard.css .dash-stage-icon). */
export function rdmToneBox(kind: string, cred = "", size: "sm" | "lg" = "sm"): HTMLElement {
  const meta = kindInfo(kind, cred);
  return h("span", {
    class: size === "lg" ? "rdm-tone-box lg" : "rdm-tone-box",
    style: `--tone:${meta.color}`,
    "aria-hidden": "true",
  }, svg(meta.icon, size === "lg" ? 20 : 15, { stroke: 1.8 }));
}

/** Small uppercase monospace tag (matching dashboard.css .dash-tag). */
export function rdmTag(kind: string, cred = ""): HTMLElement {
  const meta = kindInfo(kind, cred);
  return h("span", { class: "rdm-tag", style: `--tag:${meta.color}`, text: meta.label });
}

/** Safe DOM text highlighting for search queries (zero innerHTML). */
export function renderHighlight(text: string, query: string): (Node | string)[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!text || !words.length) return [text];
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const out: (Node | string)[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    out.push(h("mark", { class: "rdm-hit", text: m[0] }));
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : [text];
}

/** Animated skeleton shimmer rows while loading (1–3 s cloud fetch). */
export function rdmSkelRows(count = 4): HTMLElement {
  return h("div", { class: "rdm-skel-list", "aria-hidden": "true" },
    ...Array.from({ length: count }, () =>
      h("div", { class: "rdm-skel-row" },
        h("span", { class: "rdm-skel rdm-skel-ico" }),
        h("div", { class: "rdm-skel-lines" },
          h("span", { class: "rdm-skel rdm-skel-t" }),
          h("span", { class: "rdm-skel rdm-skel-s" })))));
}

export function rdmHoverBtn(
  label: string,
  icon: string,
  title: string,
  onClick: () => void,
  opts: { primary?: boolean; act?: string } = {},
): HTMLElement {
  return h("button", {
    class: opts.primary ? "rdm-row-btn primary" : "rdm-row-btn",
    title,
    "data-act": opts.act,
    onclick: (ev: Event) => { ev.stopPropagation(); onClick(); },
  }, svg(icon, 11, { stroke: 1.9 }), h("span", { text: label }));
}

export async function rdmCopyText(text: string, feedback: string, say: (msg: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    Sound.play("blip");
    say(feedback);
  } catch (err) {
    Sound.play("error");
    say(String(err).replace(/^Error:\s*/, ""));
  }
}

// ── Favorites (rdmPins) & Recents (rdmRecent in settings, max 8) ──────────────

export function dvcToRef(e: DvcItem): RdmRef {
  return {
    id: e.id,
    name: e.name,
    group: e.folder,
    host: e.host,
    kind: e.kind,
    vault: e.vault,
    user: e.user ?? "",
    cred: e.cred,
  };
}

export function refToDvc(r: RdmRef): DvcItem {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    folder: r.group,
    path: "",
    host: r.host,
    user: r.user ?? "",
    cred: r.cred ?? "",
    vault: r.vault ?? "",
  };
}

export function isPinnedRef(id: string, vault = ""): boolean {
  return (State.settings.integrationConfig.rdmPins ?? []).some(
    (p) => p.id === id && (p.vault ?? "") === vault,
  );
}

export function togglePinRef(ref: RdmRef) {
  const cfg = State.settings.integrationConfig;
  const pins = cfg.rdmPins ?? [];
  const vault = ref.vault ?? "";
  const exists = pins.some((p) => p.id === ref.id && (p.vault ?? "") === vault);
  cfg.rdmPins = exists
    ? pins.filter((p) => !(p.id === ref.id && (p.vault ?? "") === vault))
    : [ref, ...pins].slice(0, 20);
  void Bridge.saveSettings(State.settings);
}

function pushRecentLocal(ref: RdmRef) {
  const cfg = State.settings.integrationConfig;
  const vault = ref.vault ?? "";
  const prev = (cfg.rdmRecent ?? []).filter((r) => !(r.id === ref.id && (r.vault ?? "") === vault));
  cfg.rdmRecent = [ref, ...prev].slice(0, 8);
}

export function recordDvcRecent(e: DvcItem) {
  if (!e.id || e.kind === "Group") return;
  const ref = dvcToRef(e);
  pushRecentLocal(ref);
  void Bridge.rdmRecentAdd(ref);
}

export function getDvcPins(): DvcItem[] {
  return (State.settings.integrationConfig.rdmPins ?? []).filter((p) => !!p.vault).map(refToDvc);
}

export function getDvcRecents(): DvcItem[] {
  return (State.settings.integrationConfig.rdmRecent ?? []).filter((r) => !!r.vault).map(refToDvc);
}

function recordRdmRecent(e: RdmEntry) {
  if (!e.id) return;
  const ref: RdmRef = { id: e.id, name: e.name, group: e.group, host: e.host, kind: e.kind, user: e.user };
  pushRecentLocal(ref);
  void Bridge.rdmRecentAdd(ref);
}

function getRdmRecents(): RdmEntry[] {
  return (State.settings.integrationConfig.rdmRecent ?? []).filter((r) => !r.vault);
}

// ── Search & external entry points ───────────────────────────────────────────

function syncSearchChrome() {
  const q = rdm.query.trim();
  if (rdm.clearBtn) rdm.clearBtn.style.display = q ? "" : "none";
  if (rdm.kbdHint) rdm.kbdHint.style.display = q ? "none" : "";
  if (rdm.searchMeta) {
    if (!q) {
      rdm.searchMeta.textContent = "";
      rdm.searchMeta.style.display = "none";
    } else {
      const n = cloudOn() ? rdm.cloudFound.length : rdm.found.length;
      rdm.searchMeta.textContent = rdm.searching ? "…" : String(n);
      rdm.searchMeta.style.display = "";
    }
  }
}

function searchSoon(now = false) {
  window.clearTimeout(rdm.timer);
  const q = rdm.query.trim();
  if (!q) {
    rdm.found = [];
    rdm.cloudFound = [];
    rdm.searching = false;
    syncSearchChrome();
    if (cloudOn()) dvcSetSearch("", [], false);
    rdm.redraw?.();
    return;
  }
  rdm.searching = true;
  syncSearchChrome();
  if (cloudOn()) dvcSetSearch(q, rdm.cloudFound, true, clearSearch);
  else rdm.redraw?.();

  rdm.timer = window.setTimeout(async () => {
    if (cloudOn()) {
      const found = (await Bridge.dvcSearch(q, 100)) ?? [];
      if (rdm.query.trim() !== q) return;
      rdm.cloudFound = found;
      rdm.found = [];
      rdm.searching = false;
      syncSearchChrome();
      dvcSetSearch(q, found, false, clearSearch);
    } else {
      const found = (await Bridge.rdmSearch(q, 50)) ?? [];
      if (rdm.query.trim() !== q) return;
      rdm.found = found;
      rdm.searching = false;
      syncSearchChrome();
    }
    rdm.redraw?.();
  }, now ? 0 : 75);
}

function clearSearch() {
  rdm.query = "";
  if (rdm.search) rdm.search.value = "";
  searchSoon(true);
  focusSearch();
}

function focusSearch(selectAll = false) {
  requestAnimationFrame(() => {
    const input = rdm.search;
    const card = rdm.el;
    if (!input || !card || !input.isConnected) return;
    const active = document.activeElement;
    if (!selectAll && active && card.contains(active) && active !== document.body && active.closest(".dvc-form, .dvc-tie")) return;
    input.focus();
    if (selectAll) input.select();
  });
}

/** The card, focused, with these words in its search (a call, a ticket, the selection). */
export function rdmLookFor(query: string) {
  const tied = cloudOn() ? dvcFolderFor(query) : null;
  if (tied) {
    rdm.query = "";
    if (rdm.search) rdm.search.value = "";
    syncSearchChrome();
    dvcGoTo(tied.vault, tied.path);
    rdm.redraw?.();
    State.setFocus(RDM);
    State.notify();
    focusSearch();
    return;
  }
  rdm.query = query.trim();
  if (rdm.search) rdm.search.value = rdm.query;
  searchSoon(true);
  State.setFocus(RDM);
  State.notify();
  focusSearch();
}

/** A cloud entry found in the search field: the card, its folder, its pane open. */
export function rdmShowEntry(e: DvcItem) {
  rdm.query = "";
  rdm.cloudFound = [];
  if (rdm.search) rdm.search.value = "";
  syncSearchChrome();
  if (e.kind === "Group") dvcGoTo(e.vault, dvcFolderPath(e));
  else void dvcShowEntry(e).then(() => rdm.redraw?.());
  rdm.redraw?.();
  State.setFocus(RDM);
  State.notify();
}

// ── Keyboard navigation inside the open & focused card ───────────────────────

function moveActive(delta: number) {
  const card = rdm.el;
  if (!card) return;
  const items = Array.from(card.querySelectorAll<HTMLElement>(".rdm-nav-item"));
  if (!items.length) return;
  const curIdx = items.findIndex((el) => el.classList.contains("is-active"));
  const nextIdx = curIdx < 0
    ? (delta > 0 ? 0 : items.length - 1)
    : Math.max(0, Math.min(items.length - 1, curIdx + delta));
  for (const item of items) item.classList.remove("is-active");
  const target = items[nextIdx];
  if (!target) return;
  target.classList.add("is-active");
  const key = target.dataset.navKey ?? "";
  rdm.activeKey = key;
  dvcSetActiveKey(key);
  target.scrollIntoView({ block: "nearest" });
}

function currentActionScope(): HTMLElement | null {
  const card = rdm.el;
  if (!card) return null;
  return card.querySelector<HTMLElement>(".rdm-nav-item.is-active")
    ?? card.querySelector<HTMLElement>(".rdm-detail-pane")
    ?? card.querySelector<HTMLElement>(".rdm-nav-item");
}

function wireCardKeys(card: HTMLElement) {
  card.addEventListener("keydown", (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const inForm = !!target?.closest(".dvc-form, .dvc-tie, select");

    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      focusSearch(true);
      return;
    }

    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !target?.closest("input, textarea")) {
      e.preventDefault();
      e.stopPropagation();
      focusSearch(true);
      return;
    }

    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const k = e.key.toLowerCase();
      const act = k === "u" ? "copy-user" : k === "p" ? "copy-pw" : k === "o" ? "open" : "";
      if (act) {
        const scope = currentActionScope();
        const btn = scope?.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)
          ?? card.querySelector<HTMLButtonElement>(`.rdm-detail-pane [data-act="${act}"]`);
        if (btn) {
          e.preventDefault();
          e.stopPropagation();
          btn.click();
        }
        return;
      }
    }

    if (inForm) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      moveActive(-1);
    } else if (e.key === "Enter") {
      if (target && target.tagName === "BUTTON" && !target.classList.contains("rdm-nav-item")) return;
      const row = card.querySelector<HTMLElement>(".rdm-nav-item.is-active")
        ?? card.querySelector<HTMLElement>(".rdm-nav-item");
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        const openBtn = row.querySelector<HTMLButtonElement>('[data-act="open"]');
        if (openBtn) { openBtn.click(); return; }
      }
      row.click();
    } else if (e.key === "Escape") {
      if (rdm.query) {
        e.preventDefault();
        e.stopPropagation();
        clearSearch();
      } else if (cloudOn() && dvcHandleEscape()) {
        e.preventDefault();
        e.stopPropagation();
      } else if (!cloudOn() && rdm.localSel) {
        e.preventDefault();
        e.stopPropagation();
        rdm.localSel = null;
        rdm.redraw?.();
      }
    }
  });
}

// ── Local RDM 3-zone workspace ───────────────────────────────────────────────

function sayLocal(text: string) {
  rdm.note = text;
  window.clearTimeout(rdm.noteTimer);
  if (rdm.msg) {
    rdm.msg.textContent = text;
    rdm.msg.style.display = text ? "" : "none";
  }
  if (text) {
    rdm.noteTimer = window.setTimeout(() => {
      rdm.note = "";
      if (rdm.msg) { rdm.msg.textContent = ""; rdm.msg.style.display = "none"; }
    }, 4500);
  }
}

function openLocal(e: RdmEntry) {
  recordRdmRecent(e);
  void Bridge.rdmOpen(e)
    .then(() => { Sound.play("blip"); sayLocal(t("Aperto «{n}» in RDM.", { n: e.name })); })
    .catch((err) => { Sound.play("error"); sayLocal(String(err).replace(/^Error:\s*/, "")); });
}

function localFlatRow(e: RdmEntry, prefix: string): HTMLElement {
  const navKey = `${prefix}:${e.id}`;
  const isActive = rdm.activeKey === navKey;
  const isSelected = rdm.localSel?.id === e.id;
  const userText = (e.user ?? "").trim();
  const folderText = rdmFolderTail(e.group, 2);
  const subParts = [e.host, userText, folderText].filter(Boolean);
  const q = rdm.query.trim();

  return h("div", {
    class: `rdm-flat-row rdm-nav-item${isSelected ? " on" : ""}${isActive ? " is-active" : ""}`,
    role: "button",
    tabindex: "-1",
    "data-nav-key": navKey,
    title: [e.group, e.host, userText].filter(Boolean).join(" · ") || e.name,
    onclick: () => {
      rdm.activeKey = navKey;
      rdm.localSel = rdm.localSel?.id === e.id ? null : e;
      rdm.redraw?.();
    },
    ondblclick: () => openLocal(e),
  },
  rdmToneBox(e.kind),
  h("div", { class: "rdm-row-main" },
    h("div", { class: "rdm-row-title" },
      h("span", { class: "rdm-row-name" }, ...(q ? renderHighlight(e.name, q) : [e.name])),
      rdmTag(e.kind)),
    subParts.length ? h("div", { class: "rdm-row-sub" },
      ...(q ? renderHighlight(subParts.join(" · "), q) : [subParts.join(" · ")])) : null),
  h("div", { class: "rdm-row-acts" },
    rdmHoverBtn(t("Apri"), ICONS.arrowUpRight, t("Apri in RDM (Alt+O)"), () => openLocal(e), { primary: true, act: "open" }),
    e.host ? rdmHoverBtn(t("Host"), ICONS.copy, t("Copia host"), () => {
      recordRdmRecent(e);
      void rdmCopyText(e.host, t("Copiato: {h}", { h: e.host }), sayLocal);
    }) : null));
}

function localDetailPane(e: RdmEntry | null): HTMLElement {
  const pane = h("div", { class: "rdm-detail-pane" });
  if (!e) {
    pane.append(h("div", { class: "rdm-detail-empty" },
      svg(ICONS.rdmRdp, 26, { stroke: 1.4 }),
      h("b", { text: t("Seleziona una connessione") }),
      h("span", { text: t("Frecce ↑ ↓ per scorrere, Invio per i dettagli, Alt+O per aprire in RDM.") })));
    return pane;
  }
  const info = kindInfo(e.kind);
  const pinned = isPinnedRef(e.id, "");
  const userText = (e.user ?? "").trim();

  pane.append(h("div", { class: "rdm-detail-bar" },
    h("button", { class: "rdm-back-btn", onclick: (ev: Event) => { ev.stopPropagation(); rdm.localSel = null; rdm.redraw?.(); } },
      svg(ICONS.chevronLeft, 12, { stroke: 2 }), h("span", { text: t("Elenco") })),
    h("button", { class: "dvc-close", title: t("Chiudi"), onclick: (ev: Event) => { ev.stopPropagation(); rdm.localSel = null; rdm.redraw?.(); } },
      svg(ICONS.xmark, 13))));

  pane.append(h("div", { class: "rdm-detail-hero" },
    rdmToneBox(e.kind, "", "lg"),
    h("div", { class: "rdm-detail-titles" },
      h("span", { class: "rdm-kicker", text: info.longLabel }),
      h("b", { class: "rdm-detail-name", text: e.name }))));

  pane.append(h("div", { class: "rdm-detail-actions" },
    h("button", { class: "rdm-big-btn primary", "data-act": "open", title: t("Apri in RDM (Alt+O)"), onclick: () => openLocal(e) },
      svg(ICONS.arrowUpRight, 13, { stroke: 1.9 }), h("span", { text: t("Apri") })),
    h("button", { class: "rdm-big-btn", onclick: () => void Bridge.rdmEdit(e.id).catch((err) => sayLocal(String(err).replace(/^Error:\s*/, ""))) },
      svg(ICONS.sliders, 13), h("span", { text: t("Modifica") })),
    h("button", {
      class: pinned ? "rdm-big-btn on" : "rdm-big-btn",
      title: pinned ? t("Togli dai preferiti") : t("Aggiungi ai preferiti"),
      onclick: () => { togglePinRef({ id: e.id, name: e.name, group: e.group, host: e.host, kind: e.kind, user: e.user }); rdm.redraw?.(); },
    }, svg(ICONS.star, 13), h("span", { text: t("Preferito") }))));

  const kv = h("div", { class: "rdm-kv-list" });
  const addKv = (label: string, value: string, act?: string, tipText?: string) => {
    if (!value) return;
    kv.append(h("div", { class: "rdm-kv-row" },
      h("span", { class: "rdm-kv-k", text: label }),
      h("b", { class: "rdm-kv-v", text: value }),
      h("button", {
        class: "rdm-kv-copy",
        "data-act": act,
        title: tipText ?? t("Copia"),
        onclick: (ev: Event) => {
          ev.stopPropagation();
          recordRdmRecent(e);
          void rdmCopyText(value, t("{l} copiato", { l: label }), sayLocal);
        },
      }, svg(ICONS.copy, 12))));
  };
  addKv(t("Host"), e.host);
  addKv(t("Utente"), userText, "copy-user", t("Copia utente (Alt+U)"));
  addKv(t("Cartella"), e.group);
  addKv(t("Tipo"), info.longLabel);
  pane.append(kv);
  return pane;
}

function renderLocalWorkspace(ws: HTMLElement, canList: boolean, listError: string) {
  clear(ws);
  const q = rdm.query.trim();
  const cfgPins = (State.settings.integrationConfig.rdmPins ?? []).filter((p) => !p.vault);
  const recents = getRdmRecents().filter((r) => !cfgPins.some((p) => p.id === r.id));

  // Folders gathered from search hits or saved pins/recents
  const folderMap = new Map<string, RdmEntry[]>();
  const source = q ? rdm.found : [...cfgPins, ...recents];
  for (const e of source) {
    const grp = e.group || t("Generale");
    const list = folderMap.get(grp) ?? [];
    list.push(e);
    folderMap.set(grp, list);
  }

  ws.classList.toggle("has-detail", !!rdm.localSel);

  // Left rail (3-zone on wide)
  const rail = h("aside", { class: "rdm-tree-rail" },
    h("div", { class: "rdm-rail-kicker", text: t("Vista") }),
    h("button", {
      class: rdm.localScope === "all" && !q ? "rdm-rail-btn on" : "rdm-rail-btn",
      onclick: () => { rdm.localScope = "all"; if (q) clearSearch(); else rdm.redraw?.(); },
    }, svg(ICONS.apps, 12), h("span", { text: t("Tutto") }), h("em", { text: String(cfgPins.length + recents.length) })),
    h("button", {
      class: rdm.localScope === "pins" && !q ? "rdm-rail-btn on" : "rdm-rail-btn",
      onclick: () => { rdm.localScope = "pins"; if (q) clearSearch(); else rdm.redraw?.(); },
    }, svg(ICONS.star, 12), h("span", { text: t("Preferiti") }), h("em", { text: String(cfgPins.length) })),
    h("button", {
      class: rdm.localScope === "recents" && !q ? "rdm-rail-btn on" : "rdm-rail-btn",
      onclick: () => { rdm.localScope = "recents"; if (q) clearSearch(); else rdm.redraw?.(); },
    }, svg(ICONS.history, 12, { stroke: 1.7 }), h("span", { text: t("Recenti") }), h("em", { text: String(recents.length) })));

  if (folderMap.size) {
    rail.append(h("div", { class: "rdm-rail-kicker", text: t("Cartelle") }));
    for (const [grp, items] of folderMap) {
      const scope = `grp:${grp}`;
      rail.append(h("button", {
        class: rdm.localScope === scope && !q ? "rdm-rail-btn on" : "rdm-rail-btn",
        title: grp,
        onclick: () => { rdm.localScope = scope; if (q) clearSearch(); else rdm.redraw?.(); },
      }, svg(ICONS.rdmFolder, 12, { stroke: 1.7 }), h("span", { text: rdmFolderTail(grp, 1) || grp }), h("em", { text: String(items.length) })));
    }
  }

  // Center flat list
  const center = h("div", { class: "rdm-center" });
  const listEl = h("div", { class: "rdm-flat-list" });
  const fail = (err: unknown) => sayLocal(String(err).replace(/^Error:\s*/, ""));

  // Compact narrow filter pills
  if (!q) {
    center.append(h("div", { class: "rdm-narrow-strip" },
      h("button", { class: rdm.localScope === "all" ? "rdm-pill on" : "rdm-pill", onclick: () => { rdm.localScope = "all"; rdm.redraw?.(); } }, h("span", { text: t("Tutto") })),
      h("button", { class: rdm.localScope === "pins" ? "rdm-pill on" : "rdm-pill", onclick: () => { rdm.localScope = "pins"; rdm.redraw?.(); } }, h("span", { text: `${t("Preferiti")} · ${cfgPins.length}` })),
      h("button", { class: rdm.localScope === "recents" ? "rdm-pill on" : "rdm-pill", onclick: () => { rdm.localScope = "recents"; rdm.redraw?.(); } }, h("span", { text: `${t("Recenti")} · ${recents.length}` }))));
  }

  if (q) {
    center.append(h("div", { class: "rdm-zone-head" },
      h("span", { class: "rdm-kicker", text: rdm.searching ? t("Cerco connessioni…") : t("Risultati · {n}", { n: rdm.found.length }) })));
    if (rdm.searching && !rdm.found.length) {
      listEl.append(rdmSkelRows(4));
    } else if (rdm.found.length) {
      for (const e of rdm.found) listEl.append(localFlatRow(e, "ls"));
    } else {
      listEl.append(h("div", { class: "rdm-empty-state" },
        svg(ICONS.search, 22, { stroke: 1.5 }),
        h("b", { text: canList ? t("Nessuna connessione trovata.") : t("L'elenco non è disponibile qui: la ricerca si apre in Remote Desktop Manager.") })));
    }
    listEl.append(h("div", { class: "rdm-actions" },
      h("button", { class: "link-btn", text: t("Cerca in RDM"), onclick: () => void Bridge.rdmFilter(q).catch(fail) }),
      looksLikeHost(q) ? h("button", { class: "link-btn", text: t("Connetti con RDP"), onclick: () => void Bridge.rdmQuick("RDP", q).catch(fail) }) : null,
      looksLikeHost(q) ? h("button", { class: "link-btn", text: "SSH", onclick: () => void Bridge.rdmQuick("SSH", q).catch(fail) }) : null,
      looksLikeHost(q) ? h("button", { class: "link-btn", text: "VNC", onclick: () => void Bridge.rdmQuick("VNC", q).catch(fail) }) : null));
  } else {
    const scope = rdm.localScope;
    if (scope === "all" || scope === "pins") {
      if (cfgPins.length) {
        listEl.append(h("div", { class: "rdm-list-label" }, h("span", { text: t("Preferiti") }), h("em", { text: String(cfgPins.length) })));
        for (const e of cfgPins) listEl.append(localFlatRow(e, "lp"));
      }
    }
    if (scope === "all" || scope === "recents") {
      if (recents.length) {
        listEl.append(h("div", { class: "rdm-list-label" }, h("span", { text: t("Recenti") }), h("em", { text: String(recents.length) })));
        for (const e of recents) listEl.append(localFlatRow(e, "lr"));
      }
    }
    if (scope.startsWith("grp:")) {
      const grp = scope.slice(4);
      const items = folderMap.get(grp) ?? [];
      listEl.append(h("div", { class: "rdm-list-label" }, h("span", { text: grp }), h("em", { text: String(items.length) })));
      for (const e of items) listEl.append(localFlatRow(e, "lg"));
    }
    if (!listEl.childElementCount) {
      listEl.append(h("div", { class: "rdm-empty-state" },
        svg(ICONS.rdmRdp, 24, { stroke: 1.5 }),
        h("b", { text: t("Nessun preferito o recente") }),
        h("span", { text: canList
          ? t("Cerca qui sopra: un nome, un cliente, un IP. Con la stella tieni le connessioni a portata di mano.")
          : t("Cerca qui sopra: la ricerca si apre in Remote Desktop Manager, o connettiti a un IP.") })));
    }
    if (listError) listEl.append(h("div", { class: "notion-note bad", text: listError }));
  }

  center.append(listEl);
  ws.append(rail, center, localDetailPane(rdm.localSel));
}

// ── Main persistent card + Panoramica header ─────────────────────────────────

function ensureShell() {
  if (rdm.el) return;
  const card = h("div", { class: "int-card rdm-card", tabindex: "-1" });
  wireCardKeys(card);
  const topSlot = h("div", { class: "rdm-top-slot" });
  const errSlot = h("div", { class: "rdm-err-slot" });

  const input = h("input", {
    class: "rdm-search-input",
    type: "text",
    spellcheck: "false",
    autocomplete: "off",
    placeholder: t("Cerca connessione, cliente, host o utente…"),
    onpointerdown: (e: Event) => void Bridge.focusWindow(true, e),
    oninput: (e: Event) => { rdm.query = (e.target as HTMLInputElement).value; searchSoon(); },
  }) as HTMLInputElement;

  const kbdHint = h("span", { class: "rdm-search-kbd" },
    h("kbd", { text: "Ctrl+F" }),
    h("kbd", { text: "/" }));

  const searchMeta = h("span", { class: "rdm-search-count", style: "display:none" });

  const clearBtn = h("button", {
    class: "rdm-search-clear",
    title: t("Pulisci ricerca"),
    style: "display:none",
    onclick: (e: Event) => { e.stopPropagation(); clearSearch(); },
  }, svg(ICONS.xmark, 11)) as HTMLButtonElement;

  const searchZone = h("div", { class: "rdm-search-zone" },
    h("span", { class: "rdm-search-ico" }, svg(ICONS.search, 15)),
    input,
    searchMeta,
    kbdHint,
    clearBtn);

  const workspace = h("div", { class: "rdm-workspace" });
  const msg = h("div", { class: "rdm-toast", style: "display:none" });

  card.append(topSlot, errSlot, searchZone, workspace, msg);
  rdm.el = card;
  rdm.topSlot = topSlot;
  rdm.errSlot = errSlot;
  rdm.search = input;
  rdm.clearBtn = clearBtn;
  rdm.kbdHint = kbdHint;
  rdm.searchMeta = searchMeta;
  rdm.workspace = workspace;
  rdm.msg = msg;
}

function renderTopHeader(data: Record<string, unknown>, cloud: { on?: boolean; count?: number; at?: number; error?: string | null }) {
  const topSlot = rdm.topSlot;
  if (!topSlot) return;
  const isCloud = !!cloud.on;
  const count = isCloud ? Number(cloud.count ?? 0) : Number(data.count ?? 0);
  const running = data.running === true;
  const allPins = State.settings.integrationConfig.rdmPins ?? [];
  const allRecs = State.settings.integrationConfig.rdmRecent ?? [];
  const pinCount = allPins.filter((p) => (isCloud ? !!p.vault : !p.vault)).length;
  const recCount = allRecs.filter((r) => (isCloud ? !!r.vault : !r.vault)).length;

  const dvcSum = isCloud ? dvcStateSummary() : null;

  // Status dot + label
  let statusText = t("offline");
  let statusCls = "rdm-status";
  if (rdm.syncing) {
    statusText = t("sincronizzo…");
    statusCls = "rdm-status warn";
  } else if (isCloud) {
    if (cloud.error) {
      statusText = t("errore sincronizzazione");
      statusCls = "rdm-status bad";
    } else if (dvcSum?.warmState === "warming") {
      statusText = t("collegamento…");
      statusCls = "rdm-status warn";
    } else if (dvcSum?.warmState === "ready") {
      statusText = t("connessione pronta");
      statusCls = "rdm-status ok";
    } else if (count > 0) {
      statusText = t("pronta");
      statusCls = "rdm-status ok";
    }
  } else if (running) {
    statusText = t("RDM avviato");
    statusCls = "rdm-status ok";
  } else if (count > 0) {
    statusText = t("elenco pronto");
    statusCls = "rdm-status ok";
  }

  const dsName = typeof data.dataSource === "string" && data.dataSource ? data.dataSource : "";
  const sourceText = isCloud ? (dvcSum?.vaultName || "Devolutions Hub") : dsName;
  const ago = isCloud && cloud.at ? timeAgo(cloud.at * 1000) : "";

  const stat = (num: string, label: string, sub: string, cls: string, onclick?: () => void) =>
    h("button", {
      class: `rdm-stat ${cls}`,
      disabled: onclick ? undefined : "true",
      onclick: onclick ? (e: Event) => { e.stopPropagation(); onclick(); } : undefined,
    },
    h("b", { text: num }),
    h("span", { text: label }),
    sub ? h("small", { text: sub }) : null);

  const syncBtn = h("button", {
    class: rdm.syncing ? "rdm-icon-act spinning" : "rdm-icon-act",
    title: t("Sincronizza"),
    disabled: rdm.syncing ? "true" : undefined,
    onclick: async (e: Event) => {
      e.stopPropagation();
      rdm.syncing = true;
      rdm.redraw?.();
      await Bridge.refreshIntegration(RDM);
      rdm.syncing = false;
      dvcResetCache();
      rdm.redraw?.();
    },
  }, svg(ICONS.refresh, 14, { stroke: 1.8 })) as HTMLButtonElement;

  const settingsBtn = h("button", {
    class: "rdm-icon-act",
    title: t("Impostazioni…"),
    onclick: (e: Event) => { e.stopPropagation(); rdm.openSettings(); },
  }, svg(ICONS.sliders, 14));

  // Linked customer chips in header (discrete, never a full extra bar)
  const tieChips = dvcSum && dvcSum.inFolder
    ? h("span", { class: "rdm-head-ties" },
      ...dvcSum.tied.map((name) => h("span", { class: "rdm-head-chip" },
        h("span", { text: name }),
        h("button", { title: t("Scollega"), onclick: (ev: Event) => { ev.stopPropagation(); dvcSum.untie(name); } }, svg(ICONS.xmark, 9)))),
      h("button", {
        class: "rdm-head-tie-add",
        title: t("Collega questa cartella a un cliente di Zammad o 3CX"),
        onclick: (ev: Event) => { ev.stopPropagation(); dvcToggleTieInput(); },
      }, h("span", { text: dvcSum.tied.length ? "+" : t("+ Cliente") })))
    : null;

  const titleRow = h("div", { class: "rdm-title-row" },
    brandOrDot(RDM, COLOR, 7),
    h("b", { text: isCloud ? "Devolutions Cloud" : "Remote Desktop Manager" }),
    tieChips);

  const top = h("div", { class: "rdm-dash-top" },
    h("div", { class: "rdm-dash-title" },
      h("span", { class: "rdm-kicker", text: isCloud ? "DEVOLUTIONS CLOUD" : "REMOTE DESKTOP MANAGER" }),
      titleRow,
      h("div", { class: "rdm-status-row" },
        h("span", { class: statusCls }, h("i", { class: "rdm-status-dot" }), h("span", { text: statusText })),
        sourceText ? h("span", { class: "rdm-source-name", text: `· ${sourceText}` }) : null)),
    h("div", { class: "rdm-stats" },
      stat(String(count), isCloud ? t("voci") : t("connessioni"), "", "accent", () => {
        if (isCloud) dvcSetFilter("browse");
        else { rdm.localScope = "all"; rdm.redraw?.(); }
      }),
      stat(String(pinCount), t("preferiti"), "", pinCount ? "warn" : "", () => {
        if (isCloud) dvcSetFilter("pins");
        else { rdm.localScope = "pins"; rdm.redraw?.(); }
      }),
      stat(String(recCount), t("recenti"), "", "", () => {
        if (isCloud) dvcSetFilter("recents");
        else { rdm.localScope = "recents"; rdm.redraw?.(); }
      }),
      ago ? stat(ago, t("aggiornato"), "", "muted") : null),
    h("div", { class: "rdm-head-icons" }, syncBtn, settingsBtn));

  topSlot.replaceChildren(top);
}

export function rdmCard(openSettings: () => void): HTMLElement {
  rdm.openSettings = openSettings;
  ensureShell();
  const card = rdm.el!;
  const errSlot = rdm.errSlot!;
  const ws = rdm.workspace!;
  const search = rdm.search!;

  const data = (State.integrations[RDM]?.data ?? {}) as Record<string, unknown>;
  const cloud = (data.cloud ?? {}) as { on?: boolean; count?: number; at?: number; error?: string | null };
  const isCloud = !!cloud.on;
  const count = isCloud ? Number(cloud.count ?? 0) : Number(data.count ?? 0);
  const listError = typeof data.listError === "string" ? data.listError : "";
  const canList = count > 0;

  if (isCloud && cloud.at && cloud.at !== rdm.lastCloudAt) {
    rdm.lastCloudAt = cloud.at;
    dvcResetCache();
  }

  card.classList.toggle("rdm-cloud", isCloud);
  if (search.value !== rdm.query) search.value = rdm.query;
  syncSearchChrome();

  if (isCloud && cloud.error) errSlot.replaceChildren(h("div", { class: "notion-note bad", text: cloud.error }));
  else clear(errSlot);

  const renderAll = () => {
    const d = (State.integrations[RDM]?.data ?? {}) as Record<string, unknown>;
    const cl = (d.cloud ?? {}) as { on?: boolean; count?: number; at?: number; error?: string | null };
    const cloudNow = !!cl.on;
    card.classList.toggle("rdm-cloud", cloudNow);
    renderTopHeader(d, cl);
    if (cloudNow) {
      dvcMount(ws, () => renderTopHeader(d, cl));
      if (rdm.query.trim()) dvcSetSearch(rdm.query.trim(), rdm.cloudFound, rdm.searching, clearSearch);
    } else {
      renderLocalWorkspace(ws, canList, listError);
    }
  };

  rdm.redraw = renderAll;
  renderAll();
  focusSearch();
  return card;
}
