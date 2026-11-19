// The customer's page: a page of the chat's memory (brain.rs) with
// "tipo: cliente" in its header and fixed sections, so what EasyIsland and the
// chat learn about a customer always lands in the same places. Not a phone book
// and not a store of its own (Edoardo, 19/11/2026: «forse direttamente nella
// memoria»): the .md stays the user's, readable and editable, found by the
// search, the Map and memory_search like every page.
//
// - Sections ("## Contatti" …): SECTIONS, in this order. «Note» is the last, so
//   a line added at the end (memory_learn.rs, add_line) lands there.
// - «Accessi» holds only references (the RDM/Devolutions folder or entry name),
//   never a password: tool_write passes every page through redact.rs anyway.
// - The card (card): the page split into its sections, found by title, alias
//   or the words of a name (Zammad's organization, 3CX's caller).
// - make: creates the page with the sections, or turns an existing page into a
//   customer's page by adding the header and the missing sections; it never
//   removes or moves what is there.

use crate::brain;
use crate::i18n::{t, tf};

/// The header's "tipo:" of a customer's page.
pub const KIND: &str = "cliente";

/// The sections of a customer's page, in order. Italian on purpose: they are
/// headings inside the user's own files, found by these words.
pub const SECTIONS: [&str; 6] = ["Contatti", "Rete", "Server e VM", "Accessi", "Procedure", "Note"];

#[derive(Debug, serde::Serialize, PartialEq)]
pub struct Section {
    pub name: String,
    pub text: String,
}

#[derive(Debug, serde::Serialize)]
pub struct ClientCard {
    pub title: String,
    pub summary: String,
    pub aliases: Vec<String>,
    /// "tipo: cliente": false for a page about the customer written before.
    pub client: bool,
    /// The text before the first section.
    pub intro: String,
    /// The fixed sections first (empty ones too, for a customer's page), then any other.
    pub sections: Vec<Section>,
    /// Pages it links to, and pages that link to it.
    pub links: Vec<String>,
    pub cited_by: Vec<String>,
    pub updated: String,
}

/// What memory_page adds under a customer's page, for the engine that rewrites it.
pub fn writing_hint() -> String {
    tf(
        "Pagina cliente: riscrivila tenendo «tipo: cliente» e le sezioni {list} in quest'ordine; ogni fatto nella sua sezione, una riga con la data. In «Accessi» solo il nome della cartella o della voce di RDM/Devolutions, mai password.",
        &[("list", &SECTIONS.iter().map(|s| format!("## {s}")).collect::<Vec<_>>().join(", "))],
    )
}

/// "Studio Rossi", "studio rossi srl" → the same: folded words.
fn words(s: &str) -> Vec<String> {
    brain::fold(&s.replace('.', "")).split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_string).collect()
}

/// Legal forms that do not tell customers apart.
const FORMS: [&str; 10] = ["srl", "srls", "spa", "sas", "snc", "sa", "di", "e", "studio", "ditta"];

/// The page of a customer named `name`: same title or alias (legal form
/// aside), else the page whose names hold every word that matters.
pub fn find_page(name: &str) -> Option<brain::Page> {
    let want: Vec<String> = words(name).into_iter().filter(|w| !FORMS.contains(&w.as_str())).collect();
    if want.is_empty() {
        return None;
    }
    let all = brain::pages();
    let names = |p: &brain::Page| -> Vec<Vec<String>> {
        std::iter::once(&p.title).chain(p.aliases.iter()).map(|n| words(n).into_iter().filter(|w| !FORMS.contains(&w.as_str())).collect()).collect()
    };
    // Same name first, customer's pages before others.
    let mut exact: Vec<&brain::Page> = all.iter().filter(|p| names(p).iter().any(|n| *n == want)).collect();
    exact.sort_by_key(|p| p.kind != KIND);
    if let Some(p) = exact.first() {
        return Some((*p).clone());
    }
    let mut holding: Vec<&brain::Page> = all
        .iter()
        .filter(|p| names(p).iter().any(|n| want.iter().all(|w| n.contains(w))))
        .collect();
    holding.sort_by_key(|p| p.kind != KIND);
    holding.first().map(|p| (*p).clone())
}

