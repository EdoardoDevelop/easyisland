// The fixed bar's system elements («Widget della barra», docs/architettura.md →
// «Barra fissa»): what each is called, its icon, its placeholders and what
// each button does by default. Kept apart from src/island/bar.ts, which draws
// them, so the settings page can list them without the island's code.

import type { BarAct } from "./state";
import { t } from "./i18n";

/** A system element: its name, icon, placeholders and what each button does by default. */
export interface BarKind {
  name: string;
  icon: string;
  /** Placeholders its format may use besides {icon} and {value}, with what they show. */
  tokens: [string, string][];
  /** Its default second text (the «alt» click). */
  alt?: string;
  left: BarAct;
  middle: BarAct;
  right: BarAct;
  /** The wheel changes something (volume, brightness). */
  wheel?: boolean;
  /** Read by src-tauri/src/barsys.rs. */
  native?: boolean;
  /** Has a card in the island (src/views/barcard.ts, or a view of its own). */
  card?: boolean;
  /** Has a menu (src/island/bar.ts → barMenuOf). */
  menu?: boolean;
  /** Draws a small graph when asked (BarOpts.graph). */
  graph?: boolean;
  /** Its group in the catalog. */
  group?: "work";
}

/** The catalog's «Sistema» and «Lavoro» groups (Impostazioni → Barra fissa → + Aggiungi). */
export const BAR_KINDS: Record<string, BarKind> = {
  clock: {
    name: t("Orologio e data"), icon: "i:clock",
    tokens: [["time", t("ora")], ["date", t("data")], ["day", t("giorno della settimana")]],
    alt: "{icon} {date}", left: "alt", middle: "none", right: "card", card: true,
  },
  volume: {
    name: t("Volume"), icon: "i:volume", tokens: [["volume", t("volume")]],
    left: "card", middle: "mute", right: "menu", wheel: true, native: true, card: true, menu: true,
  },
  mic: {
    name: t("Microfono"), icon: "i:mic", tokens: [["mic", t("acceso o muto")]],
    left: "mute", middle: "none", right: "menu", native: true, card: true, menu: true,
  },
  brightness: {
    name: t("Luminosità"), icon: "i:sun", tokens: [["brightness", t("luminosità")]],
    left: "card", middle: "none", right: "none", wheel: true, native: true, card: true,
  },
  battery: {
    name: t("Batteria"), icon: "i:battery", tokens: [["battery", t("carica")], ["state", t("in carica o collegata")]],
    left: "card", middle: "none", right: "none", native: true, card: true,
  },
  net: {
    name: t("Velocità della rete"), icon: "i:network", tokens: [["down", t("in arrivo")], ["up", t("in uscita")]],
    left: "card", middle: "none", right: "none", native: true, card: true, graph: true,
  },
  cpu: {
    name: t("Processore (CPU)"), icon: "i:cpu", tokens: [["cpu", t("uso del processore")]],
    left: "menu", middle: "none", right: "none", native: true, menu: true, graph: true,
  },
  ram: {
    name: t("Memoria (RAM)"), icon: "i:memory", tokens: [["ram", t("memoria in uso, %")], ["used", t("in uso")], ["total", t("totale")]],
    alt: "{icon} {used} / {total}", left: "alt", middle: "none", right: "menu", native: true, menu: true, graph: true,
  },
  disk: {
    name: t("Disco"), icon: "i:hdd", tokens: [["free", t("spazio libero")], ["used", t("occupato, %")], ["drive", t("lettera del disco")]],
    left: "menu", middle: "none", right: "none", native: true, menu: true,
  },
  gpu: {
    name: t("Scheda video (GPU)"), icon: "i:gpu", tokens: [["gpu", t("uso della scheda video")]],
    left: "menu", middle: "none", right: "none", native: true, menu: true, graph: true,
  },
  lang: {
    name: t("Lingua della tastiera"), icon: "i:keyboard", tokens: [["code", t("sigla")], ["lang", t("nome della lingua")]],
    left: "menu", middle: "none", right: "none", native: true, menu: true,
  },
  recycle: {
    name: t("Cestino"), icon: "i:trash", tokens: [["count", t("elementi")], ["size", t("spazio occupato")]],
    left: "menu", middle: "none", right: "none", native: true, menu: true,
  },
  updates: {
    name: t("Aggiornamenti dei programmi"), icon: "i:download", tokens: [["count", t("aggiornamenti disponibili")]],
    left: "menu", middle: "none", right: "none", native: true, menu: true,
  },
  title: {
    // fgwin.rs follows the window in front while this is in the bar.
    name: t("Titolo della finestra in primo piano"), icon: "i:window", tokens: [["title", t("titolo")], ["app", t("programma")]],
    alt: "{icon} {app}", left: "alt", middle: "none", right: "none", native: true,
  },
  news: {
    // «Notizie» (src/views/news.ts): how many are new; the card is the island's Notizie view.
    name: t("Notizie"), icon: "i:globe", tokens: [["new", t("notizie nuove")], ["title", t("ultimo titolo")]],
    left: "card", middle: "none", right: "none", card: true,
  },
  power: {
    name: t("Menu di spegnimento"), icon: "i:power", tokens: [],
    left: "menu", middle: "none", right: "menu", menu: true,
  },
  // «Lavoro»: things of the island brought into the bar.
  appbar: {
    name: t("Barra dell'app in uso"), icon: "i:grid", tokens: [["app", t("programma")]],
    left: "none", middle: "none", right: "none", group: "work",
  },
  music: {
    name: t("Musica in riproduzione"), icon: "i:music", tokens: [["title", t("brano")], ["artist", t("artista")]],
    alt: "{icon} {artist}", left: "card", middle: "none", right: "none", card: true, wheel: true, group: "work",
  },
  weather: {
    name: t("Meteo"), icon: "i:sun", tokens: [["temp", t("temperatura")]],
    left: "card", middle: "none", right: "none", card: true, group: "work",
  },
  vscode: {
    name: t("Progetti recenti di VS Code"), icon: "i:code", tokens: [["name", t("ultimo progetto")]],
    left: "menu", middle: "none", right: "none", native: true, menu: true, group: "work",
  },
};

/** The kind of a system element ("sys:clock" → its BarKind). */
export function barKind(id: string): BarKind | null {
  return id.startsWith("sys:") ? BAR_KINDS[id.slice(4)] ?? null : null;
}
