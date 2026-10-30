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
}

/** The catalog's «Sistema» group (Impostazioni → Barra fissa → + Aggiungi). */
export const BAR_KINDS: Record<string, BarKind> = {
  clock: {
    name: t("Orologio e data"), icon: "i:clock",
    tokens: [["time", t("ora")], ["date", t("data")], ["day", t("giorno della settimana")]],
    alt: "{icon} {date}", left: "alt", middle: "none", right: "card",
  },
  volume: {
    name: t("Volume"), icon: "i:volume", tokens: [["volume", t("volume")]],
    left: "card", middle: "mute", right: "menu", wheel: true, native: true,
  },
  mic: {
    name: t("Microfono"), icon: "i:mic", tokens: [["mic", t("acceso o muto")]],
    left: "mute", middle: "none", right: "menu", native: true,
  },
  brightness: {
    name: t("Luminosità"), icon: "i:sun", tokens: [["brightness", t("luminosità")]],
    left: "card", middle: "none", right: "none", wheel: true, native: true,
  },
  battery: {
    name: t("Batteria"), icon: "i:battery", tokens: [["battery", t("carica")], ["state", t("in carica o collegata")]],
    left: "card", middle: "none", right: "none", native: true,
  },
  net: {
    name: t("Velocità della rete"), icon: "i:network", tokens: [["down", t("in arrivo")], ["up", t("in uscita")]],
    left: "card", middle: "none", right: "none", native: true,
  },
  power: {
    name: t("Menu di spegnimento"), icon: "i:power", tokens: [],
    left: "menu", middle: "none", right: "menu",
  },
};

/** The kind of a system element ("sys:clock" → its BarKind). */
export function barKind(id: string): BarKind | null {
  return id.startsWith("sys:") ? BAR_KINDS[id.slice(4)] ?? null : null;
}
