// The Rete card's tools (src-tauri/src/netconfig.rs): a continuous ping in a
// terminal (gateway, 8.8.8.8 or an address typed here) and a form to set an
// adapter's address and DNS servers. Applying asks Windows for administrator
// rights (its own UAC prompt); EasyIsland never runs elevated.
//
// The overview rebuilds a card whenever the network check reports, so the
// form is one element kept across rebuilds (like the 3CX phone): what the user
// is typing is never lost.

import { h, clear } from "./dom";
import { Bridge, type NetAdapter } from "../core/bridge";
import { t } from "../core/i18n";

const GREEN = "#22C55E";
const RED = "#F4505E";

/** "Ping continuo: Gateway · 8.8.8.8 · [indirizzo] ▶", under the network card. */
export function pingRow(color: string): HTMLElement {
  const note = h("span", { class: "nc-note" });
  const say = (text: string, bad = false) => {
    note.textContent = text;
    note.style.color = bad ? RED : "";
    window.setTimeout(() => { if (note.textContent === text) note.textContent = ""; }, 3500);
  };
  const ping = async (target: string) => {
    if (!target.trim()) { say(t("Scrivi un indirizzo"), true); return; }
    try {
      const to = await Bridge.networkPing(target);
      say(t("Ping continuo verso {a} nel terminale", { a: to ?? target }));
    } catch (e) {
      say(String(e instanceof Error ? e.message : e), true);
    }
  };
  const input = h("input", {
    class: "nc-input nc-ping-input", placeholder: t("altro indirizzo"), spellcheck: "false",
    onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === "Enter") void ping(input.value); },
  }) as HTMLInputElement;
  const chip = (label: string, target: () => string, title: string) =>
    h("button", { class: "nc-chip", style: `--c:${color}`, title, text: label, onclick: () => void ping(target()) });
  return h("div", { class: "nc-ping" },
    h("span", { class: "nc-label", text: t("Ping continuo") }),
    chip(t("Gateway"), () => "gateway", t("Ping continuo verso il gateway della scheda principale")),
    chip("8.8.8.8", () => "8.8.8.8", t("Ping continuo verso 8.8.8.8 (DNS di Google)")),
    input,
    chip(t("Avvia"), () => input.value, t("Ping continuo verso l'indirizzo scritto")),
    note);
}

interface Form {
  index: number;
  dhcp: boolean;
  ip: string;
  mask: string;
  gateway: string;
  dnsAuto: boolean;
  dns1: string;
  dns2: string;
}

let panel: HTMLElement | null = null;

