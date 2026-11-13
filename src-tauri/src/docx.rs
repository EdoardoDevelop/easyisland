// Word documents for the chat (docs/chat.md → Documenti Word e PDF): read a
// .docx as Markdown, fill the user's templates, write new ones, and turn them
// into PDF with Word when Word is there. A .docx is a ZIP of XML (ooxzip.rs):
// no new dependency, no program to install.
//
// Rules: every write is a new file (never over the original, never over a
// template), in the Vassoio and in the work folder or the folder asked for.
// The user's templates are copies in %APPDATA%\EasyIsland\documenti\modelli,
// never changed. Totals, VAT and the progressive number are computed here,
// never by the engine.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use serde_json::Value;

// ---------------------------------------------------------------- XML basics

pub(crate) fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            // Control characters are not allowed in XML 1.0.
            c if (c as u32) < 0x20 && c != '\t' && c != '\n' && c != '\r' => {}
            c => out.push(c),
        }
    }
    out
}

pub(crate) fn unescape(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(rest.get(..i).unwrap_or_default());
        let after = rest.get(i + 1..).unwrap_or_default();
        let Some(end) = after.find(';').filter(|e| *e <= 10) else {
            out.push('&');
            rest = after;
            continue;
        };
        let name = after.get(..end).unwrap_or_default();
        let c = match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            n if n.starts_with("#x") || n.starts_with("#X") => u32::from_str_radix(n.get(2..).unwrap_or_default(), 16).ok().and_then(char::from_u32),
            n if n.starts_with('#') => n.get(1..).unwrap_or_default().parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match c {
            Some(c) => {
                out.push(c);
                rest = after.get(end + 1..).unwrap_or_default();
            }
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Kind {
    Open,
    Close,
    Empty,
}

/// A tag of the XML: its name, kind and where it is.
#[derive(Debug, Clone, Copy)]
struct Tag<'a> {
    name: &'a str,
    kind: Kind,
    start: usize,
    end: usize,
    raw: &'a str,
}

/// The tags of an XML text, in order (comments, declarations and CDATA skipped).
fn tags(xml: &str) -> Vec<Tag<'_>> {
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(i) = xml.get(at..).and_then(|r| r.find('<')) {
        let start = at + i;
        let rest = xml.get(start..).unwrap_or_default();
        let skip_to = |end: &str| rest.find(end).map(|e| start + e + end.len());
        if rest.starts_with("<!--") {
            at = skip_to("-->").unwrap_or(xml.len());
            continue;
        }
        if rest.starts_with("<![CDATA[") {
            at = skip_to("]]>").unwrap_or(xml.len());
            continue;
        }
        let Some(e) = rest.find('>') else { break };
        let end = start + e + 1;
        let raw = xml.get(start..end).unwrap_or_default();
        at = end;
        if raw.starts_with("<?") || raw.starts_with("<!") {
            continue;
        }
        let (kind, body) = if let Some(b) = raw.strip_prefix("</") {
            (Kind::Close, b)
        } else if raw.ends_with("/>") {
            (Kind::Empty, raw.get(1..).unwrap_or_default())
        } else {
            (Kind::Open, raw.get(1..).unwrap_or_default())
        };
        let name_end = body.find(|c: char| c.is_whitespace() || c == '>' || c == '/').unwrap_or(body.len());
        let name = body.get(..name_end).unwrap_or_default();
        out.push(Tag { name, kind, start, end, raw });
    }
    out
}

/// The value of an attribute in a raw tag.
fn attr<'a>(raw: &'a str, name: &str) -> Option<&'a str> {
    let mut rest = raw;
    loop {
        let i = rest.find(name)?;
        let before = rest.get(..i).and_then(|b| b.chars().last());
        let after = rest.get(i + name.len()..).unwrap_or_default();
        let after_trim = after.trim_start();
        if before.is_some_and(char::is_whitespace) && after_trim.starts_with('=') {
            let v = after_trim.get(1..).unwrap_or_default().trim_start();
            let q = v.chars().next()?;
            if q == '"' || q == '\'' {
                let inner = v.get(1..).unwrap_or_default();
                return inner.find(q).and_then(|e| inner.get(..e));
            }
        }
        rest = after;
    }
}

// ---------------------------------------------------------------- styles

/// Built-in names of the styles ("heading 1", "title") → their ids in this document.
fn style_ids(styles_xml: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut current: Option<String> = None;
    for tag in tags(styles_xml) {
        match (tag.name, tag.kind) {
            ("w:style", Kind::Open) => current = attr(tag.raw, "w:styleId").map(str::to_string),
            ("w:style", Kind::Close) => current = None,
            ("w:name", Kind::Empty) => {
                if let (Some(id), Some(name)) = (&current, attr(tag.raw, "w:val")) {
                    out.insert(name.to_lowercase(), id.clone());
                }
            }
            _ => {}
        }
    }
    out
}

/// Heading level of a paragraph style id, from the built-in names.
fn heading_level(id: &str, names: &HashMap<String, String>) -> Option<usize> {
    for (name, sid) in names {
        if sid == id {
            if name == "title" {
                return Some(1);
            }
            if let Some(n) = name.strip_prefix("heading ") {
                return n.trim().parse().ok().filter(|n| (1..=6).contains(n));
            }
            return None;
        }
    }
    // A style not described in styles.xml: the usual ids.
    let low = id.to_lowercase();
    for prefix in ["heading", "titolo"] {
        if let Some(n) = low.strip_prefix(prefix) {
            return n.parse().ok().filter(|n| (1..=6).contains(n));
        }
    }
    (low == "title").then_some(1)
}

// ---------------------------------------------------------------- reading

fn part<'a>(entries: &'a [(String, Vec<u8>)], name: &str) -> Option<&'a [u8]> {
    entries.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, b)| b.as_slice())
}

fn part_text(entries: &[(String, Vec<u8>)], name: &str) -> Option<String> {
    part(entries, name).map(|b| String::from_utf8_lossy(b).trim_start_matches('\u{feff}').to_string())
}

fn table_md(rows: &[Vec<String>]) -> String {
    let cols = rows.iter().map(Vec::len).max().unwrap_or(0);
    if cols == 0 {
        return String::new();
    }
    let cell = |s: &str| s.replace('|', "\\|").replace('\n', " ");
    let mut out = String::new();
    for (i, r) in rows.iter().enumerate() {
        out.push('|');
        for c in 0..cols {
            out.push(' ');
            out.push_str(&cell(r.get(c).map(String::as_str).unwrap_or_default()));
            out.push_str(" |");
        }
        out.push('\n');
        if i == 0 {
            out.push('|');
            out.push_str(&" --- |".repeat(cols));
            out.push('\n');
        }
    }
    out
}

