// The "Accesso remoto" card (src-tauri/src/remote.rs): a temporary
// connection to a customer's PC with WinRM or SSH (Windows or Linux),
// nothing remembered. The form: kind, address, port, user, password; the
// step-by-step guide to prepare that PC and what to do when it fails. Once
// connected: who it is, "Collega alla chat" (the same as the chat's 🔌) and
// "Chiudi connessione", which cleans up.
//
// The card is rebuilt at every update, so the panel is one element kept
// across rebuilds (like the network form): what is typed is never lost. The
// password lives in its field until "Avvia connessione", then only in Rust's
// memory; the field is emptied.

import { h, brandOrDot, clear } from "./dom";
import { State } from "../core/state";
import { Bridge } from "../core/bridge";
import { t } from "../core/i18n";
import { Sound } from "../core/sound";

export const REMOTE = "integration_remote";
const COLOR = "#14B8A6";

export interface RemoteData {
  connected?: boolean;
  busy?: boolean;
  error?: string | null;
  kind?: "winrm" | "ssh";
  host?: string;
  user?: string;
  os?: "windows" | "linux";
  name?: string;
  system?: string;
  since?: number;
  https?: boolean;
  trustedAdded?: boolean;
  linked?: boolean;
}

export function remoteData(): RemoteData {
  return (State.integrations[REMOTE]?.data ?? {}) as RemoteData;
}

/** The Panoramica's line. */
export function remoteLine(): string {
  const d = remoteData();
  if (d.busy) return t("Connessione in corso…");
  if (!d.connected) return d.error || t("Nessuna connessione");
  return d.linked ? t("{n} · collegato alla chat", { n: d.name || d.host || "" }) : t("{n} · connesso", { n: d.name || d.host || "" });
}

/** The chat's 🔌 and the card's button. */
export async function toggleRemoteLink(): Promise<string | null> {
  const d = remoteData();
  if (!d.connected) return t("Nessuna connessione aperta.");
  if (!d.linked && !State.settings.agentTools) {
    return t("Per lavorare sul PC remoto la chat usa gli strumenti di EasyIsland: accendili in Impostazioni → Chat.");
  }
  try {
    await Bridge.remoteLink(!d.linked);
    Sound.play("blip");
    return null;
  } catch (e) {
    return String(e).replace(/^Error:\s*/, "");
  }
}

interface Step { text: string; code?: string }

