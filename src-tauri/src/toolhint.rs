// Strumenti in anticipo (13 Nov 2026). Claude Code keeps EasyIsland's tools
// behind ToolSearch: every search is one more step, and every step re-reads
// the whole conversation (on the laptop, 161 ToolSearch steps in two weeks,
// ~13M tokens). EasyIsland reads the question with fixed rules, no model, and
// names the tools it will likely need with the one ToolSearch that loads them
// all at once. Words of any trade, never a site or a customer: what the user
// asks about (a quote, a remote PC, a password), not who.

/// (words to look for, at the start of a word; tools they call for)
const GROUPS: &[(&[&str], &[&str])] = &[
    // Quotes, products, prices.
    (&["preventiv", "offert", "prezz", "listino", "prodott", "disponibil", "fornitor", "portal", "ricarico", "quotazion"],
     &["portal_list", "portal_search", "preview_extract", "document_templates", "document_create", "preview_save_images"]),
    // Documents.
    (&["ddt", "documento", "documenti", "word", "docx", "pdf", "fattur", "modell"],
     &["document_read", "document_templates", "document_create", "document_pdf", "pdf_merge", "pdf_split", "list_uploaded_files"]),
    // Notion.
    (&["notion", "database", "scadenz"],
     &["notion_map", "notion_search", "notion_query", "notion_read", "notion_add_row", "notion_update_row"]),
    // The user's own integrations.
    (&["integrazion", "campo", "campi", "scheda", "cruscott", "modulo"],
     &["custom_list", "custom_get", "custom_update", "custom_records", "custom_add_record", "custom_preview"]),
    // Passwords and connections.
    (&["password", "credenzial", "devolutions", "rdm", "vault", "connession"],
     &["rdm_search", "dvc_vaults", "dvc_entries", "dvc_show"]),
    // A PC to look at: this one or another of the network.
    (&["winrm", "remot", "lent", "blocc", "wifi", "wi-fi", "rete", "dns", "raggiung", "ping", "stampant", "eventi", "avvio", "disco", "servizi", "dominio", "diagnos"],
     &["pc_check", "remote_status", "remote_run"]),
    // Microsoft To Do.
    (&["to do", "todo", "promemoria", "ricordami di"],
     &["todo_list", "todo_add", "todo_update"]),
    // Web pages.
    (&["sito", "pagina", "anteprima", "http", "www."],
     &["preview_open", "preview_find", "preview_extract", "preview_steps", "preview_snapshot"]),
    // Files the user gave.
    (&["vassoio", "allegat", "immagin", "foto"],
     &["list_uploaded_files", "add_to_tray", "document_read"]),
    // Things that run by themselves.
    (&["ogni giorno", "ogni mattina", "ogni sera", "ogni settimana", "automazion", "compito"],
     &["list_automations", "create_automation", "task_create", "task_list"]),
    (&["agent chat"],
     &["agentchat_read", "agentchat_send", "agentchat_topic"]),
];

const MAX_TOOLS: usize = 10;

/// The tools a question calls for, in the order of the groups, without repeats.
fn tools_for(question: &str) -> Vec<&'static str> {
    let low = question.to_lowercase();
    // Word starts only: "rete" in "rete", "reti", not in "interessante".
    let starts: Vec<usize> = std::iter::once(0)
        .chain(low.char_indices().filter(|(_, c)| !c.is_alphanumeric()).map(|(i, c)| i + c.len_utf8()))
        .collect();
    let has = |w: &str| starts.iter().any(|&i| low.get(i..).is_some_and(|rest| rest.starts_with(w)));
    let mut out: Vec<&'static str> = Vec::new();
    for (words, tools) in GROUPS {
        if words.iter().any(|w| has(w)) {
            for t in tools.iter() {
                if !out.contains(t) {
                    out.push(t);
                }
            }
        }
    }
    out.truncate(MAX_TOOLS);
    out
}

/// The line in front of the question, or None when no rule fits.
pub fn hint(question: &str) -> Option<String> {
    let tools = tools_for(question);
    if tools.is_empty() {
        return None;
    }
    let prefix = format!("{}__", crate::claude_cli::tool_prefix("easyisland"));
    let select: Vec<String> = tools.iter().map(|t| format!("{prefix}{t}")).collect();
    Some(crate::i18n::tf(
        "[Strumenti di EasyIsland che probabilmente servono: {names}. Se ti servono e non li hai già, caricali tutti insieme con una sola ToolSearch «select:{select}».]\n\n",
        &[("names", &tools.join(", ")), ("select", &select.join(","))],
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quote_calls_for_the_portals_and_the_documents() {
        let t = tools_for("Fammi un preventivo per 3 access point");
        assert!(t.contains(&"portal_search"));
        assert!(t.contains(&"document_create"));
        assert!(t.len() <= MAX_TOOLS);
    }

    #[test]
    fn words_only_at_their_start() {
        assert!(tools_for("è interessante").is_empty());
        assert!(tools_for("la rete va lenta").contains(&"pc_check"));
        assert!(tools_for("ciao, come stai?").is_empty());
    }

    #[test]
    fn the_hint_loads_them_in_one_search() {
        let h = hint("controlla la wifi del pc remoto").unwrap();
        assert!(h.contains("select:mcp__easyisland__pc_check,mcp__easyisland__remote_status"));
    }
}