/// The text of a part (document, header, footer) as Markdown blocks.
fn part_markdown(xml: &str, names: &HashMap<String, String>) -> Vec<String> {
    struct Para {
        text: String,
        level: Option<usize>,
        list: bool,
    }
    let mut blocks: Vec<String> = Vec::new();
    let mut paras: Vec<Para> = Vec::new();
    // Open tables: rows, the row being read, the cell being read.
    let mut tables: Vec<(Vec<Vec<String>>, Vec<String>, Option<String>)> = Vec::new();
    let mut span = 1usize;
    let mut in_text = false;
    let mut in_ppr = 0usize;
    let mut fallback = 0usize;
    let list = tags(xml);
    for (i, tag) in list.iter().enumerate() {
        if fallback > 0 {
            match (tag.name, tag.kind) {
                ("mc:Fallback", Kind::Open) => fallback += 1,
                ("mc:Fallback", Kind::Close) => fallback -= 1,
                _ => {}
            }
            continue;
        }
        match (tag.name, tag.kind) {
            ("mc:Fallback", Kind::Open) => fallback = 1,
            ("w:p", Kind::Open) => paras.push(Para { text: String::new(), level: None, list: false }),
            ("w:pPr", Kind::Open) => in_ppr += 1,
            ("w:pPr", Kind::Close) => in_ppr = in_ppr.saturating_sub(1),
            ("w:pStyle", _) => {
                if let (Some(p), Some(id)) = (paras.last_mut(), attr(tag.raw, "w:val")) {
                    p.level = heading_level(id, names);
                }
            }
            ("w:numPr", Kind::Open | Kind::Empty) if in_ppr > 0 => {
                if let Some(p) = paras.last_mut() {
                    p.list = true;
                }
            }
            ("wp:docPr", Kind::Open | Kind::Empty) => {
                if let Some(p) = paras.last_mut() {
                    let d = attr(tag.raw, "descr").map(unescape).filter(|d| !d.trim().is_empty());
                    p.text.push_str(&format!("[immagine{}]", d.map(|d| format!(": {}", d.trim())).unwrap_or_default()));
                }
            }
            ("w:t", Kind::Open) => in_text = true,
            ("w:t", Kind::Close) => in_text = false,
            ("w:tab", Kind::Empty) if in_ppr == 0 => {
                if let Some(p) = paras.last_mut() {
                    p.text.push('\t');
                }
            }
            ("w:br" | "w:cr", Kind::Empty) => {
                if let Some(p) = paras.last_mut() {
                    p.text.push('\n');
                }
            }
            ("w:p", Kind::Close) => {
                let Some(p) = paras.pop() else { continue };
                let text = p.text.trim_end().to_string();
                if let Some((_, _, Some(cell))) = tables.last_mut() {
                    if !text.trim().is_empty() {
                        if !cell.is_empty() {
                            cell.push_str("<br>");
                        }
                        cell.push_str(&text.replace('\n', "<br>"));
                    }
                } else if let Some(outer) = paras.last_mut() {
                    // A text box inside a paragraph.
                    if !text.trim().is_empty() {
                        outer.text.push_str(&format!(" {text} "));
                    }
                } else if !text.trim().is_empty() {
                    let line = match (p.level, p.list) {
                        (Some(l), _) => format!("{} {}", "#".repeat(l), text.replace('\n', " ")),
                        (None, true) => format!("- {text}"),
                        _ => text,
                    };
                    blocks.push(line);
                }
            }
            ("w:tbl", Kind::Open) => tables.push((Vec::new(), Vec::new(), None)),
            ("w:tr", Kind::Open) => {
                if let Some(t) = tables.last_mut() {
                    t.1 = Vec::new();
                }
            }
            ("w:tc", Kind::Open) => {
                if let Some(t) = tables.last_mut() {
                    t.2 = Some(String::new());
                }
            }
            ("w:gridSpan", Kind::Empty) => span = attr(tag.raw, "w:val").and_then(|v| v.parse().ok()).unwrap_or(1usize).clamp(1, 64),
            ("w:tc", Kind::Close) => {
                if let Some(t) = tables.last_mut() {
                    // A merged cell: its text, then the columns it covers, empty.
                    let cell = t.2.take().unwrap_or_default();
                    t.1.push(cell);
                    for _ in 1..span {
                        t.1.push(String::new());
                    }
                }
                span = 1;
            }
            ("w:tr", Kind::Close) => {
                if let Some(t) = tables.last_mut() {
                    let row = std::mem::take(&mut t.1);
                    t.0.push(row);
                }
            }
            ("w:tbl", Kind::Close) => {
                let Some((rows, _, _)) = tables.pop() else { continue };
                let md = table_md(&rows);
                if let Some((_, _, Some(cell))) = tables.last_mut() {
                    // A table in a cell: its rows, one per line.
                    let flat: Vec<String> = rows.iter().map(|r| r.join(" · ")).collect();
                    cell.push_str(&flat.join("<br>"));
                } else if !md.is_empty() {
                    blocks.push(md.trim_end().to_string());
                }
            }
            _ => {}
        }
        if in_text {
            // The text between <w:t> and </w:t>.
            if let (Some(next), Some(p)) = (list.get(i + 1), paras.last_mut()) {
                if let Some(s) = xml.get(tag.end..next.start) {
                    p.text.push_str(&unescape(s));
                }
            }
        }
    }
    blocks
}

/// Most of a document fits; a very long one is cut here.
const MAX_READ: usize = 200_000;

/// A Word file as Markdown: header, body (headings, lists, tables), footer.
pub fn markdown(bytes: &[u8]) -> Result<String, String> {
    let entries = crate::ooxzip::read(bytes)?;
    let doc = part_text(&entries, "word/document.xml").ok_or("Non è un documento Word (.docx).")?;
    let names = part_text(&entries, "word/styles.xml").map(|s| style_ids(&s)).unwrap_or_default();
    let mut sorted: Vec<&(String, Vec<u8>)> = entries.iter().collect();
    sorted.sort_by(|a, b| a.0.cmp(&b.0));
    let side = |prefix: &str| {
        let mut seen: Vec<String> = Vec::new();
        for (name, data) in &sorted {
            if name.starts_with(prefix) && name.ends_with(".xml") {
                for b in part_markdown(&String::from_utf8_lossy(data), &names) {
                    if !seen.contains(&b) {
                        seen.push(b);
                    }
                }
            }
        }
        seen.join("\n")
    };
    let mut out = String::new();
    let head = side("word/header");
    if !head.is_empty() {
        out.push_str(&format!("_Intestazione:_\n{head}\n\n---\n\n"));
    }
    out.push_str(&part_markdown(&doc, &names).join("\n\n"));
    let foot = side("word/footer");
    if !foot.is_empty() {
        out.push_str(&format!("\n\n---\n\n_Piè di pagina:_\n{foot}"));
    }
    if out.chars().count() > MAX_READ {
        out = out.chars().take(MAX_READ).collect::<String>() + "\n\n[…documento tagliato qui: è molto lungo]";
    }
    Ok(out)
}

/// The text of a Word or PDF file, for the engines and the memory; None when
/// it is neither.
pub fn text_of_file(path: &Path) -> Option<Result<String, String>> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    let read = || std::fs::read(path).map_err(|e| format!("File non leggibile: {e}"));
    match ext.as_str() {
        "docx" | "dotx" | "docm" | "dotm" => Some(read().and_then(|b| markdown(&b))),
        "pdf" => Some(read().and_then(|b| crate::pdftext::text(&b))),
        "doc" => Some(Err("È un .doc del vecchio Word: si legge solo dopo averlo salvato come .docx.".into())),
        _ => None,
    }
}

// ---------------------------------------------------------------- placeholders

/// "{cliente}" or "{{cliente}}" at `at` → (key, length of the placeholder).
fn placeholder_at(text: &str, at: usize) -> Option<(String, usize)> {
    let rest = text.get(at..)?;
    let (open, close) = if rest.starts_with("{{") { ("{{", "}}") } else if rest.starts_with('{') { ("{", "}") } else { return None };
    let inner_all = rest.get(open.len()..)?;
    let end = inner_all.find(close)?;
    let inner = inner_all.get(..end)?;
    let key = inner.trim();
    let ok = !key.is_empty() && key.chars().count() <= 40 && key.chars().all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | ' ' | '.'));
    ok.then(|| (key.to_lowercase(), open.len() + end + close.len()))
}

/// Every placeholder in a text, in order: (start, length, key).
fn placeholders_in(text: &str) -> Vec<(usize, usize, String)> {
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(i) = text.get(at..).and_then(|r| r.find('{')) {
        let start = at + i;
        match placeholder_at(text, start) {
            Some((key, len)) => {
                out.push((start, len, key));
                at = start + len;
            }
            None => at = start + 1,
        }
    }
    out
}

/// The texts of a part grouped by paragraph: for each paragraph, its <w:t>
/// elements (start of the open tag, end of the close tag, text) and, for a
/// paragraph that holds only text runs, where the whole paragraph is.
struct Group {
    texts: Vec<(usize, usize, String)>,
    para: Option<(usize, usize)>,
}

