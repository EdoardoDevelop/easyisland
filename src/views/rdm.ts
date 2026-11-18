// Remote Desktop Manager & Devolutions Cloud card (src-tauri/src/rdm.rs,
// src-tauri/src/dvc.rs): persistent full-height workspace (also in detached
// windows), autofocus search, inline SVG type icons, clear 2-line entry cards
// with host/user/folder and quick actions, collapsible folder/client groups,
// favorites (integrationConfig.rdmPins) and recents (rdmRecent, max 8), and
// card-scoped keyboard navigation (↑↓, Invio, Esc, Alt+U, Alt+P, Alt+O).

import { h, svg, clear, brandOrDot, headActions } from "./dom";
import { ICONS } from "./icons";
import { State, type RdmRef } from "../core/state";
import { Bridge, type DvcItem, type RdmEntry } from "../core/bridge";
import { t } from "../core/i18n";
import { Sound } from "../core/sound";
import { updatedAgo } from "./integrations";
import { dvcFolderFor, dvcGoTo, dvcHandleEscape, dvcResetCache, dvcSetActiveKey, dvcSetSearch, dvcShowEntry, dvcView } from "./dvc";

export const RDM = "integration_rdm";
const COLOR = "#E8542A";

export interface KindMeta {
  label: string;
  tone: "rdp" | "ssh" | "web" | "vnc" | "vpn" | "ftp" | "cred" | "list" | "folder" | "other";
  icon: string;
}