/** Prepare the remote PC, and what each failure means. Commands stay as they are. */
function guide(kind: "winrm" | "ssh"): { title: string; steps: Step[] }[] {
  if (kind === "winrm") {
    return [
      { title: t("Sul PC del cliente (una volta, PowerShell come amministratore)"), steps: [
        { text: t("Accendi WinRM e apri il firewall. Con la rete impostata come «Pubblica» aggiungi -SkipNetworkProfileCheck."), code: "Enable-PSRemoting -Force" },
        { text: t("Con un amministratore locale diverso da «Administrator» (PC fuori dal dominio), senza questo Windows toglie i diritti da remoto:"),
          code: "New-ItemProperty -Path HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System -Name LocalAccountTokenFilterPolicy -Value 1 -PropertyType DWord -Force" },
        { text: t("Facoltativo: lascia entrare solo la tua rete (cambia la subnet)."), code: "Set-NetFirewallRule -Name WINRM-HTTP-In-TCP -RemoteAddress 192.168.1.0/24" },
        { text: t("Utente: NOMEPC\\utente per un account locale, DOMINIO\\utente in un dominio. Porta 5985 (HTTP) o 5986 (HTTPS).") },
      ] },
      { title: t("Su questo PC"), steps: [
        { text: t("Fuori dal dominio, con HTTP, Windows vuole l'indirizzo in TrustedHosts: lascia spuntato «Aggiungi a TrustedHosts». Chiede l'amministratore, e alla chiusura l'indirizzo viene tolto (e il servizio WinRM rifermato, se era spento).") },
        { text: t("HTTPS non ha bisogno di TrustedHosts, ma sul PC del cliente serve un listener HTTPS:"),
          code: "$c = New-SelfSignedCertificate -DnsName $env:COMPUTERNAME -CertStoreLocation Cert:\\LocalMachine\\My\nNew-Item -Path WSMan:\\localhost\\Listener -Transport HTTPS -Address * -CertificateThumbPrint $c.Thumbprint -Force\nNew-NetFirewallRule -Name WINRM-HTTPS -DisplayName \"WinRM HTTPS\" -Protocol TCP -LocalPort 5986 -Action Allow" },
      ] },
      { title: t("Se non va"), steps: [
        { text: t("«TrustedHosts»: spunta «Aggiungi a TrustedHosts» o usa HTTPS.") },
        { text: t("«Accesso negato»: utente come NOMEPC\\utente, password, LocalAccountTokenFilterPolicy (sopra).") },
        { text: t("Il PC non risponde: è acceso e raggiungibile (VPN)? Prova la porta da qui:"), code: "Test-NetConnection 192.168.1.20 -Port 5985" },
        { text: t("Sul PC del cliente controlla il servizio e il listener:"), code: "Get-Service WinRM\nwinrm enumerate winrm/config/listener" },
      ] },
      { title: t("Alla fine, sul PC del cliente (se era solo per oggi)"), steps: [
        { text: "", code: "Disable-PSRemoting -Force\nStop-Service WinRM\nSet-Service WinRM -StartupType Disabled" },
      ] },
    ];
  }
  return [
    { title: t("Windows: sul PC del cliente (PowerShell come amministratore)"), steps: [
      { text: t("Installa e accendi il server OpenSSH di Windows (la regola del firewall per la porta 22 si crea da sola)."),
        code: "Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0\nStart-Service sshd\nSet-Service sshd -StartupType Automatic" },
      { text: t("Utente e password di un account del PC. Con una chiave, per un amministratore va in C:\\ProgramData\\ssh\\administrators_authorized_keys.") },
    ] },
    { title: t("Linux: sul PC del cliente"), steps: [
      { text: t("Installa e accendi il server SSH (Debian, Ubuntu; su altre distribuzioni il pacchetto è openssh-server o openssh)."),
        code: "sudo apt install -y openssh-server\nsudo systemctl enable --now ssh" },
      { text: t("Facoltativo: lascia entrare solo la tua rete."), code: "sudo ufw allow from 192.168.1.0/24 to any port 22" },
    ] },
    { title: t("Se non va"), steps: [
      { text: t("«Accesso negato»: utente e password; sul PC deve essere permesso l'accesso con password:"), code: "PasswordAuthentication yes   # in /etc/ssh/sshd_config o C:\\ProgramData\\ssh\\sshd_config" },
      { text: t("«Rifiutata»: il server SSH non è acceso, o ascolta su un'altra porta (scrivila nel campo Porta).") },
      { text: t("Il PC non risponde: è acceso e raggiungibile (VPN)? Il firewall lascia passare la 22?"), code: "Test-NetConnection 192.168.1.20 -Port 22" },
      { text: t("La password non viene chiesta (Windows 10 vecchi): aggiorna OpenSSH di questo PC, o usa una chiave."), code: "winget install Microsoft.OpenSSH.Preview" },
      { text: t("Le chiavi dei PC visti valgono solo per questa connessione e si cancellano alla chiusura: nessun avviso di «chiave cambiata» da un cliente all'altro.") },
    ] },
    { title: t("Alla fine, sul PC del cliente (se era solo per oggi)"), steps: [
      { text: t("Windows:"), code: "Stop-Service sshd\nSet-Service sshd -StartupType Disabled" },
      { text: t("Linux:"), code: "sudo systemctl disable --now ssh" },
    ] },
  ];
}

const form = { kind: "winrm" as "winrm" | "ssh", host: "", port: "", user: "", https: false, trust: true, guide: false };
let panel: HTMLElement | null = null;
let sync: (() => void) | null = null;
let openChatFn: (() => void) | null = null;