fn groups(xml: &str) -> Vec<Group> {
    let list = tags(xml);
    let mut out = Vec::new();
    let mut texts: Vec<(usize, usize, String)> = Vec::new();
    let mut paras: Vec<usize> = Vec::new();
    let mut open_t: Option<usize> = None;
    for (i, tag) in list.iter().enumerate() {
        match (tag.name, tag.kind) {
            ("w:p", Kind::Open) => {
                if !texts.is_empty() {
                    out.push(Group { texts: std::mem::take(&mut texts), para: None });
                }
                paras.push(tag.start);
            }
            ("w:p", Kind::Close) => {
                let start = paras.pop();
                let para = start.map(|s| (s, tag.end));
                out.push(Group { texts: std::mem::take(&mut texts), para });
            }
            ("w:t", Kind::Open) => open_t = Some(i),
            ("w:t", Kind::Close) => {
                if let Some(o) = open_t.take() {
                    if let Some(open) = list.get(o) {
                        let inner = xml.get(open.end..tag.start).unwrap_or_default();
                        texts.push((open.start, tag.end, unescape(inner)));
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// The placeholders of a template, without repeats.
pub fn placeholders(entries: &[(String, Vec<u8>)]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for (name, data) in entries {
        if !is_text_part(name) {
            continue;
        }
        let xml = String::from_utf8_lossy(data);
        for g in groups(&xml) {
            let joined: String = g.texts.iter().map(|t| t.2.as_str()).collect();
            for (_, _, key) in placeholders_in(&joined) {
                if !out.contains(&key) {
                    out.push(key);
                }
            }
        }
    }
    out
}

fn is_text_part(name: &str) -> bool {
    let n = name.to_lowercase();
    n == "word/document.xml" || (n.starts_with("word/header") || n.starts_with("word/footer") || n == "word/footnotes.xml" || n == "word/endnotes.xml") && n.ends_with(".xml")
}

/// A text for a <w:t>: line breaks become <w:br/> inside the same run.
fn t_element(text: &str) -> String {
    let lines: Vec<String> = text.split('\n').map(|l| format!("<w:t xml:space=\"preserve\">{}</w:t>", escape(l.trim_end_matches('\r')))).collect();
    lines.join("<w:br/>")
}

/// Fills the placeholders of one part. `values` are plain texts; `blocks` are
/// whole paragraphs and tables (OOXML) that take the place of a paragraph
/// holding only their placeholder. Returns the keys left unfilled.
fn fill_part(xml: &str, values: &HashMap<String, String>, blocks: &HashMap<String, String>, used: &mut Vec<String>) -> (String, Vec<String>) {
    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    let mut missing: Vec<String> = Vec::new();
    for g in groups(xml) {
        if g.texts.is_empty() {
            continue;
        }
        let joined: String = g.texts.iter().map(|t| t.2.as_str()).collect();
        let found = placeholders_in(&joined);
        if found.is_empty() {
            continue;
        }
        // A paragraph with only "{corpo}": the blocks take its place.
        if let (Some((ps, pe)), [(_, _, key)]) = (g.para, found.as_slice()) {
            let only = joined.trim();
            let alone = placeholder_at(only, 0).is_some_and(|(k, len)| len == only.len() && k == *key);
            if let (true, Some(b)) = (alone, blocks.get(key)) {
                edits.push((ps, pe, b.clone()));
                used.push(key.clone());
                continue;
            }
        }
        // Who owns each byte of the joined text.
        let mut owner: Vec<usize> = Vec::with_capacity(joined.len());
        for (i, t) in g.texts.iter().enumerate() {
            owner.extend(std::iter::repeat_n(i, t.2.len()));
        }
        let mut new: Vec<String> = vec![String::new(); g.texts.len()];
        let mut changed = vec![false; g.texts.len()];
        let mut at = 0;
        let mut next = found.iter().peekable();
        while at < joined.len() {
            if let Some((start, len, key)) = next.peek().map(|(s, l, k)| (*s, *l, k.clone())) {
                if start == at {
                    next.next();
                    let who = owner.get(at).copied().unwrap_or(0);
                    let value = values.get(&key).cloned().or_else(|| blocks.contains_key(&key).then(|| plain_of_block(&key, values)));
                    match value {
                        Some(v) => {
                            if let Some(slot) = new.get_mut(who) {
                                slot.push_str(&v);
                            }
                            for o in owner.get(at..at + len).unwrap_or_default() {
                                if let Some(c) = changed.get_mut(*o) {
                                    *c = true;
                                }
                            }
                            if !used.contains(&key) {
                                used.push(key.clone());
                            }
                        }
                        None => {
                            if !missing.contains(&key) {
                                missing.push(key.clone());
                            }
                            for (k, o) in owner.get(at..at + len).unwrap_or_default().iter().enumerate() {
                                if let (Some(slot), Some(s)) = (new.get_mut(*o), joined.get(at + k..at + k + 1)) {
                                    slot.push_str(s);
                                }
                            }
                        }
                    }
                    at += len;
                    continue;
                }
            }
            let ch_len = joined.get(at..).and_then(|r| r.chars().next()).map_or(1, char::len_utf8);
            if let (Some(o), Some(s)) = (owner.get(at), joined.get(at..at + ch_len)) {
                if let Some(slot) = new.get_mut(*o) {
                    slot.push_str(s);
                }
            }
            at += ch_len;
        }
        for (i, t) in g.texts.iter().enumerate() {
            if changed.get(i) == Some(&true) {
                edits.push((t.0, t.1, t_element(new.get(i).map(String::as_str).unwrap_or_default())));
            }
        }
    }
    // Whole paragraphs win over the texts inside them.
    let paras: Vec<(usize, usize)> = edits.iter().filter(|e| e.2.starts_with("<w:p") || e.2.starts_with("<w:tbl")).map(|e| (e.0, e.1)).collect();
    edits.retain(|e| !paras.iter().any(|p| e.0 >= p.0 && e.1 <= p.1 && (e.0, e.1) != *p));
    edits.sort_by_key(|e| e.0);
    let mut out = String::with_capacity(xml.len());
    let mut at = 0;
    for (s, e, r) in edits {
        if s < at {
            continue;
        }
        out.push_str(xml.get(at..s).unwrap_or_default());
        out.push_str(&r);
        at = e;
    }
    out.push_str(xml.get(at..).unwrap_or_default());
    (out, missing)
}

/// "{corpo}" in the middle of other text: the body as plain lines.
fn plain_of_block(key: &str, values: &HashMap<String, String>) -> String {
    values.get(&format!("{key}#plain")).cloned().unwrap_or_default()
}

// ---------------------------------------------------------------- writing

/// What the body uses of the document's styles.
struct Look {
    heading: [Option<String>; 3],
}

impl Look {
    fn of(styles_xml: Option<&str>) -> Self {
        let names = styles_xml.map(style_ids).unwrap_or_default();
        let get = |n: &str| names.get(n).cloned();
        Look { heading: [get("heading 1"), get("heading 2"), get("heading 3")] }
    }
}

/// **bold** and *italic* → runs.
fn runs(text: &str, base: &str) -> String {
    let mut out = String::new();
    let mut bold = false;
    let mut italic = false;
    let mut buf = String::new();
    let flush = |buf: &mut String, out: &mut String, bold: bool, italic: bool| {
        if buf.is_empty() {
            return;
        }
        let mut rpr = base.to_string();
        if bold {
            rpr.push_str("<w:b/>");
        }
        if italic {
            rpr.push_str("<w:i/>");
        }
        let rpr = if rpr.is_empty() { String::new() } else { format!("<w:rPr>{rpr}</w:rPr>") };
        out.push_str(&format!("<w:r>{rpr}{}</w:r>", t_element(buf)));
        buf.clear();
    };
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '*' && chars.get(i + 1) == Some(&'*') {
            flush(&mut buf, &mut out, bold, italic);
            bold = !bold;
            i += 2;
            continue;
        }
        if c == '*' && (italic || chars.get(i + 1).is_some_and(|n| !n.is_whitespace())) && (italic || chars[i + 1..].contains(&'*')) {
            flush(&mut buf, &mut out, bold, italic);
            italic = !italic;
            i += 1;
            continue;
        }
        buf.push(c);
        i += 1;
    }
    flush(&mut buf, &mut out, bold, italic);
    out
}

fn paragraph(ppr: &str, runs: &str) -> String {
    if ppr.is_empty() {
        format!("<w:p>{runs}</w:p>")
    } else {
        format!("<w:p><w:pPr>{ppr}</w:pPr>{runs}</w:p>")
    }
}

fn is_number(s: &str) -> bool {
    let t = s.trim().trim_end_matches(['€', '%']).trim();
    !t.is_empty() && t.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | ',' | '-' | '+' | ' '))
}

/// A table: first row as header. `widths` in twips (A4 with 2 cm margins ≈ 9638).
fn table(rows: &[Vec<String>], widths: &[u32], right: &[bool], total_rows: usize) -> String {
    let cols = rows.iter().map(Vec::len).max().unwrap_or(0).max(1);
    let widths: Vec<u32> = if widths.len() == cols { widths.to_vec() } else { vec![9638 / cols as u32; cols] };
    let border = |n: &str| format!("<w:{n} w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"A6A6A6\"/>");
    let mut x = String::from("<w:tbl><w:tblPr><w:tblW w:w=\"5000\" w:type=\"pct\"/><w:tblBorders>");
    for n in ["top", "left", "bottom", "right", "insideH", "insideV"] {
        x.push_str(&border(n));
    }
    x.push_str("</w:tblBorders><w:tblLayout w:type=\"fixed\"/><w:tblCellMar><w:top w:w=\"40\" w:type=\"dxa\"/><w:left w:w=\"80\" w:type=\"dxa\"/><w:bottom w:w=\"40\" w:type=\"dxa\"/><w:right w:w=\"80\" w:type=\"dxa\"/></w:tblCellMar></w:tblPr><w:tblGrid>");
    for w in &widths {
        x.push_str(&format!("<w:gridCol w:w=\"{w}\"/>"));
    }
    x.push_str("</w:tblGrid>");
    let body_rows = rows.len().saturating_sub(total_rows);
    for (ri, row) in rows.iter().enumerate() {
        let header = ri == 0;
        let total = ri >= body_rows && total_rows > 0;
        x.push_str(if header { "<w:tr><w:trPr><w:tblHeader/></w:trPr>" } else { "<w:tr>" });
        // A totals row: the label spans all columns but the last.
        let cells: Vec<(String, u32, usize)> = if total && cols > 1 {
            let span: u32 = widths.iter().take(cols - 1).sum();
            vec![
                (row.first().cloned().unwrap_or_default(), span, cols - 1),
                (row.last().cloned().unwrap_or_default(), widths.last().copied().unwrap_or(1200), 1),
            ]
        } else {
            (0..cols).map(|c| (row.get(c).cloned().unwrap_or_default(), widths.get(c).copied().unwrap_or(1200), 1)).collect()
        };
        for (ci, (text, w, span)) in cells.iter().enumerate() {
            let mut tcpr = format!("<w:tcW w:w=\"{w}\" w:type=\"dxa\"/>");
            if *span > 1 {
                tcpr.push_str(&format!("<w:gridSpan w:val=\"{span}\"/>"));
            }
            if header {
                tcpr.push_str("<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"EDEDED\"/>");
            }
            let col = if total && ci == 1 { cols - 1 } else { ci };
            let align_right = total || right.get(col).copied().unwrap_or(false) || (!header && right.is_empty() && is_number(text));
            let ppr = format!("<w:spacing w:before=\"0\" w:after=\"0\"/>{}", if align_right { "<w:jc w:val=\"right\"/>" } else { "" });
            let strong = header || (total && ri + 1 == rows.len());
            x.push_str(&format!("<w:tc><w:tcPr>{tcpr}</w:tcPr>{}</w:tc>", paragraph(&ppr, &runs(text, if strong { "<w:b/>" } else { "" }))));
        }
        x.push_str("</w:tr>");
    }
    x.push_str("</w:tbl>");
    x
}

/// "| a | b |" → ["a", "b"]; the separator line "|---|" → None.
fn md_row(line: &str) -> Option<Vec<String>> {
    let t = line.trim().trim_start_matches('|').trim_end_matches('|');
    let cells: Vec<String> = t.split('|').map(|c| c.trim().replace("<br>", "\n")).collect();
    if cells.iter().all(|c| !c.is_empty() && c.chars().all(|ch| matches!(ch, '-' | ':' | ' '))) {
        return None;
    }
    Some(cells)
}

/// Markdown (headings, lists, tables, **bold**) → OOXML paragraphs and tables.
#[cfg(test)]
fn body_xml(md: &str, look: &Look) -> String {
    body_with(md, look, &Pics::default())
}

// ---------------------------------------------------------------- pictures

/// A picture for the body, read by documents.rs: `![didascalia](percorso)` on a line of its own.
pub struct Picture {
    pub bytes: Vec<u8>,
}

/// Pictures placed in the document: path as written → (relationship id, width px, height px, drawing id).
#[derive(Default)]
struct Pics {
    map: HashMap<String, (String, u32, u32, u32)>,
    /// Width of the text column, in EMU.
    max_w: u64,
}

/// `![alt](path)` or `![alt|5cm](path)` alone on a line → (alt, width in cm, path).
fn image_line(t: &str) -> Option<(String, Option<f64>, String)> {
    let rest = t.trim().strip_prefix("![")?;
    let (alt, rest) = rest.split_once("](")?;
    let path = rest.strip_suffix(')')?.trim().trim_matches(|c| c == '"' || c == '<' || c == '>');
    if path.is_empty() {
        return None;
    }
    let (alt, cm) = match alt.rsplit_once('|') {
        Some((a, w)) => {
            let w = w.trim().to_lowercase();
            let cm = w.strip_suffix("cm").and_then(|n| n.trim().replace(',', ".").parse::<f64>().ok()).filter(|n| *n > 0.0 && *n < 100.0);
            (a.trim().to_string(), cm)
        }
        None => (alt.trim().to_string(), None),
    };
    Some((alt, cm, path.to_string()))
}

/// The paths of the pictures in a Markdown body, once each.
pub fn image_refs(md: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in md.lines() {
        if let Some((_, _, p)) = image_line(line) {
            if !out.contains(&p) {
                out.push(p);
            }
        }
    }
    out
}

/// Format (extension) and size in pixels of a PNG, JPEG or GIF.
fn image_kind(b: &[u8]) -> Option<(&'static str, u32, u32)> {
    let be = |i: usize| -> Option<u32> { Some(u32::from_be_bytes(b.get(i..i + 4)?.try_into().ok()?)) };
    let be16 = |i: usize| -> Option<u32> { Some(u16::from_be_bytes(b.get(i..i + 2)?.try_into().ok()?) as u32) };
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(("png", be(16)?, be(20)?));
    }
    if b.starts_with(b"GIF8") {
        let w = u16::from_le_bytes(b.get(6..8)?.try_into().ok()?) as u32;
        let h = u16::from_le_bytes(b.get(8..10)?.try_into().ok()?) as u32;
        return Some(("gif", w, h));
    }
    if b.starts_with(&[0xFF, 0xD8]) {
        let mut i = 2;
        while i + 9 < b.len() {
            if *b.get(i)? != 0xFF {
                i += 1;
                continue;
            }
            let m = *b.get(i + 1)?;
            if m == 0xFF {
                i += 1;
                continue;
            }
            if matches!(m, 0xD8 | 0x01 | 0xD0..=0xD7) {
                i += 2;
                continue;
            }
            let len = be16(i + 2)? as usize;
            if matches!(m, 0xC0..=0xCF) && !matches!(m, 0xC4 | 0xC8 | 0xCC) {
                return Some(("jpeg", be16(i + 7)?, be16(i + 5)?));
            }
            i += 2 + len;
        }
    }
    None
}

/// Width of the text column of a document.xml, in EMU (A4 with 2 cm margins if not found).
fn text_width(doc: &str) -> u64 {
    let last_tag = |name: &str| -> Option<&str> {
        let s = doc.rfind(name)?;
        let rest = doc.get(s..)?;
        rest.get(..rest.find('>')?)
    };
    let num = |raw: Option<&str>, key: &str| raw.and_then(|r| attr(r, key)).and_then(|v| v.parse::<u64>().ok());
    let page = num(last_tag("<w:pgSz "), "w:w").unwrap_or(11906);
    let mar = last_tag("<w:pgMar ");
    let left = num(mar, "w:left").unwrap_or(1134);
    let right = num(mar, "w:right").unwrap_or(1134);
    page.saturating_sub(left + right).max(1440) * 635
}

fn drawing(rid: &str, id: u32, cx: u64, cy: u64, alt: &str) -> String {
    let alt = escape(alt);
    format!(
        "<w:r><w:drawing xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\"><wp:extent cx=\"{cx}\" cy=\"{cy}\"/><wp:docPr id=\"{id}\" name=\"Immagine {id}\" descr=\"{alt}\"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect=\"1\"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:pic><pic:nvPicPr><pic:cNvPr id=\"{id}\" name=\"Immagine {id}\" descr=\"{alt}\"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed=\"{rid}\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"
    )
}

/// Adds the pictures' files, relationships and content types to a package.
fn add_pictures(entries: &mut Vec<(String, Vec<u8>)>, media: Vec<(String, String, Vec<u8>)>) {
    if media.is_empty() {
        return;
    }
    let mut rels = String::new();
    let mut exts: Vec<String> = Vec::new();
    for (rid, file, bytes) in media {
        rels.push_str(&format!("<Relationship Id=\"{rid}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/{file}\"/>"));
        let ext = file.rsplit('.').next().unwrap_or_default().to_string();
        if !exts.contains(&ext) {
            exts.push(ext);
        }
        entries.push((format!("word/media/{file}"), bytes));
    }
    const RELS: &str = "word/_rels/document.xml.rels";
    match entries.iter_mut().find(|(n, _)| n == RELS) {
        Some((_, data)) => {
            let xml = String::from_utf8_lossy(data).to_string();
            let at = xml.rfind("</Relationships>").unwrap_or(xml.len());
            *data = format!("{}{rels}{}", xml.get(..at).unwrap_or_default(), xml.get(at..).unwrap_or_default()).into_bytes();
        }
        None => entries.push((RELS.into(), format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{rels}</Relationships>").into_bytes())),
    }
    if let Some((_, data)) = entries.iter_mut().find(|(n, _)| n == "[Content_Types].xml") {
        let mut xml = String::from_utf8_lossy(data).to_string();
        for ext in exts {
            if !xml.to_lowercase().contains(&format!("extension=\"{ext}\"")) {
                let at = xml.rfind("</Types>").unwrap_or(xml.len());
                xml.insert_str(at, &format!("<Default Extension=\"{ext}\" ContentType=\"image/{ext}\"/>"));
            }
        }
        *data = xml.into_bytes();
    }
}

fn body_with(md: &str, look: &Look, pics: &Pics) -> String {
    let mut out = String::new();
    let lines: Vec<&str> = md.lines().collect();
    let mut i = 0;
    let mut para: Vec<&str> = Vec::new();
    let flush = |para: &mut Vec<&str>, out: &mut String| {
        if !para.is_empty() {
            out.push_str(&paragraph("", &runs(&para.join("\n"), "")));
            para.clear();
        }
    };
    while i < lines.len() {
        let line = lines[i];
        let t = line.trim();
        if t.is_empty() {
            flush(&mut para, &mut out);
            i += 1;
            continue;
        }
        if let Some((alt, cm, path)) = image_line(t) {
            if let Some((rid, w, h, id)) = pics.map.get(&path) {
                flush(&mut para, &mut out);
                let natural = *w as u64 * 9525;
                let cx = cm.map(|c| (c * 360_000.0) as u64).unwrap_or(natural).min(pics.max_w).max(9525);
                let cy = (cx as f64 * *h as f64 / (*w).max(1) as f64) as u64;
                out.push_str(&paragraph("<w:spacing w:before=\"120\" w:after=\"120\"/><w:jc w:val=\"center\"/>", &drawing(rid, *id, cx, cy.max(9525), &alt)));
                i += 1;
                continue;
            }
        }
        if t.starts_with('|') {
            flush(&mut para, &mut out);
            let mut rows = Vec::new();
            while i < lines.len() && lines[i].trim().starts_with('|') {
                if let Some(r) = md_row(lines[i]) {
                    rows.push(r);
                }
                i += 1;
            }
            out.push_str(&table(&rows, &[], &[], 0));
            out.push_str("<w:p/>");
            continue;
        }
        let hashes = t.chars().take_while(|c| *c == '#').count();
        if (1..=6).contains(&hashes) && t.chars().nth(hashes) == Some(' ') {
            flush(&mut para, &mut out);
            let text = t.get(hashes..).unwrap_or_default().trim();
            let level = hashes.min(3);
            let style = look.heading.get(level - 1).cloned().flatten();
            out.push_str(&match style {
                Some(id) => paragraph(&format!("<w:pStyle w:val=\"{}\"/>", escape(&id)), &runs(text, "")),
                None => {
                    let size = [32, 28, 24][level - 1];
                    paragraph("<w:keepNext/><w:spacing w:before=\"240\" w:after=\"120\"/>", &runs(text, &format!("<w:b/><w:sz w:val=\"{size}\"/>")))
                }
            });
            i += 1;
            continue;
        }
        let bullet = ["- ", "* ", "• "].iter().find_map(|b| t.strip_prefix(b));
        let numbered = {
            let digits = t.chars().take_while(char::is_ascii_digit).count();
            (digits > 0 && digits < 4 && matches!(t.chars().nth(digits), Some('.') | Some(')')) && t.chars().nth(digits + 1) == Some(' ')).then_some(t)
        };
        if bullet.is_some() || numbered.is_some() {
            flush(&mut para, &mut out);
            let text = match bullet {
                Some(b) => format!("•\t{}", b.trim()),
                None => {
                    let n = numbered.unwrap_or_default();
                    let cut = n.find(' ').unwrap_or(0);
                    format!("{}\t{}", n.get(..cut).unwrap_or_default(), n.get(cut..).unwrap_or_default().trim())
                }
            };
            let indent = (line.len() - line.trim_start().len()) / 2;
            let left = 360 + 360 * indent.min(4) as u32;
            let tabbed = runs(&text, "").replacen("\t", "</w:t></w:r><w:r><w:tab/><w:t xml:space=\"preserve\">", 1);
            out.push_str(&paragraph(&format!("<w:spacing w:after=\"60\"/><w:ind w:left=\"{left}\" w:hanging=\"360\"/>"), &tabbed));
            i += 1;
            continue;
        }
        para.push(t);
        i += 1;
    }
    flush(&mut para, &mut out);
    out
}

// ---------------------------------------------------------------- quotes

/// One line of a quote, as the engine gives it.
#[derive(Debug, Clone)]
pub struct Line {
    pub description: String,
    pub quantity: f64,
    pub price: f64,
    pub vat: f64,
}

fn num(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => {
            let s = s.trim().trim_end_matches(['€', '%']).trim().replace(' ', "");
            // "1.234,50" (Italian) or "1234.50".
            let s = if s.contains(',') { s.replace('.', "").replace(',', ".") } else { s };
            s.parse().ok()
        }
        _ => None,
    }
}

pub fn lines_of(v: Option<&Value>) -> Result<Vec<Line>, String> {
    let Some(list) = v.and_then(Value::as_array) else { return Ok(Vec::new()) };
    let mut out = Vec::new();
    for (i, r) in list.iter().enumerate() {
        let get = |keys: &[&str]| keys.iter().find_map(|k| r.get(*k));
        let description = get(&["descrizione", "description"]).and_then(Value::as_str).unwrap_or_default().trim().to_string();
        let quantity = num(get(&["quantita", "quantità", "quantity"])).unwrap_or(1.0);
        let vat = num(get(&["iva", "vat"])).unwrap_or(22.0);
        // A supplier's price with VAT in it: EasyIsland takes it out (12 Nov 2026, quotes from portals).
        let with_vat = get(&["ivato"]).and_then(Value::as_bool).unwrap_or(false);
        let net = |x: f64| if with_vat { x / (1.0 + vat / 100.0) } else { x };
        // The cost and the markup: the price is EasyIsland's sum, never the engine's.
        let price = match num(get(&["prezzo", "price"])) {
            Some(p) => net(p),
            None => {
                let cost = num(get(&["costo", "cost"])).ok_or_else(|| format!("Riga {}: manca il prezzo (o il costo).", i + 1))?;
                let markup = num(get(&["ricarico", "markup"])).unwrap_or(0.0);
                if !(-100.0..=1000.0).contains(&markup) {
                    return Err(format!("Riga {}: ricarico non valido.", i + 1));
                }
                (net(cost) * (1.0 + markup / 100.0) * 100.0).round() / 100.0
            }
        };
        let price = if with_vat { (price * 100.0).round() / 100.0 } else { price };
        if description.is_empty() {
            return Err(format!("Riga {}: manca la descrizione.", i + 1));
        }
        if !(0.0..=100.0).contains(&vat) || !price.is_finite() || !quantity.is_finite() {
            return Err(format!("Riga {}: valori non validi.", i + 1));
        }
        out.push(Line { description, quantity, price, vat });
    }
    Ok(out)
}

fn cents(x: f64) -> i64 {
    (x * 100.0).round() as i64
}

/// 123456 cents → "1.234,56 €".
pub fn money(c: i64) -> String {
    let neg = c < 0;
    let c = c.unsigned_abs();
    let int = (c / 100).to_string();
    let mut grouped = String::new();
    for (i, ch) in int.chars().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(ch);
    }
    format!("{}{grouped},{:02} €", if neg { "-" } else { "" }, c % 100)
}

fn plain_number(x: f64) -> String {
    let s = if x.fract() == 0.0 { format!("{x:.0}") } else { format!("{x:.2}").trim_end_matches('0').to_string() };
    s.replace('.', ",")
}

/// Totals of a quote: taxable amount, VAT per rate, total (cents).
pub struct Totals {
    pub taxable: i64,
    pub vat: Vec<(f64, i64)>,
    pub total: i64,
}

pub fn totals(lines: &[Line]) -> Totals {
    let mut by_rate: BTreeMap<i64, i64> = BTreeMap::new();
    let mut taxable = 0;
    for l in lines {
        let amount = cents(l.quantity * l.price);
        taxable += amount;
        *by_rate.entry(cents(l.vat)).or_default() += amount;
    }
    let vat: Vec<(f64, i64)> = by_rate.iter().map(|(r, base)| (*r as f64 / 100.0, (*base as f64 * *r as f64 / 10_000.0).round() as i64)).collect();
    let total = taxable + vat.iter().map(|v| v.1).sum::<i64>();
    Totals { taxable, vat, total }
}

fn quote_table(lines: &[Line], t: &Totals) -> String {
    let mut rows = vec![vec!["Descrizione".to_string(), "Q.tà".into(), "Prezzo".into(), "IVA".into(), "Importo".into()]];
    for l in lines {
        rows.push(vec![l.description.clone(), plain_number(l.quantity), money(cents(l.price)), format!("{}%", plain_number(l.vat)), money(cents(l.quantity * l.price))]);
    }
    let mut extra = 1;
    rows.push(vec!["Imponibile".into(), money(t.taxable)]);
    for (rate, v) in &t.vat {
        rows.push(vec![format!("IVA {}%", plain_number(*rate)), money(*v)]);
        extra += 1;
    }
    rows.push(vec!["Totale".into(), money(t.total)]);
    extra += 1;
    table(&rows, &[4438, 900, 1500, 800, 2000], &[false, true, true, true, true], extra) + "<w:p/>"
}

// ---------------------------------------------------------------- templates and numbers

pub fn templates_dir() -> PathBuf {
    crate::settings::config_dir().join("documenti").join("modelli")
}

fn numbers_file() -> PathBuf {
    crate::settings::config_dir().join("documenti").join("numeri.json")
}

/// The user's templates: (name, path), sorted.
pub fn templates() -> Vec<(String, PathBuf)> {
    let mut out: Vec<(String, PathBuf)> = std::fs::read_dir(templates_dir())
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && matches!(p.extension().and_then(|e| e.to_str()).map(str::to_lowercase).as_deref(), Some("docx" | "dotx")))
        .filter_map(|p| Some((p.file_stem()?.to_string_lossy().to_string(), p)))
        .collect();
    out.sort_by_key(|a| a.0.to_lowercase());
    out
}

fn find_template(name: &str) -> Result<PathBuf, String> {
    let want = name.trim().trim_end_matches(".docx").trim_end_matches(".dotx").to_lowercase();
    let all = templates();
    all.iter()
        .find(|(n, _)| n.to_lowercase() == want)
        .map(|(_, p)| p.clone())
        .ok_or_else(|| {
            let names: Vec<&str> = all.iter().map(|(n, _)| n.as_str()).collect();
            if names.is_empty() {
                format!("Nessun modello «{name}»: l'utente non ha ancora aggiunto modelli (document_template_add).")
            } else {
                format!("Nessun modello «{name}». Modelli: {}.", names.join(", "))
            }
        })
}

fn today() -> (u16, u16, u16) {
    let n = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    (n.wYear, n.wMonth, n.wDay)
}

/// The next number for `key` this year ("3/2026"), saved at once.
fn next_number(key: &str) -> String {
    let (year, _, _) = today();
    let path = numbers_file();
    let mut all: serde_json::Map<String, Value> = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let k = key.to_lowercase();
    let last = all.get(&k).filter(|v| v.get("anno").and_then(Value::as_u64) == Some(year as u64)).and_then(|v| v.get("n")).and_then(Value::as_u64).unwrap_or(0);
    let n = last + 1;
    all.insert(k, serde_json::json!({ "anno": year, "n": n }));
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&path, serde_json::to_string_pretty(&all).unwrap_or_default());
    format!("{n}/{year}")
}

