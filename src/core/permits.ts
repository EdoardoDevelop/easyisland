// Permessi per livelli (src-tauri/src/permits.rs, docs/chat.md): the reversible
// tools in the user's words, for the card's «Consenti sempre», Impostazioni →
// Chat and what a task may do by itself. Which tools are reversible is decided
// in Rust (hook/src/tool_list.rs `REVERSIBLE`); this only names them.

import { t } from "./i18n";

const NAMES: Record<string, string> = {
  notion_add_row: t("Aggiungere righe a Notion"),
  notion_update_row: t("Cambiare righe di Notion"),
  todo_add: t("Aggiungere attività a To Do"),
  todo_update: t("Cambiare attività di To Do"),
  add_to_tray: t("Mettere file nel Vassoio"),
  move_to_work_folder: t("Spostare file dal Vassoio alla cartella di lavoro"),
};

/** A tool of EasyIsland in words; unknown ones keep their name. */
export function toolWords(tool: string): string {
  return NAMES[tool] ?? tool;
}

/** The reversible tools, in the order they are offered. */
export const REVERSIBLE_TOOLS = Object.keys(NAMES);

export const isReversible = (tool: string) => tool in NAMES;