/** The card: the form, or the open connection. `openChat` opens the chat. */
export function remoteCard(openSettings: () => void, openChat: () => void): HTMLElement {
  openChatFn = openChat;
  if (panel) {
    sync?.();
    return panel;
  }
  const note = h("div", { class: "notion-note" });
  let message = "";
  let bad = false;
  const say = (m: string, isBad = true) => { message = m; bad = isBad; sync?.(); };

  // ── The form ──
  const field = (key: "host" | "port" | "user", placeholder: string, cls = "") => {
    const el = h("input", { class: `nc-input ${cls}`, placeholder, spellcheck: "false",
      oninput: () => { form[key] = el.value; },
      onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === "Enter") void start(); } }) as HTMLInputElement;
    el.value = form[key];
    return el;
  };
  const host = field("host", "192.168.1.20", "rm-host");
  const port = field("port", "5985", "rm-port");
  const user = field("user", t("NOMEPC\\utente"), "rm-user");
  const pass = h("input", { class: "nc-input rm-user", type: "password", placeholder: t("password"), autocomplete: "off",
    onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === "Enter") void start(); } }) as HTMLInputElement;
  const kindA = h("button", { text: "WinRM", onclick: () => { form.kind = "winrm"; sync?.(); } });
  const kindB = h("button", { text: t("SSH (Windows o Linux)"), onclick: () => { form.kind = "ssh"; sync?.(); } });
  const check = (label: string, key: "https" | "trust", title: string) => {
    const box = h("input", { type: "checkbox", onchange: () => { form[key] = box.checked; sync?.(); } }) as HTMLInputElement;
    return { box, el: h("label", { class: "rm-check", title }, box, h("span", { text: label })) };
  };
  const https = check(t("HTTPS (5986)"), "https", t("Certificato del PC non controllato"));
  const trust = check(t("Aggiungi a TrustedHosts"), "trust", t("Solo per questa connessione: chiede l'amministratore e alla chiusura viene tolto"));
  const winrmOpts = h("div", { class: "nc-row" }, h("span", { class: "nc-label" }), https.el, trust.el);
  const startBtn = h("button", { class: "teams-btn light rm-start", text: t("Avvia connessione"), onclick: () => void start() }) as HTMLButtonElement;
  const guideBtn = h("button", { class: "link-btn", style: "color:#8e939c", onclick: () => { form.guide = !form.guide; sync?.(); } });
  const guideBox = h("div", { class: "rm-guide" });
  const formBox = h("div", { class: "rm-form" },
    h("div", { class: "nc-row" }, h("span", { class: "nc-label", text: t("Tipo") }), h("div", { class: "nc-seg" }, kindA, kindB)),
    h("div", { class: "nc-row" }, h("span", { class: "nc-label", text: t("Indirizzo") }), host, h("span", { class: "nc-label", text: t("Porta") }), port),
    h("div", { class: "nc-row" }, h("span", { class: "nc-label", text: t("Utente") }), user, pass),
    winrmOpts,
    h("div", { class: "nc-row rm-foot" }, startBtn, guideBtn),
    h("div", { class: "hint rec-hint", text: t("Niente viene salvato: indirizzo, utente e password restano in memoria finché chiudi la connessione.") }),
    guideBox);

  async function start() {
    if (remoteData().busy) return;
    if (!form.host.trim()) { say(t("Scrivi l'indirizzo IP o il nome del PC.")); return; }
    const p = form.port.trim() ? Number(form.port.trim()) : 0;
    if (form.port.trim() && !(p > 0 && p < 65536)) { say(t("Porta non valida.")); return; }
    say("", false);
    Sound.play("blip");
    const password = pass.value;
    try {
      await Bridge.remoteConnect({ kind: form.kind, host: form.host.trim(), port: p || null, user: form.user.trim(), password,
        https: form.kind === "winrm" && form.https, trust: form.kind === "winrm" && !form.https && form.trust });
      pass.value = "";
      Sound.play("finish");
      say("", false);
    } catch (e) {
      say(String(e).replace(/^Error:\s*/, ""));
    }
  }

  // ── Connected ──
  const who = h("div", { class: "rm-who" });
  const linkBtn = h("button", { class: "teams-btn light", onclick: async () => { const m = await toggleRemoteLink(); if (m) say(m); } }) as HTMLButtonElement;
  const chatBtn = h("button", { class: "teams-btn plain", text: t("Apri la chat"), onclick: () => openChatFn?.() });
  const closeBtn = h("button", { class: "teams-btn red", text: t("Chiudi connessione"), onclick: async () => {
    Sound.play("blip");
    try {
      await Bridge.remoteDisconnect();
      say(t("Connessione chiusa e pulita."), false);
    } catch (e) {
      say(String(e).replace(/^Error:\s*/, ""));
    }
  } });
  const cleanup = h("div", { class: "hint rec-hint" });
  const liveBox = h("div", { class: "rm-live" }, who, h("div", { class: "rec-actions" }, linkBtn, chatBtn, closeBtn), cleanup);

  const status = h("span");
  const head = h("div", { class: "int-head" }, brandOrDot(REMOTE, COLOR, 7), h("b", { text: t("Accesso remoto") }), status,
    h("button", { class: "link-btn", style: "color:#8e939c", text: t("Impostazioni…"), onclick: openSettings }));
  const body = h("div", { class: "rec-body" }, formBox, liveBox, note);
  panel = h("div", { class: "int-card notion-card rm-card" }, head, body);

  let guideKey = "";
  sync = () => {
    const d = remoteData();
    const on = !!d.connected;
    formBox.style.display = on ? "none" : "";
    liveBox.style.display = on ? "" : "none";
    status.textContent = d.busy ? t("Connessione in corso…") : on ? (d.linked ? t("Collegato alla chat") : t("Connesso")) : t("Nessuna connessione");
    kindA.classList.toggle("on", form.kind === "winrm");
    kindB.classList.toggle("on", form.kind === "ssh");
    port.placeholder = form.kind === "ssh" ? "22" : form.https ? "5986" : "5985";
    user.placeholder = form.kind === "ssh" ? t("utente") : t("NOMEPC\\utente");
    winrmOpts.style.display = form.kind === "winrm" ? "" : "none";
    https.box.checked = form.https;
    trust.box.checked = form.trust;
    trust.el.style.display = form.https ? "none" : "";
    startBtn.disabled = !!d.busy;
    startBtn.textContent = d.busy ? t("Connessione in corso…") : t("Avvia connessione");
    guideBtn.textContent = form.guide ? t("Nascondi la guida") : t("Guida passo passo");
    const key = form.guide ? form.kind : "";
    if (key !== guideKey) {
      guideKey = key;
      clear(guideBox);
      if (form.guide) {
        for (const part of guide(form.kind)) {
          guideBox.append(h("div", { class: "rm-guide-title", text: part.title }));
          for (const s of part.steps) {
            if (s.text) guideBox.append(h("div", { class: "rm-step", text: s.text }));
            if (s.code) {
              const code = s.code;
              guideBox.append(h("div", { class: "rm-code" }, h("pre", { text: code }),
                h("button", { class: "link-btn", style: `color:${COLOR}`, text: t("Copia"), onclick: () => void navigator.clipboard.writeText(code).then(() => say(t("Copiato negli appunti ✓"), false), () => say(t("Copia non riuscita"))) })));
            }
          }
        }
      }
    }
    if (on) {
      const kind = d.kind === "ssh" ? "SSH" : d.https ? "WinRM HTTPS" : "WinRM";
      clear(who);
      who.append(h("span", { class: d.linked ? "teams-dot live" : "teams-dot on" }),
        h("b", { text: d.name || d.host || "" }),
        h("span", { class: "rm-dim", text: [d.host !== d.name ? d.host : "", d.system || (d.os === "linux" ? "Linux" : "Windows"), kind, d.user].filter(Boolean).join(" · ") }));
      linkBtn.textContent = d.linked ? t("Scollega dalla chat") : t("Collega alla chat");
      cleanup.textContent = d.linked
        ? t("La chat lavora su questo PC: ogni comando chiede Consenti / Nega. Chiudendo: chat scollegata, password dimenticata{x}.", { x: d.trustedAdded ? t(", indirizzo tolto da TrustedHosts") : "" })
        : t("Premi «Collega alla chat» (o 🔌 nella chat) e chiedi cosa fare. Chiudendo: password dimenticata{x}.", { x: d.trustedAdded ? t(", indirizzo tolto da TrustedHosts") : "" });
    }
    const shown = message || (!on && !d.busy ? d.error ?? "" : "");
    note.textContent = shown;
    note.style.display = shown ? "" : "none";
    note.classList.toggle("bad", bad || (!message && !!d.error));
  };
  sync();
  return panel;
}
