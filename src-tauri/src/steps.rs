// The chat's step lines ("> ⚙ Cerca nella memoria · `fatture Rossi`") for
// EasyIsland's own tools and the other MCP tools, in words instead of tool
// names. Every engine uses them (claude_cli.rs, opencode.rs, claude.rs,
// antigravity.rs), so the island and Telegram show the same lines.

use crate::i18n::t;
use serde_json::Value;

/// What an EasyIsland tool does, as the user reads it.
fn phrase(tool: &str) -> Option<&'static str> {
    Some(match tool {
        "get_foreground_app" => t("Guarda quale programma è in primo piano"),
        "list_status" => t("Legge lo stato del PC e dei servizi"),
        "list_quick_actions" => t("Guarda le azioni rapide"),
        "run_quick_action" => t("Esegue un'azione rapida"),
        "open_app" => t("Apre un programma"),
        "open_url" => t("Apre un link"),
        "read_clipboard" => t("Legge gli appunti"),
        "write_clipboard" => t("Copia negli appunti"),
        "show_notice" => t("Mostra un avviso nell'isola"),
        "show_card" => t("Mostra una scheda nell'isola"),
        "add_to_tray" => t("Mette un file nel Vassoio"),
        "list_work_folder" => t("Guarda la cartella di lavoro"),
        "move_to_work_folder" => t("Sposta un file nella cartella di lavoro"),
        "media_status" => t("Guarda cosa sta suonando"),
        "media_control" => t("Comanda la musica"),
        "list_uploaded_files" => t("Guarda i file ricevuti"),
        "notion_map" => t("Legge la struttura di Notion"),
        "notion_search" => t("Cerca in Notion"),
        "notion_read" => t("Legge una pagina di Notion"),
        "notion_query" => t("Legge le righe di un database di Notion"),
        "notion_add_row" => t("Aggiunge una riga in Notion"),
        "notion_update_row" => t("Aggiorna una riga in Notion"),
        "notion_delete_row" => t("Mette una riga di Notion nel cestino"),
        "remote_status" => t("Controlla il PC remoto"),
        "remote_run" => t("Esegue un comando sul PC remoto"),
        "memory_search" => t("Cerca nella memoria"),
        "memory_note" => t("Si annota qualcosa nella memoria"),
        "memory_page" => t("Legge una pagina della memoria"),
        "memory_page_write" => t("Scrive una pagina della memoria"),
        "memory_inbox" => t("Guarda le fonti da leggere"),
        "memory_inbox_done" => t("Segna una fonte come letta"),
        "memory_check" => t("Controlla la memoria"),
        "memory_forget" => t("Toglie un ricordo"),
        "todo_list" => t("Legge le attività di To Do"),
        "todo_add" => t("Aggiunge un'attività a To Do"),
        "todo_update" => t("Aggiorna un'attività di To Do"),
        "list_profiles" => t("Guarda i profili"),
        "switch_profile" => t("Cambia profilo"),
        "list_automations" => t("Guarda le automazioni"),
        "create_automation" => t("Crea un'automazione"),
        "set_automation_enabled" => t("Accende o spegne un'automazione"),
        "get_settings" => t("Legge le impostazioni"),
        "set_setting" => t("Cambia un'impostazione"),
        "task_create" => t("Crea un compito"),
        "task_list" => t("Guarda i compiti"),
        "task_plan" => t("Prepara il piano del compito"),
        "task_step" => t("Segna un passo del compito come fatto"),
        "task_note" => t("Prende nota per il compito"),
        "task_ask" => t("Ti fa una domanda sul compito"),
        "task_done" => t("Chiude il compito"),
        "task_delegate" => t("Affida una parte del lavoro a un altro motore"),
        "skill_list" => t("Guarda le abilità"),
        "skill_read" => t("Legge un'abilità"),
        "skill_save" => t("Salva un'abilità"),
        "custom_create" => t("Crea un'integrazione personale"),
        "custom_update" => t("Modifica un'integrazione personale"),
        "custom_list" => t("Guarda le integrazioni personali"),
        "custom_get" => t("Legge un'integrazione personale"),
        "custom_records" => t("Legge i dati di un'integrazione"),
        "custom_fetch" => t("Aggiorna i dati di un'integrazione"),
        "custom_call" => t("Usa un'integrazione personale"),
        "custom_add_record" => t("Aggiunge un dato a un'integrazione"),
        "preview_open" => t("Apre nell'Anteprima"),
        "preview_read" => t("Legge l'Anteprima"),
        "preview_snapshot" => t("Guarda la pagina nell'Anteprima"),
        "preview_wait" => t("Aspetta che la pagina sia pronta"),
        "preview_network" => t("Controlla le richieste della pagina"),
        "preview_screenshot" => t("Fotografa l'Anteprima"),
        "preview_console" => t("Legge la console della pagina"),
        "preview_resize" => t("Cambia le misure dell'Anteprima"),
        "preview_click" => t("Clicca nella pagina"),
        "preview_type" => t("Scrive nella pagina"),
        _ => return None,
    })
}

/// The argument that says on what: a title, a search, a name…
fn subject(input: &Value) -> String {
    const KEYS: [&str; 14] = ["title", "name", "query", "target", "question", "text", "note", "prompt", "url", "path", "app", "key", "engine", "result"];
    let found = KEYS.iter().find_map(|k| input.get(*k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()));
    let first = found.unwrap_or_default().lines().next().unwrap_or_default();
    let mut out: String = first.chars().take(80).collect();
    if first.chars().count() > 80 {
        out.push('…');
    }
    out.replace('`', "'")
}

fn line(label: &str, what: &str) -> String {
    if what.is_empty() { format!("> ⚙ {label}") } else { format!("> ⚙ {label} · `{what}`") }
}

/// The step line of an MCP tool (`server` as the engine names it, "" when
/// unknown). EasyIsland's in words; any other as its name, its server and
/// what it was asked.
pub fn mcp(server: &str, tool: &str, input: &Value) -> String {
    let what = subject(input);
    if let Some(p) = phrase(tool).filter(|_| server.is_empty() || server.eq_ignore_ascii_case("easyisland")) {
        return line(p, &what);
    }
    let name = tool.replace(['_', '-'], " ");
    let label = if server.is_empty() { name } else { format!("{name} ({server})") };
    line(&label, &what)
}

/// Loading the tools' descriptions (Claude Code's ToolSearch): not a step the user cares about.
pub fn loading_tools() -> String {
    line(t("Prepara gli strumenti"), "")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn words_for_tools() {
        assert_eq!(mcp("easyisland", "memory_search", &json!({ "query": "fatture Rossi" })), "> ⚙ Cerca nella memoria · `fatture Rossi`");
        assert_eq!(mcp("easyisland", "task_step", &json!({ "index": 2, "done": true })), "> ⚙ Segna un passo del compito come fatto");
        assert_eq!(mcp("Notion notion", "notion-search", &json!({ "query": "verbali" })), "> ⚙ notion search (Notion notion) · `verbali`");
        let long = "a".repeat(100);
        assert!(mcp("", "skill_read", &json!({ "name": long })).ends_with("…`"));
    }
}
