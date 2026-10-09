// Icons for the quick actions, drawn in code (stroked paths on a 24×24 grid),
// since emoji are awkward to type on Windows. An action stores "i:<name>";
// anything else in `icon` (an emoji or a letter from older settings) is still
// shown as text.

import { t } from "../core/i18n";

export interface ActionIcon {
  name: string;
  /** Label in the interface language, shown as a tooltip in the picker. */
  label: string;
  d: string;
}

export const ACTION_ICONS: ActionIcon[] = [
  { name: "bolt", label: t("Fulmine"), d: "M13 2 4 14h7l-1 8 9-12h-7l1-8z" },
  { name: "sparkles", label: t("Intelligenza artificiale"), d: "M11 3l1.7 4.6L17 9.3l-4.3 1.7L11 15.6 9.3 11 5 9.3l4.3-1.7z M18.5 14l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" },
  { name: "chat", label: t("Messaggio"), d: "M4 4h16v12H9l-5 4z" },
  { name: "terminal", label: t("Terminale"), d: "M3 5h18v14H3z M7 9.5l3 2.5-3 2.5 M12.5 15h4.5" },
  { name: "code", label: t("Codice"), d: "M8.5 7 3.5 12l5 5 M15.5 7l5 5-5 5 M13.5 4.5l-3 15" },
  { name: "globe", label: t("Sito web"), d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3.5 9h17 M3.5 15h17 M12 3c-3.2 3.4-3.2 14.6 0 18 M12 3c3.2 3.4 3.2 14.6 0 18" },
  { name: "link", label: t("Link"), d: "M10 13.5a4 4 0 0 0 5.7.3l3-3a4 4 0 0 0-5.7-5.6l-1.2 1.2 M14 10.5a4 4 0 0 0-5.7-.3l-3 3a4 4 0 0 0 5.7 5.6l1.2-1.2" },
  { name: "folder", label: t("Cartella"), d: "M3 6.5V19h18V8.5h-9.5L9.5 6.5z" },
  { name: "file", label: t("Documento"), d: "M6 3h8.5L19 7.5V21H6z M14 3v5h5 M9 13h7 M9 16.5h5" },
  { name: "clipboard", label: t("Appunti"), d: "M9 3.5h6v3H9z M7 5H5v16h14V5h-2 M8.5 11h7 M8.5 15h5" },
  { name: "note", label: t("Nota"), d: "M4 20l1.2-4.8L16 4.4l3.6 3.6L8.8 18.8z M14 6.8l3.2 3.2" },
  { name: "monitor", label: t("Computer"), d: "M3 4h18v12H3z M12 16v4 M8 20h8" },
  { name: "remote", label: t("Desktop remoto"), d: "M3 4h18v12H3z M12 16v4 M8 20h8 M9 11l3-3 3 3 M12 8v5" },
  { name: "server", label: t("Server"), d: "M4 4h16v6H4z M4 14h16v6H4z M7.5 7h1 M7.5 17h1 M12 7h4.5 M12 17h4.5" },
  { name: "database", label: t("Database"), d: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" },
  { name: "wifi", label: t("Rete Wi-Fi"), d: "M2.5 9a14 14 0 0 1 19 0 M5.5 12.5a9.5 9.5 0 0 1 13 0 M8.8 16a4.8 4.8 0 0 1 6.4 0 M12 19.5h.01" },
  { name: "network", label: t("Rete"), d: "M9.5 3h5v5h-5z M2.5 16h5v5h-5z M16.5 16h5v5h-5z M12 8v4 M5 16v-4h14v4" },
  { name: "cloud", label: t("Cloud"), d: "M7 18.5a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 9.6a4.5 4.5 0 0 1-.5 8.9z" },
  { name: "lock", label: t("Lucchetto"), d: "M5.5 11h13v10h-13z M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11 M12 15v2.5" },
  { name: "key", label: t("Chiave"), d: "M8.5 5.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M11.5 12.5 20 21 M16 17l2.2-2.2 M18.5 19.5l2-2" },
  { name: "shield", label: t("Sicurezza"), d: "M12 3l8 3v5.5c0 5-3.4 8.3-8 9.5-4.6-1.2-8-4.5-8-9.5V6z M8.5 12l2.5 2.5 4.5-5" },
  { name: "user", label: t("Persona"), d: "M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M4.5 21a7.5 7.5 0 0 1 15 0" },
  { name: "users", label: t("Clienti"), d: "M9 5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z M2.5 20a6.5 6.5 0 0 1 13 0 M15.5 5.3a3.5 3.5 0 0 1 0 6.4 M18 14.2a6.5 6.5 0 0 1 3.5 5.8" },
  { name: "headset", label: t("Assistenza"), d: "M4 14v-2a8 8 0 0 1 16 0v2 M4 14h3.5v6H4z M16.5 14H20v6h-3.5z M20 20c0 1.2-2 2-5 2" },
  { name: "mail", label: t("Posta"), d: "M3 5h18v14H3z M3.5 6l8.5 7 8.5-7" },
  { name: "phone", label: t("Telefono"), d: "M7.5 2h9v20h-9z M11 18.5h2" },
  { name: "calendar", label: t("Calendario"), d: "M4 5h16v16H4z M4 10h16 M8.5 3v4 M15.5 3v4 M8 14h2 M14 14h2 M8 17.5h2" },
  { name: "clock", label: t("Orologio"), d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5.5l3.5 2" },
  { name: "search", label: t("Cerca"), d: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M15.5 15.5 21 21" },
  { name: "refresh", label: t("Aggiorna"), d: "M20 12a8 8 0 1 1-2.4-5.7 M20 4v5h-5" },
  { name: "download", label: t("Scarica"), d: "M12 3v12 M7 10l5 5 5-5 M4 20h16" },
  { name: "upload", label: t("Carica"), d: "M12 21V9 M7 14l5-5 5 5 M4 4h16" },
  { name: "play", label: t("Avvia"), d: "M7 4.5v15l12-7.5z" },
  { name: "power", label: t("Accensione"), d: "M12 3v9 M6.3 6.8a8 8 0 1 0 11.4 0" },
  { name: "wrench", label: t("Manutenzione"), d: "M14.5 3.5a5 5 0 0 0-5.2 6.7L3.5 16l4.5 4.5 5.8-5.8a5 5 0 0 0 6.7-5.2l-3 3-3.5-1-1-3.5z" },
  { name: "bug", label: t("Errore"), d: "M8 10h8v5a4 4 0 0 1-8 0z M9 10a3 3 0 0 1 6 0 M3.5 13H8 M16 13h4.5 M5 8l3 2 M19 8l-3 2 M5 19l3-2 M19 19l-3-2" },
  { name: "printer", label: t("Stampante"), d: "M7 8V3h10v5 M4 8h16v8H4z M7 13h10v8H7z" },
  { name: "trash", label: t("Elimina"), d: "M4 7h16 M9.5 7V4h5v3 M6 7l1 14h10l1-14 M10 11v6 M14 11v6" },
  { name: "chart", label: t("Grafico"), d: "M4 3v17h17 M8.5 16v-4 M12.5 16V8 M16.5 16v-6" },
  { name: "euro", label: t("Pagamenti"), d: "M17.5 6.5a6.5 6.5 0 1 0 0 11 M4 10h9 M4 14h9" },
  { name: "briefcase", label: t("Lavoro"), d: "M3 7h18v13H3z M9 7V4h6v3 M3 12.5h18" },
  { name: "home", label: t("Casa"), d: "M3 11.5 12 4l9 7.5 M5.5 9.5V20h13V9.5 M10 20v-5h4v5" },
  { name: "rocket", label: t("Rilascio"), d: "M12 2.5c3.8 2.8 5 7.5 3.2 12.5H8.8C7 10 8.2 5.3 12 2.5z M8.8 15 6 18v3l3-1.8 M15.2 15l2.8 3v3l-3-1.8 M12 9h.01" },
  { name: "image", label: t("Immagine"), d: "M3 5h18v14H3z M3.5 16.5 8.5 11.5l4 4 3-3 5 5 M15.5 8.5h.01" },
  { name: "camera", label: t("Schermata"), d: "M3 7.5h4l2-3h6l2 3h4V20H3z M12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" },
  { name: "music", label: t("Musica"), d: "M9 18V5.5L20 3.5v12.5 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" },
  { name: "star", label: t("Preferito"), d: "M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4l-5.6 2.9 1.1-6.2L3 9.7l6.2-.9z" },
  { name: "heart", label: t("Cuore"), d: "M12 20s-8-4.6-8-10.4A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 8 2.6C20 15.4 12 20 12 20z" },
  { name: "check", label: t("Fatto"), d: "M5 12.5l4.5 4.5L19 7.5" },
  { name: "alert", label: t("Avviso"), d: "M12 3.5 21.5 20h-19z M12 10v4.5 M12 17.5h.01" },
  { name: "info", label: t("Informazioni"), d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v5.5 M12 7.5h.01" },
];

const BY_NAME = new Map(ACTION_ICONS.map((i) => [i.name, i]));

/** The icon an action stores, if it is one of ours ("i:<name>"); the old "⚡" maps to the bolt. */
export function actionIcon(value: string | undefined): ActionIcon | null {
  const v = (value ?? "").trim();
  if (!v || v === "⚡") return BY_NAME.get("bolt")!;
  if (v.startsWith("i:")) return BY_NAME.get(v.slice(2)) ?? BY_NAME.get("bolt")!;
  return null;
}

/** An <svg> for `icon`, stroked in the current text colour. */
export function actionIconSvg(icon: ActionIcon, size = 16): SVGSVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("width", String(size));
  el.setAttribute("height", String(size));
  el.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", icon.d);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "1.8");
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  el.append(p);
  return el;
}

/** What to put in an action's icon slot: our SVG, or the old text (emoji). */
export function renderActionIcon(value: string | undefined, size = 16): Node {
  const icon = actionIcon(value);
  return icon ? actionIconSvg(icon, size) : document.createTextNode((value ?? "").trim());
}