pub fn template_list() -> String {
    let all = templates();
    if all.is_empty() {
        return format!("Nessun modello. L'utente può aggiungerne uno: document_template_add con il percorso di un .docx o .dotx (cartella {}).", templates_dir().display());
    }
    let mut out = String::from("Modelli di documento:\n");
    for (name, path) in all {
        let keys = std::fs::read(&path).ok().and_then(|b| crate::ooxzip::read(&b).ok()).map(|e| placeholders(&e)).unwrap_or_default();
        let keys = if keys.is_empty() { "nessun segnaposto".to_string() } else { keys.iter().map(|k| format!("{{{k}}}")).collect::<Vec<_>>().join(", ") };
        out.push_str(&format!("- {name}: {keys}\n"));
    }
    out.push_str("Segnaposto calcolati da EasyIsland: {data} (oggi), {numero} (progressivo dell'anno per modello), {corpo} (il testo), {righe} (la tabella delle righe), {imponibile}, {iva}, {totale}, {titolo}.");
    out
}

/// Copies a Word file into the templates (never over another one).
pub fn add_template(path: &str, name: &str) -> Result<String, String> {
    let src = PathBuf::from(path.trim().trim_matches('"'));
    let ext = src.extension().and_then(|e| e.to_str()).map(str::to_lowercase).unwrap_or_default();
    if ext != "docx" && ext != "dotx" {
        return Err("Solo modelli .docx o .dotx (i .doc vecchi vanno salvati prima come .docx in Word).".into());
    }
    let bytes = std::fs::read(&src).map_err(|e| format!("File non leggibile: {e}"))?;
    let entries = crate::ooxzip::read(&bytes)?;
    if part(&entries, "word/document.xml").is_none() {
        return Err("Non è un documento Word.".into());
    }
    let stem = if name.trim().is_empty() { src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default() } else { name.trim().to_string() };
    let base = crate::custom::safe_name(&stem, &ext);
    if base.is_empty() {
        return Err("Nome del modello non valido.".into());
    }
    if templates().iter().any(|(n, _)| n.eq_ignore_ascii_case(&base)) {
        return Err(format!("C'è già un modello «{base}»: scegli un altro nome."));
    }
    let dir = templates_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{base}.{ext}")), &bytes).map_err(|e| format!("Modello non salvato: {e}"))?;
    let keys = placeholders(&entries);
    Ok(format!(
        "Modello «{base}» aggiunto ({}). Segnaposto: {}.",
        dir.display(),
        if keys.is_empty() { "nessuno: il testo andrà in fondo al documento".to_string() } else { keys.iter().map(|k| format!("{{{k}}}")).collect::<Vec<_>>().join(", ") }
    ))
}