/// The body split at its "## " headings: (text before, sections in file order).
fn split(body: &str) -> (String, Vec<Section>) {
    let mut intro = String::new();
    let mut out: Vec<Section> = Vec::new();
    for line in body.lines() {
        if let Some(h) = line.trim_start().strip_prefix("## ") {
            out.push(Section { name: h.trim().to_string(), text: String::new() });
            continue;
        }
        let target = match out.last_mut() {
            Some(s) => &mut s.text,
            None => &mut intro,
        };
        target.push_str(line);
        target.push('\n');
    }
    for s in &mut out {
        s.text = s.text.trim().to_string();
    }
    (intro.trim().to_string(), out)
}

/// The fixed sections in order (empty ones when the page is a customer's), then the others.
fn ordered(found: Vec<Section>, client: bool) -> Vec<Section> {
    let mut out: Vec<Section> = Vec::new();
    for name in SECTIONS {
        let text = found.iter().filter(|s| s.name.eq_ignore_ascii_case(name)).map(|s| s.text.as_str()).filter(|t| !t.is_empty()).collect::<Vec<_>>().join("\n");
        if client || !text.is_empty() {
            out.push(Section { name: name.to_string(), text });
        }
    }
    out.extend(found.into_iter().filter(|s| !SECTIONS.iter().any(|n| s.name.eq_ignore_ascii_case(n))));
    out
}

/// The card of the customer named `name`, if the memory has a page for it.
pub fn card(name: &str) -> Option<ClientCard> {
    let page = find_page(name)?;
    let all = brain::pages();
    let client = page.kind == KIND;
    let (intro, found) = split(&page.body);
    let mut links: Vec<String> = Vec::new();
    for l in &page.links {
        if !links.contains(&l.target) {
            links.push(l.target.clone());
        }
    }
    Some(ClientCard {
        cited_by: brain::backlinks(&page.title, &all),
        title: page.title,
        summary: page.summary,
        aliases: page.aliases,
        client,
        intro,
        sections: ordered(found, client),
        links,
        updated: page.updated,
    })
}

/// The body of a customer's page: `body` kept whole, the missing sections added
/// at the end (before «Note» when that is already there), `extra` lines put in
/// their section when it is new or does not have them yet.
fn with_sections(body: &str, extra: &[(&str, String)]) -> String {
    let (intro, found) = split(body);
    let mut out = String::new();
    if !intro.is_empty() {
        out.push_str(&intro);
        out.push_str("\n\n");
    }
    let mut sections: Vec<Section> = found;
    for name in SECTIONS {
        if !sections.iter().any(|s| s.name.eq_ignore_ascii_case(name)) {
            sections.push(Section { name: name.to_string(), text: String::new() });
        }
    }
    // «Note» last, so a line added at the end of the page lands there.
    if let Some(i) = sections.iter().position(|s| s.name.eq_ignore_ascii_case("Note")) {
        let note = sections.remove(i);
        sections.push(note);
    }
    for s in &mut sections {
        for (name, line) in extra {
            let line = line.trim();
            if s.name.eq_ignore_ascii_case(name) && !line.is_empty() && !brain::fold(&s.text).contains(&brain::fold(line.trim_start_matches("- "))) {
                if !s.text.is_empty() {
                    s.text.push('\n');
                }
                s.text.push_str(&format!("- {}", line.trim_start_matches("- ")));
            }
        }
    }
    for s in &sections {
        out.push_str(&format!("## {}\n", s.name));
        if !s.text.is_empty() {
            out.push_str(&s.text);
            out.push('\n');
        }
        out.push('\n');
    }
    out.trim_end().to_string()
}

