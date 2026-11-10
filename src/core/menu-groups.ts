// Groups of the island's menu (Edoardo, 10 Nov 2026: «trascini l'icona sopra
// un'altra e crea la cartella, come su un telefono»). A group is a name and the
// ids of its integrations, in `settings.menuGroups` (per profile, like the
// order). It stands in the menu where its first integration would; an
// integration in no group stands alone. Only the menu: Panoramica and the
// fixed bar show integrations as before.

import { State, type MenuGroup } from "./state";
import { Bridge } from "./bridge";
import { t } from "./i18n";

export function groups(): MenuGroup[] {
  return State.settings.menuGroups ?? [];
}

export function groupOf(taskId: string): MenuGroup | undefined {
  return groups().find((g) => g.items.includes(taskId));
}

function save() {
  // Groups left with no integration go.
  State.settings.menuGroups = groups().filter((g) => g.items.length > 0);
  void Bridge.saveSettings(State.settings);
  State.notify();
}

/** «Gruppo», «Gruppo 2»…: a name not taken yet. */
function freshName(): string {
  const taken = new Set(groups().map((g) => g.name));
  const base = t("Gruppo");
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/**
 * `dragged` let go on `onto`: into its group, or a new group of the two, open,
 * where `onto` was. Returns the new group's id ("" when it went into one that existed).
 */
export function mergeInto(onto: string, dragged: string): string {
  if (onto === dragged) return "";
  for (const g of groups()) g.items = g.items.filter((x) => x !== dragged);
  const there = groupOf(onto);
  if (there) {
    there.items.splice(there.items.indexOf(onto) + 1, 0, dragged);
    there.open = true;
    save();
    return "";
  }
  const g: MenuGroup = { id: `g${Date.now().toString(36)}`, name: freshName(), items: [onto, dragged], open: true };
  State.settings.menuGroups = [...groups(), g];
  save();
  return g.id;
}

/** Dropped on a group's row: at its end. */
export function addTo(groupId: string, taskId: string) {
  const g = groups().find((x) => x.id === groupId);
  if (!g || g.items.includes(taskId)) return;
  for (const o of groups()) o.items = o.items.filter((x) => x !== taskId);
  g.items.push(taskId);
  save();
}

export function removeFrom(taskId: string) {
  for (const g of groups()) g.items = g.items.filter((x) => x !== taskId);
  save();
}

export function rename(groupId: string, name: string) {
  const g = groups().find((x) => x.id === groupId);
  const clean = name.trim().slice(0, 40);
  if (!g || !clean) return;
  g.name = clean;
  save();
}

/** The colours offered in the island (the ones its integrations and sections use). */
export const GROUP_COLORS: { color: string; name: string }[] = [
  { color: "#f5a524", name: "Giallo" },
  { color: "#fb923c", name: "Arancione" },
  { color: "#f4505e", name: "Rosso" },
  { color: "#ec4899", name: "Rosa" },
  { color: "#a78bfa", name: "Viola" },
  { color: "#4c8dff", name: "Blu" },
  { color: "#38bdf8", name: "Azzurro" },
  { color: "#22c55e", name: "Verde" },
  { color: "#8e939c", name: "Grigio" },
];

/** The folder's colour; "" back to yellow. */
export function setColor(groupId: string, color: string) {
  const g = groups().find((x) => x.id === groupId);
  if (!g) return;
  if (/^#[0-9a-f]{6}$/i.test(color)) g.color = color.toLowerCase();
  else delete g.color;
  save();
}

/** The group goes, its integrations stay in the menu where they were. */
export function dissolve(groupId: string) {
  State.settings.menuGroups = groups().filter((g) => g.id !== groupId);
  save();
}

export function toggle(groupId: string) {
  const g = groups().find((x) => x.id === groupId);
  if (!g) return;
  g.open = !g.open;
  save();
}

/**
 * After a drag in the menu: each group's integrations in the order they now
 * have. `shown`: the ones in the menu; a group keeps those that are not (an
 * integration turned off comes back in its group).
 */
export function setMembers(members: Record<string, string[]>, shown: Set<string>) {
  for (const g of groups()) {
    if (members[g.id]) g.items = [...members[g.id], ...g.items.filter((x) => !shown.has(x))];
  }
  // An integration listed under two groups (should not happen): the first keeps it.
  const seen = new Set<string>();
  for (const g of groups()) g.items = g.items.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
  save();
}
