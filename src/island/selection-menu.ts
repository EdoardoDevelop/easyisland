// The menu on the selected text: a shortcut (Win+Alt+A by default) opens a
// native Windows menu at the mouse, over any app — browsers included, where
// EasyIsland cannot add to the app's own right-click menu. It lists the user's
// own quick actions on the selected text (nothing built in), their folders as
// submenus. The selection is copied first (while the app still has the focus),
// so the menu shows what it works on. An action set to "replace" takes the
// selection's place after a preview (rewrite.ts); the others ask the chat.
// The menu itself is drawn by Rust (tray.rs `popup_entries`); a click comes
// back as the "tray" event "sel:<id>". Each entry carries its icon, drawn
// here on a canvas (our stroked icons in the action's colour, or the old emoji).

import { t } from "../core/i18n";
import { looksLikeHost } from "../views/rdm";
import { State, folderLook, type QuickAction } from "../core/state";
import { actionIcon, isPictureIcon } from "../views/action-icons";

/** A small picture for a menu line, as Rust wants it (tray.rs `MenuIcon`). */
export interface MenuIcon {
  rgba: number[];
  width: number;
  height: number;
}

export interface MenuEntry {
  /** "" = a separator. */
  id: string;
  label: string;
  enabled?: boolean;
  /** A submenu (a folder of actions). */
  items?: MenuEntry[];
  icon?: MenuIcon;
}

/** Windows draws menu icons 16 px wide at 100 % scale. */
const ICON_PX = 16;
const pictures = new Map<string, HTMLImageElement>();

/** The icon an action or a folder stores ("i:<name>" or an emoji), as pixels. */
export function menuIcon(value: string | undefined, color: string): MenuIcon | undefined {
  const size = Math.round(ICON_PX * Math.max(1, window.devicePixelRatio || 1));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return undefined;
  if (isPictureIcon(value)) {
    // A program's or site's picture: drawn once it is decoded, nothing until then.
    const img = pictures.get(value) ?? Object.assign(new Image(), { src: value });
    pictures.set(value, img);
    if (!img.complete || !img.naturalWidth) return undefined;
    g.drawImage(img, 0, 0, size, size);
    return { rgba: Array.from(g.getImageData(0, 0, size, size).data), width: size, height: size };
  }
  const icon = actionIcon(value);
  if (icon) {
    g.scale(size / 24, size / 24);
    g.strokeStyle = /^#[0-9a-f]{6}$/i.test(color) ? color : "#8e939c";
    g.lineWidth = 2.2;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.stroke(new Path2D(icon.d));
  } else {
    const text = (value ?? "").trim();
    if (!text) return undefined;
    g.font = `${Math.round(size * 0.82)}px "Segoe UI Emoji", "Segoe UI", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.fillText(text, size / 2, size / 2 + size * 0.05);
  }
  return { rgba: Array.from(g.getImageData(0, 0, size, size).data), width: size, height: size };
}

export interface SelectionMenu {
  entries: MenuEntry[];
  /** The action behind each entry id; "settings" opens Impostazioni → Azioni rapide;
   *  "remember" opens «Ricorda»; "notion-note" / "notion-task" send the text to Notion (notion.rs). */
  picks: Map<string, QuickAction | "settings" | "remember" | "notion-note" | "notion-task" | "rdm-find" | "rdm-rdp" | "rdm-ssh">;
}

/** The quick actions the menu offers: the prompts applied to the selected text. */
export function selectionActions(): QuickAction[] {
  return (State.settings.actions ?? []).filter((a) => a.kind === "prompt" && a.input === "selection" && !a.barOnly);
}

/** The first words of the selection, on one line, for the menu's heading. */
export function snippet(text: string, max = 48): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

export function buildSelectionMenu(text: string): SelectionMenu {
  const picks = new Map<string, QuickAction | "settings" | "remember" | "notion-note" | "notion-task" | "rdm-find" | "rdm-rdp" | "rdm-ssh">();
  const entries: MenuEntry[] = [{ id: "head", label: `«${snippet(text)}»`, enabled: false }, { id: "", label: "" }];
  // «Ricorda questo» (src/views/remember.ts): the one entry of EasyIsland's own, chosen by Edoardo on 31 Oct 2026.
  const remember: MenuEntry[] = [{ id: "", label: "" }, { id: "remember", label: t("Ricorda questo") }];
  picks.set("remember", "remember");
  const actions = selectionActions();
  // Notion, when chosen in the settings: the text as a note, or as a task.
  const c = State.settings.integrationConfig;
  const notion: MenuEntry[] = [];
  if (State.settings.activeIntegrations.includes("integration_notion")) {
    if (c.notionInbox) { notion.push({ id: "notion-note", label: t("Nota in Notion ({p})", { p: c.notionInbox.title }) }); picks.set("notion-note", "notion-note"); }
    if (c.notionTasks) { notion.push({ id: "notion-task", label: t("Attività in Notion ({p})", { p: c.notionTasks.title }) }); picks.set("notion-task", "notion-task"); }
  }
  // Remote Desktop Manager: the words searched among the connections; a host connected to.
  if (State.settings.activeIntegrations.includes("integration_rdm") && text.trim().length <= 120) {
    notion.push({ id: "rdm-find", label: t("Cerca in Remote Desktop Manager") });
    picks.set("rdm-find", "rdm-find");
    if (looksLikeHost(text)) {
      notion.push({ id: "rdm-rdp", label: t("Connetti con RDP a {h}", { h: text.trim() }) }, { id: "rdm-ssh", label: t("Connetti con SSH a {h}", { h: text.trim() }) });
      picks.set("rdm-rdp", "rdm-rdp");
      picks.set("rdm-ssh", "rdm-ssh");
    }
  }
  const withNotion = () => (notion.length ? [{ id: "", label: "" }, ...notion] : []);
  if (!actions.length) {
    entries.push({ id: "settings", label: t("Crea le azioni sul testo selezionato…") });
    picks.set("settings", "settings");
    entries.push(...withNotion(), ...remember);
    return { entries, picks };
  }
  const entry = (a: QuickAction): MenuEntry => {
    const id = `a:${a.id}`;
    picks.set(id, a);
    return { id, label: a.name || t("Senza nome"), icon: menuIcon(a.icon, a.color) };
  };
  // Folders first, as in the ⚡ tab, then the actions without one.
  const folders = [...new Set(actions.map((a) => folderLook(a.folder).name).filter(Boolean))];
  for (const f of folders) {
    const inside = actions.filter((a) => folderLook(a.folder).name === f);
    // The folder's icon is the one of its first action's folder, as in the ⚡ tab.
    const look = folderLook(inside[0].folder);
    entries.push({ id: `f:${f}`, label: f, icon: menuIcon(look.icon, "#94a3b8"), items: inside.map(entry) });
  }
  for (const a of actions.filter((x) => !folderLook(x.folder).name)) entries.push(entry(a));
  entries.push(...withNotion(), ...remember);
  return { entries, picks };
}