/// «Crea la pagina cliente» (or «Rendila pagina cliente»): the page of `name`
/// with the sections; `contacts` and `access` lines (from Zammad, 3CX, the RDM
/// folder tied to it) go in their sections. Returns the page's title.
pub fn make(name: &str, aliases: &[String], contacts: &[String], access: &[String]) -> Result<String, String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(t("Scrivi il nome del cliente.").into());
    }
    let extra: Vec<(&str, String)> = contacts.iter().map(|c| ("Contatti", c.clone())).chain(access.iter().map(|a| ("Accessi", a.clone()))).collect();
    let existing = find_page(&name).and_then(|p| brain::find(&p.title));
    let (title, version, body, mut names) = match &existing {
        Some((page, text)) => (page.title.clone(), brain::version(text), page.body.clone(), page.aliases.clone()),
        None => (name.clone(), String::new(), String::new(), Vec::new()),
    };
    for a in aliases.iter().map(|a| a.split_whitespace().collect::<Vec<_>>().join(" ")) {
        if !a.is_empty() && brain::fold(&a) != brain::fold(&title) && !names.iter().any(|n| brain::fold(n) == brain::fold(&a)) {
            names.push(a);
        }
    }
    let mut text = format!("tipo: {KIND}\n");
    if !names.is_empty() {
        text.push_str(&format!("alias: {}\n", names.join(", ")));
    }
    text.push_str(&with_sections(&body, &extra));
    brain::tool_write(&title, &text, &version, "EasyIsland")?;
    Ok(title)
}

/// Every customer's page, by title (for the search and the chat).
pub fn list() -> Vec<String> {
    let mut out: Vec<String> = brain::pages().into_iter().filter(|p| p.kind == KIND).map(|p| p.title).collect();
    out.sort_by_key(|t| brain::fold(t));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sections_are_added_never_removed() {
        let body = "Farmacia in centro.\n\n## Rete\n- 192.168.10.0/24\n\n## Note\n- 12/11 cambiato router\n\n## Fornitori\n- Rossi";
        let out = with_sections(body, &[("Contatti", "Anna, 0471 123456".into()), ("Rete", "192.168.10.0/24".into())]);
        assert!(out.starts_with("Farmacia in centro.\n\n## Rete\n- 192.168.10.0/24\n"));
        assert!(out.contains("## Fornitori\n- Rossi"));
        assert!(out.contains("## Contatti\n- Anna, 0471 123456"));
        // Already there: not added twice.
        assert_eq!(out.matches("192.168.10.0/24").count(), 1);
        // «Note» is the last section, its line kept.
        assert!(out.ends_with("## Note\n- 12/11 cambiato router"));
        for s in SECTIONS {
            assert!(out.contains(&format!("## {s}")), "{s}");
        }
    }

    #[test]
    fn the_card_puts_the_fixed_sections_first() {
        let (intro, found) = split("Intro\n## Altro\nx\n## Accessi\n- cartella RDM: Easytech\\Falchi\n## Rete\nr");
        assert_eq!(intro, "Intro");
        let out = ordered(found, true);
        let names: Vec<&str> = out.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["Contatti", "Rete", "Server e VM", "Accessi", "Procedure", "Note", "Altro"]);
        assert_eq!(out[3].text, "- cartella RDM: Easytech\\Falchi");
        // Not a customer's page: only the sections it has.
        let (_, found) = split("## Rete\nr\n## Altro\nx");
        assert_eq!(ordered(found, false).iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), vec!["Rete", "Altro"]);
    }

    #[test]
    fn names_match_without_the_legal_form() {
        let w = |s: &str| words(s).into_iter().filter(|w| !FORMS.contains(&w.as_str())).collect::<Vec<_>>();
        assert_eq!(w("Studio Rossi S.r.l."), vec!["rossi"]);
        assert_eq!(w("Rossi SRL"), vec!["rossi"]);
        assert_eq!(w("FARMACIA FALCHI"), w("Farmacia Falchi"));
    }
}
