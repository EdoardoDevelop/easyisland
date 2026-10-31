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
  { name: "pause", label: t("Pausa"), d: "M8 5v14 M16 5v14" },
  { name: "previous", label: t("Precedente"), d: "M6 5v14 M19 5.5v13L9.5 12z" },
  { name: "next", label: t("Successivo"), d: "M18 5v14 M5 5.5v13l9.5-6.5z" },
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
  { name: "pen", label: t("Penna"), d: "M15 4.5l4.5 4.5L8 20.5H3.5V16z M12.5 7l4.5 4.5" },
  { name: "edit", label: t("Modifica"), d: "M4 20h4L19 9l-4-4L4 16z M13 7l4 4 M12 20h8" },
  { name: "copy", label: t("Copia"), d: "M8 8h12v12H8z M16 8V4H4v12h4" },
  { name: "paste", label: t("Incolla"), d: "M9 3.5h6v3H9z M7 5H5v16h6 M17 5h2v5 M12 12h9v9h-9z" },
  { name: "scissors", label: t("Taglia"), d: "M6 4a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M6 15a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M8.2 8 20 18 M8.2 16 20 6" },
  { name: "save", label: t("Salva"), d: "M4 4h13l3 3v13H4z M8 4v5h8V4 M7.5 20v-6h9v6" },
  { name: "archive", label: t("Archivio"), d: "M3 4h18v4H3z M5 8v12h14V8 M10 12h4" },
  { name: "inbox", label: t("Posta in arrivo"), d: "M3 13l3-8h12l3 8v7H3z M3 13h5l1.5 3h5L16 13h5" },
  { name: "send", label: t("Invia"), d: "M21 3 10 14 M21 3l-7 18-4-7-7-4z" },
  { name: "attach", label: t("Allegato"), d: "M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17a1.7 1.7 0 0 1-2.4-2.4L15 7" },
  { name: "bookmark", label: t("Segnalibro"), d: "M6 3h12v18l-6-4.5L6 21z" },
  { name: "tag", label: t("Etichetta"), d: "M3 3h8l10 10-8 8L3 11z M7.5 7.5h.01" },
  { name: "flag", label: t("Bandiera"), d: "M5 21V4 M5 4h12l-2 4 2 4H5" },
  { name: "pin", label: t("Puntina"), d: "M9 3h6l-1 6 4 4H6l4-4z M12 13v8" },
  { name: "map", label: t("Mappa"), d: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14" },
  { name: "location", label: t("Posizione"), d: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z M12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" },
  { name: "compass", label: t("Bussola"), d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M15.5 8.5l-2 5-5 2 2-5z" },
  { name: "car", label: t("Auto"), d: "M3 16v-4l2-5h14l2 5v4z M3 12h18 M6.5 16v2.5 M17.5 16v2.5 M7 14h.01 M17 14h.01" },
  { name: "truck", label: t("Spedizioni"), d: "M2 6h12v11H2z M14 10h4l3 3.5V17h-7 M6 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M17 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" },
  { name: "plane", label: t("Viaggio"), d: "M21 15.5 13.5 11V5a1.5 1.5 0 0 0-3 0v6L3 15.5V17l7.5-2.5V19L8 20.5V22l4-1 4 1v-1.5L13.5 19v-4.5L21 17z" },
  { name: "cart", label: t("Carrello"), d: "M3 4h2.5l2.2 11h10.6L20.5 7H6.4 M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" },
  { name: "bag", label: t("Acquisti"), d: "M5 8h14l-1 13H6z M9 8V6.5a3 3 0 0 1 6 0V8" },
  { name: "gift", label: t("Regalo"), d: "M4 9h16v4H4z M5.5 13h13v8h-13z M12 9v12 M12 9C10 5 6.5 5.5 7.5 7.5 8.3 9 12 9 12 9z M12 9c2-4 5.5-3.5 4.5-1.5C15.7 9 12 9 12 9z" },
  { name: "card", label: t("Carta"), d: "M3 6h18v12H3z M3 10h18 M6.5 14.5h4" },
  { name: "wallet", label: t("Portafoglio"), d: "M4 6h14v3 M4 6v13h16V9H4 M16 14h.01" },
  { name: "receipt", label: t("Fattura"), d: "M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z M9 8h6 M9 12h6 M9 16h3" },
  { name: "calculator", label: t("Calcolatrice"), d: "M5 3h14v18H5z M8 6.5h8v3H8z M8.5 13h.01 M12 13h.01 M15.5 13h.01 M8.5 17h.01 M12 17h.01 M15.5 17h.01" },
  { name: "percent", label: t("Percentuale"), d: "M19 5 5 19 M7 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M17 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" },
  { name: "trend", label: t("Andamento"), d: "M3 17l6-6 4 4 8-8 M15 7h6v6" },
  { name: "pie", label: t("Torta"), d: "M12 3a9 9 0 1 0 9 9h-9z M14.5 2.5v7h7a7 7 0 0 0-7-7z" },
  { name: "table", label: t("Tabella"), d: "M3 4h18v16H3z M3 9.5h18 M3 15h18 M9.5 4v16" },
  { name: "list", label: t("Elenco"), d: "M9 6h12 M9 12h12 M9 18h12 M4 6h.01 M4 12h.01 M4 18h.01" },
  { name: "checklist", label: t("Attività"), d: "M3.5 6l1.5 1.5L8 4.5 M3.5 12.5 5 14l3-3 M3.5 19 5 20.5l3-3 M11 6h10 M11 12.5h10 M11 19h10" },
  { name: "kanban", label: t("Bacheca"), d: "M3 4h18v16H3z M9 4v16 M15 4v16 M5 7.5h2 M11 7.5h2 M17 7.5h2" },
  { name: "layers", label: t("Livelli"), d: "M12 3 2.5 8 12 13l9.5-5z M2.5 12.5 12 17.5l9.5-5 M2.5 16.5 12 21.5l9.5-5" },
  { name: "grid", label: t("Griglia"), d: "M4 4h6.5v6.5H4z M13.5 4H20v6.5h-6.5z M4 13.5h6.5V20H4z M13.5 13.5H20V20h-6.5z" },
  { name: "window", label: t("Finestra"), d: "M3 4h18v16H3z M3 8.5h18 M6 6.3h.01 M8.5 6.3h.01" },
  { name: "laptop", label: t("Portatile"), d: "M5 5h14v10H5z M2.5 19h19l-2-4h-15z" },
  { name: "tablet", label: t("Tablet"), d: "M5 3h14v18H5z M11 18h2" },
  { name: "keyboard", label: t("Tastiera"), d: "M2.5 6h19v12h-19z M6 10h.01 M9.5 10h.01 M13 10h.01 M16.5 10h.01 M7.5 14.5h9" },
  { name: "mouse", label: t("Mouse"), d: "M12 3a6 6 0 0 0-6 6v6a6 6 0 0 0 12 0V9a6 6 0 0 0-6-6z M12 7v3.5" },
  { name: "usb", label: t("USB"), d: "M12 21V5 M9 7.5 12 3l3 4.5 M12 16l-5-3V10 M12 13.5l5-3V8 M6 9h2v2H6z M16 6.5a1 1 0 1 0 2 0 1 1 0 0 0-2 0z" },
  { name: "memory", label: t("Memoria"), d: "M3 7h18v9H3z M7 16v3 M12 16v3 M17 16v3 M6.5 10v3 M10 10v3 M14 10v3 M17.5 10v3" },
  { name: "gpu", label: t("Scheda video"), d: "M2.5 6h19v11h-19z M5.5 17v3 M9.5 17v3 M9 11.5a3 3 0 1 0 6 0 3 3 0 0 0-6 0 M17.5 9.5v4" },
  { name: "cpu", label: t("Processore"), d: "M6 6h12v12H6z M9.5 9.5h5v5h-5z M9 2.5V6 M15 2.5V6 M9 18v3.5 M15 18v3.5 M2.5 9H6 M2.5 15H6 M18 9h3.5 M18 15h3.5" },
  { name: "hdd", label: t("Disco"), d: "M3 13h18v6H3z M3 13l3-8h12l3 8 M7 16h.01 M11 16h6" },
  { name: "battery", label: t("Batteria"), d: "M3 7.5h16v9H3z M19 10.5h2v3h-2 M6 10.5v3" },
  { name: "bluetooth", label: t("Bluetooth"), d: "M7 7l10 10-5 4V3l5 4L7 17" },
  { name: "router", label: t("Router"), d: "M3 14h18v6H3z M7 17h.01 M11 17h.01 M16 14l2-6 M9 9a5 5 0 0 1 7-1.5 M6.5 6.5a8.5 8.5 0 0 1 12-1.5" },
  { name: "video", label: t("Videochiamata"), d: "M3 6.5h12v11H3z M15 10.5l6-3.5v10l-6-3.5" },
  { name: "mic", label: t("Microfono"), d: "M9 4a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z M5.5 11a6.5 6.5 0 0 0 13 0 M12 17.5V21 M8.5 21h7" },
  { name: "volume", label: t("Volume"), d: "M4 9.5h4L13 5v14l-5-4.5H4z M16.5 9a4 4 0 0 1 0 6 M19 6.5a7.5 7.5 0 0 1 0 11" },
  { name: "headphones", label: t("Cuffie"), d: "M4 15v-3a8 8 0 0 1 16 0v3 M4 15h3v5H4z M17 15h3v5h-3z" },
  { name: "film", label: t("Video"), d: "M3 4h18v16H3z M7 4v16 M17 4v16 M3 9h4 M3 15h4 M17 9h4 M17 15h4" },
  { name: "palette", label: t("Colori"), d: "M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2.5A3.5 3.5 0 0 0 21 11.5C21 6.8 17 3 12 3z M7.5 11h.01 M10 7h.01 M15 7.5h.01" },
  { name: "brush", label: t("Pennello"), d: "M20 4 11 13 M11 13l-2.5-.5C6 12.5 4 14 4 17c0 1.5-.5 2.5-1.5 3 3.5.5 8-.5 8-4.5z M13 11l3 3" },
  { name: "crop", label: t("Ritaglia"), d: "M6 2.5V18h15.5 M2.5 6H18v15.5" },
  { name: "eye", label: t("Visualizza"), d: "M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" },
  { name: "filter", label: t("Filtro"), d: "M3 4.5h18l-7 8.5v6l-4 2v-8z" },
  { name: "sort", label: t("Ordina"), d: "M7 4v16 M3.5 16.5 7 20l3.5-3.5 M17 20V4 M13.5 7.5 17 4l3.5 3.5" },
  { name: "settings", label: t("Impostazioni"), d: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2L14.8 21h-4l-.3-2.4a7 7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.4L4.6 9.9l2-3.4 1.9.7a7 7 0 0 1 2-1.2L10.8 3h4l.3 2.4a7 7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.4z" },
  { name: "sliders", label: t("Regolazioni"), d: "M4 6h9 M17 6h3 M4 12h3 M11 12h9 M4 18h11 M19 18h1 M15 4v4 M9 10v4 M17 16v4" },
  { name: "toggle", label: t("Interruttore"), d: "M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7z M16 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" },
  { name: "plug", label: t("Spina"), d: "M9 3v5 M15 3v5 M6 8h12v3a6 6 0 0 1-12 0z M12 17v4" },
  { name: "sun", label: t("Sole"), d: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2.5v2 M12 19.5v2 M2.5 12h2 M19.5 12h2 M5.3 5.3l1.4 1.4 M17.3 17.3l1.4 1.4 M5.3 18.7l1.4-1.4 M17.3 6.7l1.4-1.4" },
  { name: "moon", label: t("Luna"), d: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" },
  { name: "umbrella", label: t("Ombrello"), d: "M2.5 12a9.5 9.5 0 0 1 19 0z M12 12v7a2 2 0 0 1-4 0 M12 2.5V4" },
  { name: "fire", label: t("Fuoco"), d: "M12 21a6.5 6.5 0 0 0 6.5-6.5c0-4.5-4-6.5-4.5-11-2.5 2-5.5 5-5.5 8.5-1-1-1.5-2-1.5-3C5.5 11 5.5 12.5 5.5 14.5A6.5 6.5 0 0 0 12 21z" },
  { name: "leaf", label: t("Foglia"), d: "M5 19C5 10 10 4 20 4c0 10-6 15-15 15z M5 19l8-8" },
  { name: "coffee", label: t("Caffè"), d: "M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z M17 10h1.5a2.5 2.5 0 0 1 0 5H17 M8 2.5V5 M12 2.5V5" },
  { name: "food", label: t("Cibo"), d: "M6 3v8 M4 3v5a2 2 0 0 0 4 0V3 M6 11v10 M17 21V3c-2.5 1-4 4-4 8h4" },
  { name: "book", label: t("Libro"), d: "M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3" },
  { name: "school", label: t("Formazione"), d: "M2 9l10-5 10 5-10 5z M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5 M22 9v5" },
  { name: "building", label: t("Azienda"), d: "M4 21V3h11v18 M15 9h5v12 M2.5 21h19 M7.5 7h4 M7.5 11h4 M7.5 15h4" },
  { name: "store", label: t("Negozio"), d: "M3 9 4.5 4h15L21 9 M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0 M5 11.5V20h14v-8.5 M10 20v-5h4v5" },
  { name: "factory", label: t("Produzione"), d: "M3 21V10l5 3V10l5 3V10l5 3V4h3v17z M7 17h2 M12 17h2" },
  { name: "box", label: t("Pacco"), d: "M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z M3 7.5l9 4.5 9-4.5 M12 12v9" },
  { name: "hammer", label: t("Martello"), d: "M14 4.5 19.5 10 M12 6.5l5.5 5.5 M15 3l-6 6 3 3 6-6 M10.5 10.5 3 18l3 3 7.5-7.5" },
  { name: "medical", label: t("Salute"), d: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" },
  { name: "smile", label: t("Sorriso"), d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M8 14s1.5 2.5 4 2.5 4-2.5 4-2.5 M9 9.5h.01 M15 9.5h.01" },
  { name: "thumb", label: t("Mi piace"), d: "M7 10v11H3V10z M7 10l4-7c1.7 0 2.7 1.3 2.3 3L12.5 9.5H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 21H7" },
  { name: "bell", label: t("Notifica"), d: "M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z M10 20.5a2 2 0 0 0 4 0" },
  { name: "megaphone", label: t("Annuncio"), d: "M3 10v4h3l9 5V5L6 10z M18 9a3.5 3.5 0 0 1 0 6 M7 14l1.5 6H11l-1-5.5" },
  { name: "lightbulb", label: t("Idea"), d: "M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" },
  { name: "target", label: t("Obiettivo"), d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" },
  { name: "trophy", label: t("Trofeo"), d: "M7 4h10v5a5 5 0 0 1-10 0z M7 6H4a3 3 0 0 0 3 4 M17 6h3a3 3 0 0 1-3 4 M12 14v4 M8 21h8 M9.5 18h5" },
  { name: "timer", label: t("Timer"), d: "M12 7a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M12 10.5V14l2 1.5 M9.5 2.5h5 M12 2.5V7" },
  { name: "hourglass", label: t("Clessidra"), d: "M6 3h12 M6 21h12 M7 3c0 5 10 5 10 9s-10 4-10 9 M17 3c0 5-10 5-10 9s10 4 10 9" },
  { name: "history", label: t("Cronologia"), d: "M3.5 12a8.5 8.5 0 1 0 2.5-6 M3 4v4h4 M12 7.5V12l3 2" },
  { name: "undo", label: t("Annulla"), d: "M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11" },
  { name: "sync", label: t("Sincronizza"), d: "M4 10a8 8 0 0 1 14-4l2 2 M20 4v4h-4 M20 14a8 8 0 0 1-14 4l-2-2 M4 20v-4h4" },
  { name: "share", label: t("Condividi"), d: "M18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M6 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M8.6 10.5l6.8-4 M8.6 13.5l6.8 4" },
  { name: "external", label: t("Apri fuori"), d: "M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6" },
  { name: "plus", label: t("Aggiungi"), d: "M12 5v14 M5 12h14" },
  { name: "minus", label: t("Togli"), d: "M5 12h14" },
  { name: "close", label: t("Chiudi"), d: "M6 6l12 12 M18 6 6 18" },
  { name: "question", label: t("Domanda"), d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6 M12 17h.01" },
  { name: "hash", label: t("Numero"), d: "M5 9h15 M4 15h15 M10 3 8 21 M16 3l-2 18" },
  { name: "at", label: t("Chiocciola"), d: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1" },
  { name: "fingerprint", label: t("Impronta"), d: "M6 18c1-2 1.5-4 1.5-6.5a4.5 4.5 0 0 1 9 0c0 1.5-.2 3-.6 4.5 M12 11.5c0 3-.8 6-2.5 8.5 M4 15c.4-1.2.5-2.3.5-3.5a7.5 7.5 0 0 1 12.8-5.3 M19.5 10c.2 2.5 0 5-.8 7.5 M15.5 15.5c-.5 2-1.3 3.8-2.5 5.5" },
  { name: "qr", label: t("Codice QR"), d: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h3v3h-3z M20 14v.01 M14 20h.01 M17 17h4v4h-4 M6 6h1v1H6z M17 6h1v1h-1z M6 17h1v1H6z" },
  { name: "anchor", label: t("Ancora"), d: "M12 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M12 5v16 M5 12H2a10 10 0 0 0 20 0h-3 M8 9h8" },
  { name: "puzzle", label: t("Componente"), d: "M4 7h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4h-4a2 2 0 1 0-4 0H4v-4a2 2 0 1 0 0-4z" },
  { name: "robot", label: t("Robot"), d: "M5 8h14v11H5z M12 4v4 M12 3h.01 M9 12.5h.01 M15 12.5h.01 M9.5 16h5 M2.5 12v3 M21.5 12v3" },
  { name: "repo", label: t("Repository"), d: "M6 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M6 8v8 M6 16a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M18 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M18 8c0 5-6 4-12 8" },
  { name: "api", label: t("API"), d: "M4 12h4 M16 12h4 M8 8h8v8H8z M12 4v4 M12 16v4" },
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

/** An automatic icon (the program's or the site's, stored as a PNG data: URL). */
export function isPictureIcon(value: string | undefined): value is string {
  return (value ?? "").startsWith("data:image/");
}

/** What to put in an action's icon slot: our SVG, the program's or site's picture, or the old text (emoji). */
export function renderActionIcon(value: string | undefined, size = 16): Node {
  if (isPictureIcon(value)) {
    const img = document.createElement("img");
    img.src = value;
    img.width = img.height = size;
    img.alt = "";
    img.draggable = false;
    img.className = "qa-pic";
    img.style.objectFit = "contain";
    return img;
  }
  const icon = actionIcon(value);
  return icon ? actionIconSvg(icon, size) : document.createTextNode((value ?? "").trim());
}