// ---------------------------------------------------------------- a new document

const BLANK_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>"#;
const BLANK_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
const BLANK_DOC_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#;
const BLANK_STYLES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="it-IT"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style></w:styles>"#;
const BLANK_SECT: &str = r#"<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>"#;

fn blank(title: &str, body: &str) -> Vec<(String, Vec<u8>)> {
    let mut inner = String::new();
    if !title.trim().is_empty() {
        inner.push_str(&paragraph("<w:pStyle w:val=\"Title\"/>", &runs(title.trim(), "")));
    }
    inner.push_str(body);
    let doc = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>{inner}{BLANK_SECT}</w:body></w:document>"
    );
    vec![
        ("[Content_Types].xml".into(), BLANK_TYPES.as_bytes().to_vec()),
        ("_rels/.rels".into(), BLANK_RELS.as_bytes().to_vec()),
        ("word/document.xml".into(), doc.into_bytes()),
        ("word/_rels/document.xml.rels".into(), BLANK_DOC_RELS.as_bytes().to_vec()),
        ("word/styles.xml".into(), BLANK_STYLES.as_bytes().to_vec()),
    ]
}

/// Puts `xml` at the end of the body, before its last section properties.
fn append_to_body(doc: &str, xml: &str) -> String {
    let end = doc.rfind("</w:body>").unwrap_or(doc.len());
    let body = doc.get(..end).unwrap_or_default();
    // The body's own <w:sectPr> is its last child.
    let at = match body.rfind("<w:sectPr") {
        Some(s) if !body.get(s..).unwrap_or_default().contains("</w:p>") => s,
        _ => end,
    };
    format!("{}{xml}{}", doc.get(..at).unwrap_or_default(), doc.get(at..).unwrap_or_default())
}