/** The form, built once; `close` goes back to the card. */
export function netConfigCard(color: string, close: () => void): HTMLElement {
  if (panel) {
    closeFn = close;
    return panel;
  }
  closeFn = close;
  let adapters: NetAdapter[] = [];
  const form: Form = { index: 0, dhcp: true, ip: "", mask: "", gateway: "", dnsAuto: true, dns1: "", dns2: "" };

  const select = h("select", { class: "nc-select", onchange: () => pick(Number(select.value)) }) as HTMLSelectElement;
  const now = h("div", { class: "nc-now" });
  const field = (key: "ip" | "mask" | "gateway" | "dns1" | "dns2", placeholder: string) => {
    const el = h("input", { class: "nc-input", placeholder, spellcheck: "false",
      oninput: () => { form[key] = el.value; } }) as HTMLInputElement;
    return el;
  };
  const ip = field("ip", "192.168.1.50");
  const mask = field("mask", "255.255.255.0 / 24");
  const gateway = field("gateway", "192.168.1.1");
  const dns1 = field("dns1", "8.8.8.8");
  const dns2 = field("dns2", "1.1.1.1");

  const seg = (labels: [string, string], on: () => boolean, set: (first: boolean) => void) => {
    const a = h("button", { text: labels[0], onclick: () => { set(true); draw(); } });
    const b = h("button", { text: labels[1], onclick: () => { set(false); draw(); } });
    return { el: h("div", { class: "nc-seg" }, a, b), sync: () => { a.classList.toggle("on", on()); b.classList.toggle("on", !on()); } };
  };
  const addrSeg = seg([t("Automatico (DHCP)"), t("Manuale")], () => form.dhcp, (v) => {
    form.dhcp = v;
    if (!v) form.dnsAuto = false; // a manual address gets no DNS from DHCP
  });
  const dnsSeg = seg([t("Automatici"), t("Manuali")], () => form.dnsAuto, (v) => { if (v && !form.dhcp) return; form.dnsAuto = v; });

  const label = (text: string) => h("span", { class: "nc-label", text });
  const addrGrid = h("div", { class: "nc-grid" },
    label(t("Indirizzo IP")), ip, label(t("Maschera")), mask, label(t("Gateway")), gateway);
  const dnsGrid = h("div", { class: "nc-grid" }, label(t("DNS preferito")), dns1, label(t("DNS alternativo")), dns2);

  const status = h("span", { class: "nc-note" });
  const apply = h("button", { class: "btn primary nc-apply", text: t("Applica"), onclick: () => void submit() }) as HTMLButtonElement;

  function draw() {
    addrSeg.sync();
    dnsSeg.sync();
    addrGrid.style.display = form.dhcp ? "none" : "";
    dnsGrid.style.display = form.dnsAuto ? "none" : "";
    dnsSeg.el.firstElementChild?.toggleAttribute("disabled", !form.dhcp);
    ip.value = form.ip; mask.value = form.mask; gateway.value = form.gateway;
    dns1.value = form.dns1; dns2.value = form.dns2;
  }

  function pick(index: number) {
    const a = adapters.find((x) => x.index === index);
    if (!a) return;
    const first = a.addresses[0];
    Object.assign(form, {
      index: a.index, dhcp: a.dhcp, dnsAuto: a.dnsAuto && a.dhcp,
      ip: first?.ip ?? "", mask: first ? String(first.prefix) : "24", gateway: a.gateway,
      dns1: a.dns[0] ?? "", dns2: a.dns[1] ?? "",
    });
    const addr = a.addresses.map((x) => `${x.ip}/${x.prefix}`).join(", ") || t("nessun indirizzo");
    const parts = [
      a.up ? t("connessa") : t("scollegata"),
      `${addr}${a.dhcp ? " (DHCP)" : ""}`,
      a.gateway ? `${t("gateway")} ${a.gateway}` : "",
      a.dns.length ? `DNS ${a.dns.join(", ")}${a.dnsAuto ? " (DHCP)" : ""}` : "",
    ].filter(Boolean);
    now.textContent = `${t("Ora")}: ${parts.join(" · ")}`;
    status.textContent = "";
    draw();
  }

  async function load() {
    const list = await Bridge.networkAdapters();
    adapters = list ?? [];
    clear(select);
    for (const a of adapters) {
      select.append(h("option", { value: String(a.index), text: a.up ? a.name : `${a.name} (${t("scollegata")})` }));
    }
    if (adapters.length === 0) {
      now.textContent = t("Nessuna scheda di rete da impostare");
      return;
    }
    const keep = adapters.some((a) => a.index === form.index) ? form.index : adapters[0].index;
    select.value = String(keep);
    pick(keep);
  }

  async function submit() {
    apply.disabled = true;
    status.style.color = "";
    status.textContent = t("Windows chiede la conferma da amministratore…");
    try {
      await Bridge.networkApply({
        index: form.index, dhcp: form.dhcp, ip: form.ip, mask: form.mask, gateway: form.gateway,
        dnsAuto: form.dnsAuto, dns: [form.dns1, form.dns2],
      });
      status.style.color = GREEN;
      status.textContent = t("Impostazioni applicate ✓");
      // The new address takes a moment (DHCP); then the card and the form read it again.
      window.setTimeout(() => { void load(); void Bridge.widgetRefresh("integration_network"); }, 2500);
    } catch (e) {
      status.style.color = RED;
      status.textContent = String(e instanceof Error ? e.message : e);
    } finally {
      apply.disabled = false;
    }
  }

  panel = h("div", { class: "int-card nc-card" },
    h("div", { class: "int-head" },
      h("b", { text: t("Rete") }), h("span", { text: t("Impostazioni della scheda") }),
      h("button", { class: "link-btn nc-back", style: `color:${color}d9`, text: `← ${t("Indietro")}`, onclick: () => closeFn() })),
    h("div", { class: "nc-row" }, label(t("Scheda")), select),
    now,
    h("div", { class: "nc-row" }, label(t("Indirizzo")), addrSeg.el),
    addrGrid,
    h("div", { class: "nc-row" }, label("DNS"), dnsSeg.el),
    dnsGrid,
    h("div", { class: "nc-row nc-foot" }, apply, status),
    h("div", { class: "nc-hint", text: t("Serve il permesso di amministratore: Windows lo chiede a ogni modifica.") }));
  void load();
  draw();
  return panel;
}

let closeFn: () => void = () => {};

/** Opening the form again reads the adapters again. */
export function resetNetConfig() {
  panel = null;
}