const rdm = {
  el: null as HTMLElement | null,
  headSlot: null as HTMLElement | null,
  errSlot: null as HTMLElement | null,
  searchRow: null as HTMLElement | null,
  search: null as HTMLInputElement | null,
  clearBtn: null as HTMLButtonElement | null,
  body: null as HTMLElement | null,
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
  collapsedGroups: new Set<string>(),
  showAllRecents: false,
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

/** Key used by views.ts so typing or filling a form never detaches the card DOM. */
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

/** "RDP", "SSH", "Web", "VPN"… + tone + inline SVG icon from RDM's connection type. */
export function kindInfo(kind: string, cred = ""): KindMeta {
  if (kind === "Group") return { label: t("Cartella"), tone: "folder", icon: ICONS.rdmFolder };
  if (cred === "PasswordList") return { label: t("Lista"), tone: "list", icon: ICONS.rdmList };
  if (kind.startsWith("Credential")) return { label: t("Credenziale"), tone: "cred", icon: ICONS.rdmKey };
  const k = kind.toLowerCase();
  if (k.startsWith("rdp")) return { label: "RDP", tone: "rdp", icon: ICONS.rdmRdp };
  if (k.startsWith("ssh") || k.includes("putty") || k.includes("terminal") || k.includes("telnet")) {
    return { label: "SSH", tone: "ssh", icon: ICONS.lineTerminal };
  }
  if (k.startsWith("powershell")) return { label: "PS", tone: "ssh", icon: ICONS.lineTerminal };
  if (k.startsWith("web") || k.includes("http") || k.includes("browser")) return { label: "Web", tone: "web", icon: ICONS.rdmWeb };
  if (k.includes("vpn") || k.includes("wireguard") || k.includes("openvpn") || k.includes("forti") || k.includes("cisco")) {
    return { label: "VPN", tone: "vpn", icon: ICONS.rdmVpn };
  }
  if (k.startsWith("vnc")) return { label: "VNC", tone: "vnc", icon: ICONS.rdmVnc };
  if (k.includes("teamviewer")) return { label: "TV", tone: "vnc", icon: ICONS.rdmVnc };
  if (k.includes("anydesk")) return { label: "AnyDesk", tone: "vnc", icon: ICONS.rdmVnc };
  if (k.includes("sftp")) return { label: "SFTP", tone: "ftp", icon: ICONS.rdmFtp };
  if (k.includes("ftp") || k.includes("scp")) return { label: "FTP", tone: "ftp", icon: ICONS.rdmFtp };
  const short = kind.replace(/([a-z])([A-Z]).*/, "$1").slice(0, 8) || "RDM";
  return { label: short, tone: "other", icon: ICONS.rdmRdp };
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

// ── Shared UI primitives ─────────────────────────────────────────────────────

export function rdmIconChip(kind: string, cred = ""): HTMLElement {
  const meta = kindInfo(kind, cred);
  return h("span", { class: `rdm-icon-chip tone-${meta.tone}`, "aria-hidden": "true" },
    svg(meta.icon, 14, { stroke: 1.7 }));
}

export function rdmKindPill(kind: string, cred = ""): HTMLElement {
  const meta = kindInfo(kind, cred);
  return h("span", { class: `rdm-kind tone-${meta.tone}`, text: meta.label });
}

export function rdmActionBtn(
  label: string | null,
  icon: string | null,
  title: string,
  onClick: () => void,
  opts: { primary?: boolean; on?: boolean; act?: string } = {},
): HTMLElement {
  const cls = [
    "rdm-act-btn",
    opts.primary ? "primary" : "",
    opts.on ? "on" : "",
    !label ? "icon-only" : "",
  ].filter(Boolean).join(" ");
  return h("button", {
    class: cls,
    title,
    "data-act": opts.act,
    onclick: (ev: Event) => { ev.stopPropagation(); onClick(); },
  },
  icon ? svg(icon, 12, { stroke: icon === ICONS.star || icon === ICONS.sliders || icon === ICONS.copy ? undefined : 1.8 }) : null,
  label ? h("span", { text: label }) : null);
}

export function rdmSectionHead(
  _id: string,
  title: string,
  count: number,
  icon: string,
  open: boolean,
  onToggle: () => void,
): HTMLElement {
  return h("button", {
    class: open ? "rdm-group-head open" : "rdm-group-head",
    onclick: (e: Event) => { e.stopPropagation(); onToggle(); },
  },
  svg(open ? ICONS.chevronDown : ICONS.chevronRight, 11, { stroke: 2 }),
  svg(icon, 12, { stroke: icon === ICONS.star ? undefined : 1.7 }),
  h("span", { class: "rdm-group-title", text: title }),
  h("span", { class: "rdm-count-pill", text: String(count) }));
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

function searchSoon(now = false) {
  window.clearTimeout(rdm.timer);
  const q = rdm.query.trim();
  if (rdm.clearBtn) rdm.clearBtn.style.display = q ? "" : "none";
  if (!q) {
    rdm.found = [];
    rdm.cloudFound = [];
    rdm.searching = false;
    if (cloudOn()) dvcSetSearch("", [], false);
    rdm.redraw?.();
    return;
  }
  rdm.searching = true;
  if (cloudOn()) dvcSetSearch(q, rdm.cloudFound, true, clearSearch);
  else rdm.redraw?.();

  rdm.timer = window.setTimeout(async () => {
    if (cloudOn()) {
      const found = (await Bridge.dvcSearch(q, 100)) ?? [];
      if (rdm.query.trim() !== q) return;
      rdm.cloudFound = found;
      rdm.found = [];
      rdm.searching = false;
      dvcSetSearch(q, found, false, clearSearch);
    } else {
      const found = (await Bridge.rdmSearch(q, 50)) ?? [];
      if (rdm.query.trim() !== q) return;
      rdm.found = found;
      rdm.searching = false;
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

function focusSearch() {
  requestAnimationFrame(() => {
    const input = rdm.search;
    const card = rdm.el;
    if (!input || !card || !input.isConnected) return;
    const active = document.activeElement;
    if (active && card.contains(active) && active !== document.body && active.closest(".dvc-form, .dvc-tie")) return;
    input.focus();
  });
}

/** The card, focused, with these words in its search (a call, a ticket, the selection). */
export function rdmLookFor(query: string) {
  const tied = cloudOn() ? dvcFolderFor(query) : null;
  if (tied) {
    rdm.query = "";
    if (rdm.search) rdm.search.value = "";
    if (rdm.clearBtn) rdm.clearBtn.style.display = "none";
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
  if (rdm.clearBtn) rdm.clearBtn.style.display = "none";
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
    ?? card.querySelector<HTMLElement>(".dvc-pane")
    ?? card.querySelector<HTMLElement>(".rdm-nav-item");
}

function wireCardKeys(card: HTMLElement) {
  card.addEventListener("keydown", (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const inForm = !!target?.closest(".dvc-form, .dvc-tie, select");

    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const k = e.key.toLowerCase();
      const act = k === "u" ? "copy-user" : k === "p" ? "copy-pw" : k === "o" ? "open" : "";
      if (act) {
        const scope = currentActionScope();
        const btn = scope?.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)
          ?? card.querySelector<HTMLButtonElement>(`.dvc-pane [data-act="${act}"]`);
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
      }
    }
  });
}

// ── Local RDM card rendering ─────────────────────────────────────────────────

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

function localRow(e: RdmEntry, opts: { showFolder?: boolean; prefix?: string } = {}): HTMLElement {
  const navKey = `${opts.prefix ?? "loc"}:${e.id}`;
  const isActive = rdm.activeKey === navKey;
  const pinned = isPinnedRef(e.id, "");
  const userText = (e.user ?? "").trim();
  const folderText = opts.showFolder ? rdmFolderTail(e.group, 2) : "";

  const open = () => {
    recordRdmRecent(e);
    void Bridge.rdmOpen(e)
      .then(() => { Sound.play("blip"); sayLocal(t("Aperto «{n}» in RDM.", { n: e.name })); })
      .catch((err) => { Sound.play("error"); sayLocal(String(err).replace(/^Error:\s*/, "")); });
  };

  return h("div", {
    class: `rdm-row rdm-entry-card rdm-nav-item${isActive ? " is-active" : ""}`,
    role: "button",
    tabindex: "-1",
    "data-nav-key": navKey,
    title: [e.group, e.host, userText].filter(Boolean).join(" · ") || e.name,
    onclick: () => { rdm.activeKey = navKey; open(); },
  },
  h("div", { class: "rdm-entry-top" },
    rdmIconChip(e.kind),
    rdmKindPill(e.kind),
    h("span", { class: "rdm-entry-name", text: e.name }),
    h("div", { class: "rdm-row-actions" },
      rdmActionBtn(t("Apri"), ICONS.arrowUpRight, t("Apri in RDM (Alt+O)"), open, { primary: true, act: "open" }),
      userText ? rdmActionBtn(null, ICONS.user, t("Copia utente (Alt+U)"), () => {
        recordRdmRecent(e);
        void rdmCopyText(userText, t("Utente copiato: {u}", { u: userText }), sayLocal);
      }, { act: "copy-user" }) : null,
      e.host ? rdmActionBtn(null, ICONS.copy, t("Copia indirizzo"), () => {
        recordRdmRecent(e);
        void rdmCopyText(e.host, t("Copiato: {h}", { h: e.host }), sayLocal);
      }) : null,
      rdmActionBtn(null, ICONS.sliders, t("Modifica in RDM"), () => void Bridge.rdmEdit(e.id).catch((err) => sayLocal(String(err).replace(/^Error:\s*/, "")))),
      rdmActionBtn(null, ICONS.star, pinned ? t("Togli dai preferiti") : t("Aggiungi ai preferiti"), () => {
        togglePinRef({ id: e.id, name: e.name, group: e.group, host: e.host, kind: e.kind, user: e.user });
        rdm.redraw?.();
      }, { on: pinned }))),
  (e.host || userText || folderText)
    ? h("div", { class: "rdm-entry-meta" },
      e.host ? h("span", { class: "rdm-meta-chip mono", text: e.host }) : null,
      userText ? h("span", { class: "rdm-meta-item" }, svg(ICONS.user, 11, { stroke: 1.7 }), h("span", { text: userText })) : null,
      folderText ? h("span", { class: "rdm-meta-folder" }, svg(ICONS.rdmFolder, 11, { stroke: 1.7 }), h("span", { text: folderText })) : null)
    : null);
}

function drawLocalBody(body: HTMLElement, canList: boolean, listError: string) {
  clear(body);
  const q = rdm.query.trim();
  const fail = (err: unknown) => sayLocal(String(err).replace(/^Error:\s*/, ""));

  if (q) {
    if (rdm.searching && !rdm.found.length) {
      body.append(h("div", { class: "rdm-empty-state" }, h("span", { text: t("Cerco connessioni…") })));
    } else if (rdm.found.length) {
      const groups = new Map<string, RdmEntry[]>();
      for (const e of rdm.found) {
        const key = e.group || t("Generale");
        const list = groups.get(key) ?? [];
        list.push(e);
        groups.set(key, list);
      }
      for (const [grp, items] of groups) {
        const secKey = `loc:${grp.toLowerCase()}`;
        const open = !rdm.collapsedGroups.has(secKey);
        body.append(rdmSectionHead(secKey, rdmFolderTail(grp, 3) || grp, items.length, ICONS.rdmFolder, open, () => {
          if (open) rdm.collapsedGroups.add(secKey); else rdm.collapsedGroups.delete(secKey);
          rdm.redraw?.();
        }));
        if (open) {
          for (const e of items) body.append(localRow(e, { showFolder: false, prefix: "ls" }));
        }
      }
    } else {
      body.append(h("div", { class: "rdm-empty-state" },
        svg(ICONS.search, 22, { stroke: 1.5 }),
        h("b", { text: canList ? t("Nessuna connessione trovata.") : t("L'elenco non è disponibile qui: la ricerca si apre in Remote Desktop Manager.") })));
    }

    body.append(h("div", { class: "rdm-actions" },
      h("button", { class: "link-btn", text: t("Cerca in RDM"), onclick: () => void Bridge.rdmFilter(q).catch(fail) }),
      looksLikeHost(q) ? h("button", { class: "link-btn", text: t("Connetti con RDP"), onclick: () => void Bridge.rdmQuick("RDP", q).catch(fail) }) : null,
      looksLikeHost(q) ? h("button", { class: "link-btn", text: "SSH", onclick: () => void Bridge.rdmQuick("SSH", q).catch(fail) }) : null,
      looksLikeHost(q) ? h("button", { class: "link-btn", text: "VNC", onclick: () => void Bridge.rdmQuick("VNC", q).catch(fail) }) : null));
    return;
  }

  const cfgPins = (State.settings.integrationConfig.rdmPins ?? []).filter((p) => !p.vault);
  const pinIds = new Set<string>(cfgPins.map((p) => p.id));
  if (cfgPins.length) {
    const open = !rdm.collapsedGroups.has("loc:pins");
    body.append(rdmSectionHead("loc:pins", t("Preferiti"), cfgPins.length, ICONS.star, open, () => {
      if (open) rdm.collapsedGroups.add("loc:pins"); else rdm.collapsedGroups.delete("loc:pins");
      rdm.redraw?.();
    }));
    if (open) for (const e of cfgPins) body.append(localRow(e, { showFolder: true, prefix: "lp" }));
  }

  const recent = getRdmRecents().filter((e) => !pinIds.has(e.id));
  if (recent.length) {
    const open = !rdm.collapsedGroups.has("loc:rec");
    body.append(rdmSectionHead("loc:rec", t("Recenti"), recent.length, ICONS.history, open, () => {
      if (open) rdm.collapsedGroups.add("loc:rec"); else rdm.collapsedGroups.delete("loc:rec");
      rdm.redraw?.();
    }));
    if (open) {
      const shown = rdm.showAllRecents ? recent : recent.slice(0, 6);
      for (const e of shown) body.append(localRow(e, { showFolder: true, prefix: "lr" }));
      if (recent.length > 6) {
        body.append(h("div", { class: "rdm-more-row" },
          h("button", { class: "link-btn", text: rdm.showAllRecents ? t("Mostra meno") : t("Mostra tutti ({n})", { n: recent.length }),
            onclick: () => { rdm.showAllRecents = !rdm.showAllRecents; rdm.redraw?.(); } })));
      }
    }
  }

  if (!cfgPins.length && !recent.length) {
    body.append(h("div", { class: "rdm-empty-state" },
      svg(ICONS.rdmRdp, 24, { stroke: 1.5 }),
      h("b", { text: t("Nessun preferito o recente") }),
      h("span", { text: canList
        ? t("Cerca qui sopra: un nome, un cliente, un IP. Con la stella tieni le connessioni a portata di mano.")
        : t("Cerca qui sopra: la ricerca si apre in Remote Desktop Manager, o connettiti a un IP.") })));
  }
  if (listError) body.append(h("div", { class: "notion-note bad", text: listError }));
}

// ── Main card (persistent root) ──────────────────────────────────────────────

function ensureShell() {
  if (rdm.el) return;
  const card = h("div", { class: "int-card rdm-card", tabindex: "-1" });
  wireCardKeys(card);
  const headSlot = h("div", { class: "rdm-head-slot" });
  const errSlot = h("div", { class: "rdm-err-slot" });

  const input = h("input", {
    class: "nc-input rdm-search-input",
    type: "text",
    spellcheck: "false",
    autocomplete: "off",
    placeholder: t("Cerca connessione, cliente, host o utente…"),
    onpointerdown: (e: Event) => void Bridge.focusWindow(true, e),
    oninput: (e: Event) => { rdm.query = (e.target as HTMLInputElement).value; searchSoon(); },
  }) as HTMLInputElement;

  const clearBtn = h("button", {
    class: "rdm-search-clear",
    title: t("Pulisci ricerca"),
    style: "display:none",
    onclick: (e: Event) => { e.stopPropagation(); clearSearch(); },
  }, svg(ICONS.xmark, 11)) as HTMLButtonElement;

  const searchRow = h("div", { class: "rdm-search-wrap" },
    h("span", { class: "rdm-search-ico" }, svg(ICONS.search, 13)),
    input,
    clearBtn);

  const body = h("div", { class: "rdm-body" });
  const msg = h("div", { class: "rdm-toast", style: "display:none" });

  card.append(headSlot, errSlot, searchRow, body, msg);
  rdm.el = card;
  rdm.headSlot = headSlot;
  rdm.errSlot = errSlot;
  rdm.searchRow = searchRow;
  rdm.search = input;
  rdm.clearBtn = clearBtn;
  rdm.body = body;
  rdm.msg = msg;
}

export function rdmCard(openSettings: () => void): HTMLElement {
  rdm.openSettings = openSettings;
  ensureShell();
  const card = rdm.el!;
  const headSlot = rdm.headSlot!;
  const errSlot = rdm.errSlot!;
  const body = rdm.body!;
  const search = rdm.search!;

  const data = (State.integrations[RDM]?.data ?? {}) as Record<string, unknown>;
  const cloud = (data.cloud ?? {}) as { on?: boolean; count?: number; at?: number; error?: string | null };
  const isCloud = !!cloud.on;
  const count = isCloud ? Number(cloud.count ?? 0) : Number(data.count ?? 0);
  const listError = typeof data.listError === "string" ? data.listError : "";
  const canList = count > 0;
  const running = data.running === true;

  if (isCloud && cloud.at && cloud.at !== rdm.lastCloudAt) {
    rdm.lastCloudAt = cloud.at;
    dvcResetCache();
  }

  card.classList.toggle("rdm-cloud", isCloud);
  if (search.value !== rdm.query) search.value = rdm.query;
  if (rdm.clearBtn) rdm.clearBtn.style.display = rdm.query.trim() ? "" : "none";

  const sub = isCloud
    ? t("{n} voci", { n: count }) + " · Devolutions Cloud"
    : canList
    ? t("{n} connessioni", { n: count }) + (typeof data.dataSource === "string" && data.dataSource ? ` · ${data.dataSource}` : "")
    : data.exe || data.protocol ? t("Ricerca in RDM") : t("RDM non trovato");

  const sync = h("button", {
    class: "link-btn",
    text: rdm.syncing ? t("Sincronizzo…") : t("Sincronizza"),
    disabled: rdm.syncing ? "true" : undefined,
    title: running ? t("RDM è avviato") : t("RDM non è avviato: la sincronizzazione legge comunque l'origine dati"),
  }) as HTMLButtonElement;
  sync.addEventListener("click", async () => {
    rdm.syncing = true;
    sync.disabled = true;
    sync.textContent = t("Sincronizzo…");
    await Bridge.refreshIntegration(RDM);
    rdm.syncing = false;
    dvcResetCache();
    sync.disabled = false;
    sync.textContent = t("Sincronizza");
  });

  const head = h("div", { class: "int-head rdm-head" },
    brandOrDot(RDM, COLOR, 7),
    h("b", { text: "RDM", title: "Remote Desktop Manager" }),
    h("span", { class: "rdm-sub", text: sub }),
    isCloud && cloud.at ? updatedAgo(cloud.at * 1000) : null,
    h("i", { class: "dot rdm-state", style: `width:6px;height:6px;background:${running ? "#22c55e" : "#8e939c"}`, title: running ? t("RDM è avviato") : t("RDM non è avviato") }),
    headActions(sync, h("button", { class: "link-btn", text: t("Impostazioni…"), onclick: () => rdm.openSettings() })));
  headSlot.replaceChildren(head);

  if (isCloud && cloud.error) errSlot.replaceChildren(h("div", { class: "notion-note bad", text: cloud.error }));
  else clear(errSlot);

  const renderContent = () => {
    const cloudNow = cloudOn();
    card.classList.toggle("rdm-cloud", cloudNow);
    if (cloudNow) {
      const view = dvcView();
      if (body.parentElement === card) body.remove();
      if (view.parentElement !== card) card.insertBefore(view, rdm.msg);
      if (rdm.query.trim()) dvcSetSearch(rdm.query.trim(), rdm.cloudFound, rdm.searching, clearSearch);
    } else {
      card.querySelector(".dvc-view")?.remove();
      if (body.parentElement !== card) card.insertBefore(body, rdm.msg);
      drawLocalBody(body, canList, listError);
    }
  };

  rdm.redraw = renderContent;
  renderContent();
  focusSearch();
  return card;
}