/// What the engine asks for.
pub struct Request {
    pub template: String,
    pub title: String,
    pub values: HashMap<String, String>,
    pub body: String,
    pub lines: Vec<Line>,
    /// Pictures of the body, by the path written in `![…](path)`.
    pub pictures: HashMap<String, Picture>,
}

/// The finished document: bytes of the .docx, what was filled and what was not.
pub struct Made {
    pub bytes: Vec<u8>,
    pub number: Option<String>,
    pub missing: Vec<String>,
    pub totals: Option<Totals>,
}

fn long_date(y: u16, m: u16, d: u16) -> String {
    const MONTHS: [&str; 12] = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
    format!("{d} {} {y}", MONTHS.get(m as usize - 1).copied().unwrap_or_default())
}

pub fn make(req: &Request) -> Result<Made, String> {
    let template_path = (!req.template.trim().is_empty()).then(|| find_template(&req.template)).transpose()?;
    let mut entries = match &template_path {
        Some(p) => crate::ooxzip::read(&std::fs::read(p).map_err(|e| format!("Modello non leggibile: {e}"))?)?,
        None => blank("", ""),
    };
    let wanted = placeholders(&entries);
    let mut values: HashMap<String, String> = req.values.iter().map(|(k, v)| (k.trim().to_lowercase(), v.clone())).collect();
    let (y, m, d) = today();
    values.entry("data".into()).or_insert_with(|| format!("{d:02}/{m:02}/{y}"));
    values.entry("data lunga".into()).or_insert_with(|| long_date(y, m, d));
    if !req.title.trim().is_empty() {
        values.entry("titolo".into()).or_insert_with(|| req.title.trim().to_string());
    }
    let mut number = None;
    if wanted.iter().any(|k| k == "numero") && !values.contains_key("numero") {
        let key = template_path.as_ref().and_then(|p| p.file_stem()).map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "documento".into());
        let n = next_number(&key);
        values.insert("numero".into(), n.clone());
        number = Some(n);
    }
    let totals = (!req.lines.is_empty()).then(|| totals(&req.lines));
    if let Some(t) = &totals {
        values.insert("imponibile".into(), money(t.taxable));
        values.insert("iva".into(), money(t.vat.iter().map(|v| v.1).sum()));
        values.insert("totale".into(), money(t.total));
    }
    let look = Look::of(part_text(&entries, "word/styles.xml").as_deref());
    let mut blocks: HashMap<String, String> = HashMap::new();
    let mut pics = Pics { map: HashMap::new(), max_w: text_width(&part_text(&entries, "word/document.xml").unwrap_or_default()) };
    let mut media = Vec::new();
    for (n, path) in image_refs(&req.body).into_iter().enumerate() {
        let Some(pic) = req.pictures.get(&path) else { continue };
        let (ext, w, h) = image_kind(&pic.bytes).ok_or_else(|| format!("«{path}» non è un'immagine PNG, JPEG o GIF."))?;
        let rid = format!("rIdEiPic{}", n + 1);
        pics.map.insert(path, (rid.clone(), w.max(1), h.max(1), 7001 + n as u32));
        media.push((rid, format!("ei_immagine{}.{ext}", n + 1), pic.bytes.clone()));
    }
    let body = body_with(&req.body, &look, &pics);
    if !req.body.trim().is_empty() {
        blocks.insert("corpo".into(), body.clone());
        values.insert("corpo#plain".into(), req.body.lines().filter(|l| image_line(l).is_none()).collect::<Vec<_>>().join("\n").trim().to_string());
    }
    if let (Some(t), false) = (&totals, req.lines.is_empty()) {
        blocks.insert("righe".into(), quote_table(&req.lines, t));
    }
    let mut used: Vec<String> = Vec::new();
    let mut missing: Vec<String> = Vec::new();
    if template_path.is_none() {
        // A new blank document: title, body, lines.
        let mut inner = body;
        if let (Some(b), false) = (blocks.get("righe"), req.lines.is_empty()) {
            inner.push_str(b);
        }
        entries = blank(&req.title, &inner);
    } else {
        for (name, data) in entries.iter_mut() {
            if !is_text_part(name) {
                continue;
            }
            let xml = String::from_utf8_lossy(data).to_string();
            let (filled, miss) = fill_part(&xml, &values, &blocks, &mut used);
            for k in miss {
                if !missing.contains(&k) {
                    missing.push(k);
                }
            }
            *data = filled.into_bytes();
        }
        // Body and lines with no place in the template go at the end.
        let mut tail = String::new();
        for key in ["corpo", "righe"] {
            if let Some(b) = blocks.get(key) {
                if !used.iter().any(|u| u == key) {
                    tail.push_str(b);
                }
            }
        }
        if !tail.is_empty() {
            if let Some((_, data)) = entries.iter_mut().find(|(n, _)| n == "word/document.xml") {
                *data = append_to_body(&String::from_utf8_lossy(data), &tail).into_bytes();
            }
        }
        // A .dotx makes a .docx.
        if let Some((_, data)) = entries.iter_mut().find(|(n, _)| n == "[Content_Types].xml") {
            let t = String::from_utf8_lossy(data).replace("wordprocessingml.template.main+xml", "wordprocessingml.document.main+xml");
            *data = t.into_bytes();
        }
    }
    add_pictures(&mut entries, media);
    missing.retain(|k| !k.ends_with("#plain"));
    Ok(Made { bytes: crate::ooxzip::write(&entries)?, number, missing, totals })
}

