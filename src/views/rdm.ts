// Remote Desktop Manager's card (src-tauri/src/rdm.rs): search the user's
// connections and open them in RDM, edit them there, copy the host, keep
// some at hand; the recent ones. Without the list (no PowerShell 7 or no
// module) the search opens inside RDM. Other cards and the menu on the
// selected text come here with `rdmLookFor` (a caller, a ticket's company,
// an IP). What is being typed lives outside the card, rebuilt at each update.

import { h, svg, clear, brandOrDot } from "./dom";
import { ICONS } from "./icons";
import { State } from "../core/state";
import { Bridge, type DvcItem, type RdmEntry } from "../core/bridge";
import { t } from "../core/i18n";
import { Sound } from "../core/sound";
import { dvcFolderFor, dvcGoTo, dvcShowEntry, dvcView } from "./dvc";

export const RDM = "integration_rdm";
const COLOR = "#E8542A";

const rdm = {
  query: "",
  found: [] as RdmEntry[],
  /** With Devolutions Cloud: its folders and entries matching (dvc.rs search). */
  cloudFound: [] as DvcItem[],
  timer: 0,
  search: null as HTMLInputElement | null,
  note: "",
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

function searchSoon(now = false) {
  window.clearTimeout(rdm.timer);
  const q = rdm.query.trim();
  if (!q) {
    rdm.found = [];
    rdm.cloudFound = [];
    rdm.redraw?.();
    return;
  }
  rdm.timer = window.setTimeout(async () => {
    // With the cloud: every folder and entry of its vaults, opened here in the card.
    if (cloudOn()) {
      const found = (await Bridge.dvcSearch(q, 40)) ?? [];
      if (rdm.query.trim() !== q) return;
      rdm.cloudFound = found;
      rdm.found = [];
    } else {
      const found = await Bridge.rdmSearch(q, 12);
      if (rdm.query.trim() !== q) return;
      rdm.found = found;
    }
    rdm.redraw?.();
  }, now ? 0 : 120);
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

/** The card, focused, with these words in its search (a call, a ticket, the selection). */
export function rdmLookFor(query: string) {
  // A customer tied to a cloud folder (dvc.ts): that folder, opened.
  const tied = cloudOn() ? dvcFolderFor(query) : null;
  if (tied) {
    rdm.query = "";
    if (rdm.search) rdm.search.value = "";
    dvcGoTo(tied.vault, tied.path);
    rdm.redraw?.();
    State.setFocus(RDM);
    State.notify();
    return;
  }
  rdm.query = query.trim();
  if (rdm.search) rdm.search.value = rdm.query;
  searchSoon(true);
  State.setFocus(RDM);
  State.notify();
}

/** A cloud entry found in the search field: the card, its folder, its pane open. */
export function rdmShowEntry(e: DvcItem) {
  rdm.query = "";
  rdm.cloudFound = [];
  if (rdm.search) rdm.search.value = "";
  if (e.kind === "Group") dvcGoTo(e.vault, dvcFolderPath(e));
  else void dvcShowEntry(e).then(() => rdm.redraw?.());
  rdm.redraw?.();
  State.setFocus(RDM);
  State.notify();
}

/** "RDP", "SSH", "Web"… from RDM's connection type. */
export function kindLabel(kind: string): string {
  const k = kind.toLowerCase();
  if (k.startsWith("rdp")) return "RDP";
  if (k.startsWith("ssh")) return "SSH";
  if (k.startsWith("vnc")) return "VNC";
  if (k.startsWith("web")) return "Web";
  if (k.includes("teamviewer")) return "TV";
  if (k.includes("anydesk")) return "AnyDesk";
  if (k.includes("powershell")) return "PS";
  if (k.includes("ftp")) return "FTP";
  return kind.replace(/([a-z])([A-Z]).*/, "$1").slice(0, 8);
}

/** The last folder of the path ("Clienti\\Rossi Srl" → "Rossi Srl"). */
function folder(group: string): string {
  const parts = group.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export function rdmCard(openSettings: () => void): HTMLElement {
  const cfg = State.settings.integrationConfig;
  const data = (State.integrations[RDM]?.data ?? {}) as Record<string, unknown>;
  // Devolutions Cloud on (Application identity): only the cloud, never the
  // module's list of the old way (rdm.rs refresh, asked by Edoardo on 4 Nov 2026).
  const cloud = (data.cloud ?? {}) as { on?: boolean; count?: number; error?: string | null };
  const count = cloud.on ? Number(cloud.count ?? 0) : Number(data.count ?? 0);
  const listError = typeof data.listError === "string" ? data.listError : "";
  // The cloud's connections are searched too (rdm.rs with_cloud).
  const canList = count > 0;

  const body = h("div", { class: "notion-body" });
  const msg = h("div", { class: "notion-note" });
  const say = (text: string) => { msg.textContent = text; msg.style.display = text ? "" : "none"; };
  const fail = (e: unknown) => say(String(e).replace(/^Error:\s*/, ""));

  const open = (e: RdmEntry) => {
    void Bridge.rdmOpen(e).then(() => Sound.play("blip")).catch(fail);
  };
  const pinned = (e: RdmEntry) => (cfg.rdmPins ?? []).some((p) => p.id === e.id);
  const togglePin = (e: RdmEntry) => {
    const pins = cfg.rdmPins ?? [];
    cfg.rdmPins = pinned(e) ? pins.filter((p) => p.id !== e.id) : [...pins, e].slice(0, 12);
    void Bridge.saveSettings(State.settings);
    rdm.redraw?.();
  };

  const tool = (icon: string, title: string, run: () => void, on = false) =>
    h("button", { class: on ? "clip-btn on" : "clip-btn", title, style: `--c:${COLOR}`,
      onclick: (ev: Event) => { ev.stopPropagation(); run(); } }, svg(icon, 12));

  const row = (e: RdmEntry) => h("div", { class: "int-page rdm-row", role: "button",
    title: [e.group, e.host].filter(Boolean).join(" · ") || e.name, onclick: () => open(e) },
  h("span", { class: "rdm-kind", text: kindLabel(e.kind) }),
  h("span", { class: "int-name", text: e.name }),
  folder(e.group) ? h("span", { class: "int-ago", text: folder(e.group) }) : null,
  h("span", { class: "notion-tools" },
    tool(ICONS.sliders, t("Modifica in RDM"), () => void Bridge.rdmEdit(e.id).catch(fail)),
    e.host ? tool(ICONS.copy, t("Copia l'indirizzo"), () => void navigator.clipboard.writeText(e.host).then(() => say(t("Copiato: {h}", { h: e.host })), fail)) : null,
    tool(ICONS.pin, pinned(e) ? t("Togli dalla card") : t("Tieni nella card"), () => togglePin(e), pinned(e))));

  // A folder or an entry of the cloud found: its folder in the card, the entry's pane open.
  const cloudRow = (e: DvcItem) => {
    const folder = e.kind === "Group";
    const where = folder ? e.folder : e.folder.split(/[\\/]/).slice(-2).join(" › ");
    const mark = folder ? "📁" : e.cred === "PasswordList" ? "📋" : e.kind.startsWith("Credential") ? "🔑" : "";
    return h("div", { class: "int-page rdm-row", role: "button", title: [e.folder, e.host].filter(Boolean).join(" · ") || e.name,
      onclick: () => rdmShowEntry(e) },
    mark ? h("span", { class: "dvc-icon", text: mark }) : h("span", { class: "rdm-kind", text: kindLabel(e.kind) }),
    h("span", { class: "int-name", text: e.name }),
    e.user && !folder ? h("span", { class: "int-ago", text: e.user }) : null,
    where ? h("span", { class: "int-ago", text: where }) : null);
  };

  const section = (label: string, extra?: Node | null) => h("div", { class: "notion-section" }, h("span", { text: label }), extra ?? null);

  const search = rdm.search ?? (rdm.search = h("input", {
    class: "nc-input notion-search", placeholder: t("Cerca una connessione, un cliente, un IP…"), spellcheck: "false",
    onpointerdown: () => void Bridge.focusWindow(true),
    oninput: (e: Event) => { rdm.query = (e.target as HTMLInputElement).value; searchSoon(); },
    onkeydown: (e: Event) => {
      const k = e as KeyboardEvent;
      if (k.key === "Escape" && rdm.query) {
        k.stopPropagation();
        rdm.query = "";
        (k.target as HTMLInputElement).value = "";
        searchSoon(true);
      } else if (k.key === "Enter") {
        // The cloud: the first found, in the card.
        if (cloudOn()) {
          const top = rdm.cloudFound[0];
          if (top) rdmShowEntry(top);
          return;
        }
        const first = rdm.found[0];
        if (first) open(first);
        else if (rdm.query.trim()) void Bridge.rdmFilter(rdm.query).catch(fail);
      }
    },
  }) as HTMLInputElement);
  if (search.value !== rdm.query) search.value = rdm.query;

  const draw = () => {
    clear(body);
    say("");
    const q = rdm.query.trim();
    if (q && cloudOn()) {
      // The cloud: folders and entries, opened here in the card (not in RDM).
      for (const e of rdm.cloudFound) body.append(cloudRow(e));
      if (!rdm.cloudFound.length) body.append(h("div", { class: "notion-note", text: t("Niente nel cloud con queste parole.") }));
      return;
    }
    if (q) {
      for (const e of rdm.found) body.append(row(e));
      const actions = h("div", { class: "rdm-actions" },
        h("button", { class: "link-btn", style: `color:${COLOR}d9`, text: t("Cerca in RDM"), onclick: () => void Bridge.rdmFilter(q).catch(fail) }),
        looksLikeHost(q) ? h("button", { class: "link-btn", style: `color:${COLOR}d9`, text: t("Connetti con RDP"), onclick: () => void Bridge.rdmQuick("RDP", q).catch(fail) }) : null,
        looksLikeHost(q) ? h("button", { class: "link-btn", style: `color:${COLOR}d9`, text: "SSH", onclick: () => void Bridge.rdmQuick("SSH", q).catch(fail) }) : null);
      if (!rdm.found.length) {
        body.append(h("div", { class: "notion-note", text: canList ? t("Nessuna connessione trovata.") : t("L'elenco non è disponibile qui: la ricerca si apre in Remote Desktop Manager.") }));
      }
      body.append(actions);
      return;
    }
    const pins = cfg.rdmPins ?? [];
    if (pins.length) {
      body.append(section(t("Fissate")));
      for (const e of pins) body.append(row(e));
    }
    const recent = (cfg.rdmRecent ?? []).filter((e) => !pins.some((p) => p.id === e.id)).slice(0, 5);
    if (recent.length) {
      body.append(section(t("Recenti")));
      for (const e of recent) body.append(row(e));
    }
    if (!pins.length && !recent.length) {
      body.append(h("div", { class: "notion-note", text: canList
        ? t("Cerca qui sopra: un nome, un cliente, un IP. Con la puntina una connessione resta nella card.")
        : t("Cerca qui sopra: la ricerca si apre in Remote Desktop Manager, o connettiti a un IP.") }));
    }
    if (listError) body.append(h("div", { class: "notion-note bad", text: listError }));
  };

  const sub = cloud.on
    ? t("{n} voci", { n: count }) + " · Devolutions Cloud"
    : canList
    ? t("{n} connessioni", { n: count }) + (typeof data.dataSource === "string" && data.dataSource ? ` · ${data.dataSource}` : "")
    : data.exe || data.protocol ? t("Ricerca in RDM") : t("RDM non trovato");
  // The list is the one saved at the last sync: it changes only on request.
  const running = data.running === true;
  const sync = h("button", { class: "link-btn", style: "color:#8e939c", text: t("Sincronizza"), title: running ? t("RDM è avviato") : t("RDM non è avviato: la sincronizzazione legge comunque l'origine dati") }) as HTMLButtonElement;
  sync.addEventListener("click", async () => {
    sync.disabled = true;
    sync.textContent = t("Sincronizzo…");
    await Bridge.refreshIntegration("integration_rdm");
    sync.disabled = false;
    sync.textContent = t("Sincronizza");
  });
  const head = h("div", { class: "int-head" }, brandOrDot(RDM, COLOR, 7), h("b", { text: "Remote Desktop Manager" }), h("span", { text: sub }),
    h("span", { class: "rdm-state", style: `color:${running ? "#22c55e" : "#8e939c"}`, title: running ? t("RDM è avviato") : t("RDM non è avviato"), text: "●" }),
    sync,
    h("button", { class: "link-btn", style: "color:#8e939c", text: t("Impostazioni…"), onclick: openSettings }));
  const cloudError = cloud.on && cloud.error ? h("div", { class: "notion-note bad", text: cloud.error }) : null;
  const card = h("div", { class: cloud.on ? "int-card notion-card rdm-cloud" : "int-card notion-card" }, head, cloudError, search);
  // With the cloud, the search's results while something is typed, its
  // folders otherwise; swapped in place (the card is not rebuilt for it).
  const place = () => {
    const showCloud = cloud.on && !rdm.query.trim();
    const view = cloud.on ? dvcView() : null;
    if (showCloud && view) {
      body.remove();
      if (view.parentElement !== card) card.insertBefore(view, msg.parentElement === card ? msg : null);
    } else {
      view?.remove();
      if (body.parentElement !== card) card.insertBefore(body, msg.parentElement === card ? msg : null);
    }
    if (msg.parentElement !== card) card.append(msg);
  };
  rdm.redraw = () => { place(); draw(); };
  rdm.redraw();
  if (rdm.query) window.setTimeout(() => { if (search.isConnected) search.focus(); }, 0);
  return card;
}