// ---------------------------------------------------------------- Word → PDF

const TO_PDF: &str = r#"$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
try { $w = New-Object -ComObject Word.Application } catch { Write-Error 'NOWORD'; exit 1 }
try {
  $w.Visible = $false
  $w.DisplayAlerts = 0
  $d = $w.Documents.Open($env:EI_IN, $false, $true, $false)
  try { $d.ExportAsFixedFormat($env:EI_OUT, 17) } finally { $d.Close(0) }
} finally {
  $w.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($w)
}
'ok'"#;

/// Word is installed when its COM class is registered.
pub fn has_word() -> bool {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, HKEY, HKEY_CLASSES_ROOT, KEY_READ};
    let mut key = HKEY::default();
    let ok = unsafe { RegOpenKeyExW(HKEY_CLASSES_ROOT, w!("Word.Application\\CLSID"), Some(0), KEY_READ, &mut key) }.is_ok();
    if ok {
        let _ = unsafe { RegCloseKey(key) };
    }
    ok
}

/// A .docx printed in PDF by Word: the bytes of the PDF.
pub async fn word_pdf(docx: &Path) -> Result<Vec<u8>, String> {
    if !has_word() {
        return Err("Word non è installato su questo PC: il PDF dai documenti Word si fa solo con Word.".into());
    }
    let stamp = crate::msgraph::random(4).iter().map(|b| format!("{b:02x}")).collect::<String>();
    let work = std::env::temp_dir().join(format!("easyisland-word-{stamp}"));
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let ext = docx.extension().and_then(|e| e.to_str()).unwrap_or("docx").to_lowercase();
    let input = work.join(format!("documento.{ext}"));
    let out = work.join("documento.pdf");
    let done = async {
        std::fs::copy(docx, &input).map_err(|e| format!("Documento non leggibile: {e}"))?;
        crate::zip::powershell(TO_PDF, &[("EI_IN", &input.to_string_lossy()), ("EI_OUT", &out.to_string_lossy())], std::time::Duration::from_secs(120))
            .await
            .map_err(|e| if e.contains("NOWORD") { "Word non si apre su questo PC.".to_string() } else { format!("Word non ha creato il PDF: {e}") })?;
        std::fs::read(&out).map_err(|_| "Word non ha creato il PDF.".to_string())
    }
    .await;
    let _ = std::fs::remove_dir_all(&work);
    done
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc_with(body: &str) -> Vec<(String, Vec<u8>)> {
        let mut e = blank("", "");
        let xml = format!("<?xml version=\"1.0\"?><w:document xmlns:w=\"x\"><w:body>{body}<w:sectPr/></w:body></w:document>");
        if let Some(d) = e.iter_mut().find(|(n, _)| n == "word/document.xml") {
            d.1 = xml.into_bytes();
        }
        e
    }

    #[test]
    fn a_placeholder_split_across_runs_is_filled() {
        let xml = r#"<w:p><w:r><w:t>Gentile {cli</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ente}, il </w:t></w:r><w:r><w:t>{{data}}</w:t></w:r></w:p>"#;
        let values: HashMap<String, String> = [("cliente".into(), "Rossi & C.".into()), ("data".into(), "7/11/2026".into())].into();
        let (out, missing) = fill_part(xml, &values, &HashMap::new(), &mut Vec::new());
        assert!(missing.is_empty());
        let e = doc_with(&out);
        let text = markdown(&crate::ooxzip::write(&e).unwrap()).unwrap();
        assert_eq!(text, "Gentile Rossi & C., il 7/11/2026");
        assert!(out.contains("Rossi &amp; C."));
    }

    #[test]
    fn unknown_placeholders_stay_and_are_reported() {
        let xml = r#"<w:p><w:r><w:t>{numero} e {ignoto} e {non un segnaposto!}</w:t></w:r></w:p>"#;
        let values: HashMap<String, String> = [("numero".into(), "3/2026".into())].into();
        let (out, missing) = fill_part(xml, &values, &HashMap::new(), &mut Vec::new());
        assert_eq!(missing, vec!["ignoto".to_string()]);
        assert!(out.contains("3/2026 e {ignoto} e {non un segnaposto!}"));
    }

    #[test]
    fn a_body_takes_the_place_of_its_paragraph() {
        let xml = r#"<w:p><w:r><w:t>Prima</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>{corpo}</w:t></w:r></w:p><w:p><w:r><w:t>Dopo</w:t></w:r></w:p>"#;
        let look = Look::of(Some(BLANK_STYLES));
        let blocks: HashMap<String, String> = [("corpo".into(), body_xml("# Oggetto\n\nTesto **forte**.\n\n- uno\n- due\n\n| A | B |\n|---|---|\n| 1 | 2 |", &look))].into();
        let (out, _) = fill_part(xml, &HashMap::new(), &blocks, &mut Vec::new());
        let text = markdown(&crate::ooxzip::write(&doc_with(&out)).unwrap()).unwrap();
        assert_eq!(text, "Prima\n\n# Oggetto\n\nTesto forte.\n\n•\tuno\n\n•\tdue\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nDopo");
    }

    #[test]
    fn totals_and_vat_are_computed_here() {
        let lines = lines_of(Some(&serde_json::json!([
            { "descrizione": "Installazione", "quantita": 2, "prezzo": "1.234,50", "iva": 22 },
            { "descrizione": "Libro", "prezzo": 10, "iva": "4%" }
        ]))).unwrap();
        let t = totals(&lines);
        assert_eq!(t.taxable, 247_900);
        assert_eq!(t.vat, vec![(4.0, 40), (22.0, 54_318)]);
        assert_eq!(t.total, 302_258);
        assert_eq!(money(t.total), "3.022,58 €");
        assert_eq!(money(5), "0,05 €");
        assert!(lines_of(Some(&serde_json::json!([{ "descrizione": "x" }]))).is_err());
        // From a supplier: cost plus markup, and a price with VAT inside taken out.
        let l = lines_of(Some(&serde_json::json!([
            { "descrizione": "AP", "costo": 199.64, "ricarico": "20%", "ivato": true },
            { "descrizione": "Cavo", "costo": "10,00", "ricarico": 30 },
            { "descrizione": "Switch", "prezzo": 122, "ivato": true }
        ]))).unwrap();
        assert_eq!((l[0].price, l[1].price, l[2].price), (196.37, 13.0, 100.0));
        assert!(lines_of(Some(&serde_json::json!([{ "descrizione": "x", "costo": 1, "ricarico": 5000 }]))).is_err());
    }

    #[test]
    fn pictures_go_in_the_body_with_their_size() {
        // A PNG header is enough to know the size: 800 × 400 pixels.
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        png.extend_from_slice(&800u32.to_be_bytes());
        png.extend_from_slice(&400u32.to_be_bytes());
        png.extend_from_slice(&[8, 6, 0, 0, 0]);
        assert_eq!(image_kind(&png), Some(("png", 800, 400)));
        let body = "Prima\n\n![Logo del cliente|4cm](C:\\x\\logo.png)\n\nDopo";
        assert_eq!(image_refs(body), vec!["C:\\x\\logo.png".to_string()]);
        let req = Request {
            template: String::new(),
            title: String::new(),
            values: HashMap::new(),
            body: body.into(),
            lines: Vec::new(),
            pictures: [("C:\\x\\logo.png".to_string(), Picture { bytes: png })].into(),
        };
        let made = make(&req).unwrap();
        let entries = crate::ooxzip::read(&made.bytes).unwrap();
        assert!(entries.iter().any(|(n, _)| n == "word/media/ei_immagine1.png"));
        let doc = part_text(&entries, "word/document.xml").unwrap();
        assert!(doc.contains("cx=\"1440000\" cy=\"720000\""), "{doc}");
        assert!(part_text(&entries, "[Content_Types].xml").unwrap().contains("Extension=\"png\""));
        assert!(part_text(&entries, "word/_rels/document.xml.rels").unwrap().contains("rIdEiPic1"));
        assert_eq!(markdown(&made.bytes).unwrap(), "Prima\n\n[immagine: Logo del cliente]\n\nDopo");
        assert!(make(&Request { pictures: [("C:\\x\\logo.png".to_string(), Picture { bytes: b"no".to_vec() })].into(), ..req }).is_err());
    }

    #[test]
    fn a_blank_document_reads_back() {
        let req = Request {
            template: String::new(),
            title: "Offerta".into(),
            values: HashMap::new(),
            body: "## Premessa\nRiga uno\nRiga due".into(),
            lines: lines_of(Some(&serde_json::json!([{ "descrizione": "Servizio", "prezzo": 100 }]))).unwrap(),
            pictures: HashMap::new(),
        };
        let made = make(&req).unwrap();
        let text = markdown(&made.bytes).unwrap();
        assert!(text.starts_with("# Offerta\n\n## Premessa\n\nRiga uno\nRiga due\n\n| Descrizione | Q.tà |"), "{text}");
        assert!(text.contains("| Totale |  |  |  | 122,00 € |"), "{text}");
        assert_eq!(made.totals.unwrap().total, 12_200);
    }

    #[test]
    fn reading_skips_fallbacks_and_tab_stops() {
        let xml = r#"<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="1"/></w:tabs></w:pPr><w:r><w:t>A</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">B &amp; C</w:t></w:r><mc:AlternateContent><mc:Choice><w:t>X</w:t></mc:Choice><mc:Fallback><w:t>X</w:t></mc:Fallback></mc:AlternateContent></w:p>"#;
        assert_eq!(part_markdown(xml, &HashMap::new()), vec!["A\tB & CX".to_string()]);
    }

    #[test]
    fn attributes_are_found_by_their_whole_name() {
        assert_eq!(attr(r#"<w:style w:type="paragraph" w:styleId="Titolo1">"#, "w:styleId"), Some("Titolo1"));
        assert_eq!(attr(r#"<w:pStyle w:val='x'/>"#, "w:val"), Some("x"));
        assert_eq!(attr(r#"<w:pStyle w:valx="y"/>"#, "w:val"), None);
    }
}

#[cfg(test)]
mod live {
    /// EI_DOCX_OUT=folder: writes a blank document and one filled from EI_TEMPLATE (a .docx), to open in Word.
    #[test]
    #[ignore]
    fn write_samples() {
        let out = std::path::PathBuf::from(std::env::var("EI_DOCX_OUT").unwrap());
        let lines = super::lines_of(Some(&serde_json::json!([
            { "descrizione": "Installazione **server**", "quantita": 2, "prezzo": "1.234,50" },
            { "descrizione": "Libro", "prezzo": 10, "iva": 4 }
        ]))).unwrap();
        let body = "# Oggetto dell'offerta\n\nGentile cliente,\nle inviamo la nostra **migliore** offerta.\n\n## Punti\n\n- primo punto\n- secondo *punto*\n  - sotto punto\n1. numerato\n\n| Voce | Valore |\n|---|---|\n| Tempo | 3 giorni |\n| Costo | 100 € |\n\nCordiali saluti.";
        let req = super::Request { template: String::new(), title: "Offerta di prova".into(), values: Default::default(), body: body.into(), lines: lines.clone(), pictures: Default::default() };
        std::fs::write(out.join("vuoto.docx"), super::make(&req).unwrap().bytes).unwrap();
        // EI_IMAGES = pictures separated by ";": one at its size, the others 5 cm wide.
        if let Ok(list) = std::env::var("EI_IMAGES") {
            let mut md = String::from("# Con immagini\n\nTesto prima.\n");
            let mut pictures = std::collections::HashMap::new();
            for (i, p) in list.split(';').enumerate() {
                md.push_str(&if i == 0 { format!("\n![Prima immagine]({p})\n") } else { format!("\n![Immagine {i}|5cm]({p})\n") });
                pictures.insert(p.to_string(), super::Picture { bytes: std::fs::read(p).unwrap() });
            }
            md.push_str("\nTesto dopo.");
            let req = super::Request { template: std::env::var("EI_TEMPLATE_NAME").unwrap_or_default(), title: "Immagini".into(), values: Default::default(), body: md, lines: Vec::new(), pictures };
            std::fs::write(out.join("immagini.docx"), super::make(&req).unwrap().bytes).unwrap();
        }
        if let Ok(t) = std::env::var("EI_TEMPLATE") {
            let entries = crate::ooxzip::read(&std::fs::read(&t).unwrap()).unwrap();
            println!("segnaposto: {:?}", super::placeholders(&entries));
            let mut values = std::collections::HashMap::new();
            values.insert("cliente".to_string(), "Farmacia Rossi".to_string());
            let look = super::Look::of(super::part_text(&entries, "word/styles.xml").as_deref());
            let blocks: std::collections::HashMap<String, String> = [("corpo".to_string(), super::body_xml(body, &look)), ("righe".to_string(), super::quote_table(&lines, &super::totals(&lines)))].into();
            let mut e = entries.clone();
            let mut used = Vec::new();
            for (name, data) in e.iter_mut() {
                if super::is_text_part(name) {
                    let (f, _) = super::fill_part(&String::from_utf8_lossy(data), &values, &blocks, &mut used);
                    *data = f.into_bytes();
                }
            }
            let mut tail = String::new();
            for k in ["corpo", "righe"] { if !used.iter().any(|u| u == k) { tail.push_str(&blocks[k]); } }
            if let Some((_, d)) = e.iter_mut().find(|(n, _)| n == "word/document.xml") { *d = super::append_to_body(&String::from_utf8_lossy(d), &tail).into_bytes(); }
            std::fs::write(out.join("modello.docx"), crate::ooxzip::write(&e).unwrap()).unwrap();
        }
    }

    /// EI_READ=file: prints its text (.docx or .pdf).
    #[test]
    #[ignore]
    fn read_file() {
        let p = std::env::var("EI_READ").unwrap();
        let b = std::fs::read(&p).unwrap();
        let t = if p.to_lowercase().ends_with(".pdf") { crate::pdftext::text(&b) } else { super::markdown(&b) };
        println!("=====\n{}\n=====", t.unwrap_or_else(|e| format!("ERRORE {e}")));
    }
}

#[cfg(test)]
mod live_make {
    /// APPDATA=scratch with EasyIsland\documenti\modelli\<EI_TEMPLATE_NAME>.docx; EI_DOCX_OUT=folder.
    #[test]
    #[ignore]
    fn make_from_template() {
        let out = std::path::PathBuf::from(std::env::var("EI_DOCX_OUT").unwrap());
        println!("{}", super::template_list());
        let lines = super::lines_of(Some(&serde_json::json!([{ "descrizione": "Assistenza", "quantita": 3, "prezzo": 45 }]))).unwrap();
        let req = super::Request {
            template: std::env::var("EI_TEMPLATE_NAME").unwrap(),
            title: "Preventivo".into(),
            values: [("Cliente".to_string(), "Farmacia Rossi".to_string())].into(),
            body: "Come da accordi telefonici.".into(),
            lines,
            pictures: Default::default(),
        };
        for i in 0..2 {
            let made = super::make(&req).unwrap();
            println!("numero {:?} mancanti {:?}", made.number, made.missing);
            std::fs::write(out.join(format!("completo-{i}.docx")), made.bytes).unwrap();
        }
    }
}
