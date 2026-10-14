// "Sostituisci" with the formatting kept: the selection's HTML ("HTML Format"
// on the clipboard, what Word, Outlook and the browsers copy) goes to the model
// as text with numbered marks (⟦1⟧, ⟦2⟧…) where the tags were; the reply is put
// back together with the very same tags (styles, links, Word's classes), so the
// rewritten text pastes looking like the original. When the model loses or
// reorders a mark, the rewrite is pasted as plain text and the card says so.
//
// Everything outside the copied fragment (Word's <head> with its styles) is kept
// as it was, so a paste back into the same app keeps fonts and sizes too.

use windows::core::w;
use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, RegisterClipboardFormatW};
use windows::Win32::System::Ole::CF_UNICODETEXT;

use crate::i18n::t;

/// More marks than this and the model is likely to lose some (a big table):
/// the rewrite goes as plain text.
const MAX_MARKS: usize = 150;

/// The CF_HTML document: what comes before the fragment, the fragment, what follows.
#[derive(Clone, Debug, PartialEq)]
pub struct Clip {
    head: String,
    pub fragment: String,
    tail: String,
}

fn html_format() -> u32 {
    unsafe { RegisterClipboardFormatW(w!("HTML Format")) }
}

/// The HTML on the clipboard (call with the clipboard just written by a copy).
pub fn read_clipboard() -> Option<Clip> {
    let format = html_format();
    if format == 0 {
        return None;
    }
    let mut bytes = unsafe {
        if !crate::clipimage::open() {
            return None;
        }
        let b = crate::clipimage::read_format(format);
        let _ = CloseClipboard();
        b?
    };
    if let Some(end) = bytes.iter().position(|&b| b == 0) {
        bytes.truncate(end);
    }
    parse(&String::from_utf8(bytes).ok()?)
}

/// CF_HTML: a header of "Key:value" lines with byte offsets, then the document.
pub fn parse(raw: &str) -> Option<Clip> {
    let num = |key: &str| -> Option<i64> {
        raw.lines()
            .take(12)
            .find_map(|l| l.strip_prefix(key)?.strip_prefix(':').map(|v| v.trim().parse::<i64>().ok()))
            .flatten()
    };
    let frag_start = usize::try_from(num("StartFragment")?).ok()?;
    let frag_end = usize::try_from(num("EndFragment")?).ok()?;
    // StartHTML may be -1 (no document around the fragment).
    let html_start = num("StartHTML").and_then(|v| usize::try_from(v).ok()).unwrap_or(frag_start);
    let html_end = num("EndHTML").and_then(|v| usize::try_from(v).ok()).unwrap_or(frag_end).max(frag_end);
    if html_start > frag_start || frag_start > frag_end {
        return None;
    }
    Some(Clip {
        head: raw.get(html_start..frag_start)?.to_string(),
        fragment: raw.get(frag_start..frag_end)?.to_string(),
        tail: raw.get(frag_end..html_end.min(raw.len()))?.to_string(),
    })
}

impl Clip {
    /// The CF_HTML bytes with `fragment` in place of the copied one.
    pub fn with_fragment(&self, fragment: &str) -> String {
        let (head, tail) = if self.head.is_empty() {
            ("<html><body><!--StartFragment-->", "<!--EndFragment--></body></html>")
        } else {
            (self.head.as_str(), self.tail.as_str())
        };
        let header = |a: usize, b: usize, c: usize, d: usize| {
            format!("Version:0.9\r\nStartHTML:{a:010}\r\nEndHTML:{b:010}\r\nStartFragment:{c:010}\r\nEndFragment:{d:010}\r\n")
        };
        let n = header(0, 0, 0, 0).len();
        let start = n + head.len();
        let end = start + fragment.len();
        format!("{}{head}{fragment}{tail}", header(n, end + tail.len(), start, end))
    }
}

/// What the gap of tags between two pieces of text stands for in plain text.
#[derive(Clone, Copy, Debug, PartialEq, PartialOrd)]
enum Gap {
    None,
    Space,
    Block,
}

#[derive(Clone, Debug)]
struct Run {
    html: String,
    gap: Gap,
}

/// A fragment as text for the model, with its tags set aside.
#[derive(Clone, Debug)]
pub struct Marked {
    /// What the model reads: the text with ⟦n⟧ where the tags were.
    pub text: String,
    prefix: String,
    suffix: String,
    runs: Vec<Run>,
}

const BLOCKS: &[&str] = &[
    "p", "div", "br", "li", "ul", "ol", "tr", "td", "th", "table", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
];

enum Tok<'a> {
    Text(&'a str),
    Tag(&'a str),
}

fn tag_name(tag: &str) -> String {
    tag.trim_start_matches('<')
        .trim_start_matches('/')
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == ':')
        .collect::<String>()
        .to_ascii_lowercase()
}

/// Where the tag starting at `i` ends (exclusive): quotes in attributes, comments,
/// and the contents of <style>/<script> belong to the tag.
fn tag_end(s: &str, i: usize) -> usize {
    let rest = s.get(i..).unwrap_or("");
    if rest.starts_with("<!--") {
        return rest.get(4..).and_then(|r| r.find("-->")).map_or(s.len(), |p| i + 4 + p + 3);
    }
    let mut quote: Option<char> = None;
    let mut end = s.len();
    for (k, c) in rest.char_indices().skip(1) {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if c == '"' || c == '\'' => quote = Some(c),
            None if c == '>' => {
                end = i + k + 1;
                break;
            }
            None => {}
        }
    }
    let tag = s.get(i..end).unwrap_or("");
    let name = tag_name(tag);
    if !tag.starts_with("</") && (name == "style" || name == "script") {
        let close = format!("</{name}");
        let after = s.get(end..).unwrap_or("");
        if let Some(p) = after.to_ascii_lowercase().find(&close) {
            let from = end + p;
            return s.get(from..).and_then(|r| r.find('>')).map_or(s.len(), |q| from + q + 1);
        }
        return s.len();
    }
    end
}

fn tokens(s: &str) -> Vec<Tok<'_>> {
    let mut out = Vec::new();
    let mut text_from = 0;
    let mut i = 0;
    let bytes = s.as_bytes();
    while i < bytes.len() {
        let next = bytes.get(i + 1).copied().unwrap_or(0);
        if bytes.get(i) == Some(&b'<') && (next.is_ascii_alphabetic() || matches!(next, b'/' | b'!' | b'?')) {
            if text_from < i {
                out.push(Tok::Text(s.get(text_from..i).unwrap_or("")));
            }
            let end = tag_end(s, i).max(i + 1);
            out.push(Tok::Tag(s.get(i..end).unwrap_or("")));
            i = end;
            text_from = end;
        } else {
            i += 1;
        }
    }
    if text_from < s.len() {
        out.push(Tok::Text(s.get(text_from..).unwrap_or("")));
    }
    out
}

/// HTML entities to characters (the common ones; an unknown one stays as written).
fn decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(p) = rest.find('&') {
        out.push_str(rest.get(..p).unwrap_or(""));
        let after = rest.get(p + 1..).unwrap_or("");
        let semi = after.find(';').filter(|&n| n <= 10);
        let ch = semi.and_then(|n| {
            let name = after.get(..n)?;
            if let Some(num) = name.strip_prefix('#') {
                let code = match num.strip_prefix(['x', 'X']) {
                    Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                    None => num.parse().ok()?,
                };
                return char::from_u32(code);
            }
            Some(match name {
                "amp" => '&', "lt" => '<', "gt" => '>', "quot" => '"', "apos" => '\'', "nbsp" => '\u{a0}',
                "agrave" => 'à', "egrave" => 'è', "eacute" => 'é', "igrave" => 'ì', "ograve" => 'ò', "ugrave" => 'ù',
                "Agrave" => 'À', "Egrave" => 'È', "Eacute" => 'É', "laquo" => '«', "raquo" => '»',
                "lsquo" => '‘', "rsquo" => '’', "ldquo" => '“', "rdquo" => '”', "hellip" => '…',
                "ndash" => '–', "mdash" => '—', "euro" => '€', "copy" => '©', "reg" => '®', "deg" => '°',
                _ => return None,
            })
        });
        match (ch, semi) {
            (Some(c), Some(n)) => {
                out.push(c);
                rest = after.get(n + 1..).unwrap_or("");
            }
            _ => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Runs of spaces, tabs and line ends count as one space, as in a browser.
fn collapse(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = false;
    for c in s.chars() {
        if c.is_whitespace() {
            if !space {
                out.push(' ');
            }
            space = true;
        } else {
            out.push(c);
            space = false;
        }
    }
    out
}

/// Text for the HTML: markup characters and anything beyond ASCII as references
/// (safe whatever charset the document claims).
fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '\n' => out.push_str("<br>"),
            c if c.is_ascii() => out.push(c),
            c => out.push_str(&format!("&#{};", c as u32)),
        }
    }
    out
}

enum Item {
    Text(String),
    Run(Run),
}

/// The fragment as text with marks; None when there is no text or too many marks.
pub fn mark(fragment: &str) -> Option<Marked> {
    let mut items: Vec<Item> = Vec::new();
    for tok in tokens(fragment) {
        let (html, gap, text) = match tok {
            Tok::Tag(tag) => {
                let block = BLOCKS.contains(&tag_name(tag).as_str()) && !tag.starts_with("<!");
                (tag, if block { Gap::Block } else { Gap::None }, None)
            }
            Tok::Text(raw) => {
                let decoded = decode(raw);
                if decoded.chars().all(char::is_whitespace) {
                    // Only spacing between tags: it stays with them, as written.
                    (raw, Gap::Space, None)
                } else {
                    (raw, Gap::None, Some(collapse(&decoded)))
                }
            }
        };
        match (text, items.last_mut()) {
            (Some(t), _) => items.push(Item::Text(t)),
            (None, Some(Item::Run(run))) => {
                run.html.push_str(html);
                if gap > run.gap {
                    run.gap = gap;
                }
            }
            (None, _) => items.push(Item::Run(Run { html: html.to_string(), gap })),
        }
    }
    if !items.iter().any(|i| matches!(i, Item::Text(_))) {
        return None;
    }
    let mut prefix = String::new();
    let mut suffix = String::new();
    if let Some(Item::Run(_)) = items.first() {
        if let Item::Run(r) = items.remove(0) {
            prefix = r.html;
        }
    }
    if let Some(Item::Run(_)) = items.last() {
        if let Some(Item::Run(r)) = items.pop() {
            suffix = r.html;
        }
    }
    let mut text = String::new();
    let mut runs = Vec::new();
    for item in items {
        match item {
            Item::Text(t) => text.push_str(&t),
            Item::Run(r) => {
                runs.push(r.clone());
                text.push_str(&format!("⟦{}⟧", runs.len()));
                if r.gap == Gap::Block {
                    text.push('\n');
                }
            }
        }
    }
    if runs.len() > MAX_MARKS {
        return None;
    }
    let text = text.lines().map(str::trim).collect::<Vec<_>>().join("\n");
    Some(Marked { text: text.trim().to_string(), prefix, suffix, runs })
}

/// The reply cut at its marks: the pieces of text and the mark numbers between them.
fn split_marks(reply: &str) -> (Vec<String>, Vec<usize>) {
    let mut texts = vec![String::new()];
    let mut marks = Vec::new();
    let mut rest = reply;
    while let Some(p) = rest.find('⟦') {
        let after = rest.get(p + '⟦'.len_utf8()..).unwrap_or("");
        let close = after.find('⟧');
        let n = close.and_then(|c| after.get(..c)?.trim().parse::<usize>().ok());
        match (n, close) {
            (Some(n), Some(c)) => {
                if let Some(last) = texts.last_mut() {
                    last.push_str(rest.get(..p).unwrap_or(""));
                }
                marks.push(n);
                texts.push(String::new());
                rest = after.get(c + '⟧'.len_utf8()..).unwrap_or("");
            }
            _ => {
                if let Some(last) = texts.last_mut() {
                    last.push_str(rest.get(..p + '⟦'.len_utf8()).unwrap_or(""));
                }
                rest = after;
            }
        }
    }
    if let Some(last) = texts.last_mut() {
        last.push_str(rest);
    }
    (texts, marks)
}

impl Marked {
    /// How many marks the reply must keep.
    pub fn marks(&self) -> usize {
        self.runs.len()
    }

    fn gap(&self, n: usize) -> Gap {
        n.checked_sub(1).and_then(|i| self.runs.get(i)).map_or(Gap::None, |r| r.gap)
    }

    /// Plain text of a reply: marks of paragraphs become line ends, the others go.
    pub fn plain(&self, reply: &str) -> String {
        let (texts, marks) = split_marks(reply);
        let mut out = String::new();
        for (i, piece) in texts.iter().enumerate() {
            // After a paragraph mark the line end is already there.
            let after_block = i > 0 && marks.get(i - 1).is_some_and(|&n| self.gap(n) == Gap::Block);
            out.push_str(if after_block { piece.trim_start() } else { piece });
            match marks.get(i).map(|&n| self.gap(n)) {
                Some(Gap::Block) => {
                    while out.ends_with([' ', '\t']) {
                        out.pop();
                    }
                    if !out.ends_with('\n') {
                        out.push('\n');
                    }
                }
                Some(Gap::Space) if !out.ends_with(char::is_whitespace) => out.push(' '),
                _ => {}
            }
        }
        out.lines().map(str::trim).collect::<Vec<_>>().join("\n").trim().to_string()
    }

    /// The reply as HTML with the original tags back in place, if every mark is
    /// there once and in order.
    pub fn rebuild(&self, reply: &str) -> Option<String> {
        let (texts, marks) = split_marks(reply);
        if marks.len() != self.runs.len() || marks.iter().enumerate().any(|(i, &n)| n != i + 1) {
            return None;
        }
        let mut html = self.prefix.clone();
        for (i, piece) in texts.iter().enumerate() {
            let block_before = i > 0 && self.gap(i) == Gap::Block;
            let block_after = self.runs.get(i).is_some_and(|r| r.gap == Gap::Block);
            let mut piece = piece.as_str();
            if block_before || i == 0 {
                piece = piece.trim_start();
            }
            if block_after || i == self.runs.len() {
                piece = piece.trim_end();
            }
            html.push_str(&escape(piece));
            if let Some(run) = self.runs.get(i) {
                html.push_str(&run.html);
            }
        }
        html.push_str(&self.suffix);
        Some(html)
    }
}

/// Puts `text`, and `html` (CF_HTML) when given, on the clipboard: an app that
/// takes formatted text pastes the HTML, the others the text.
pub fn set_clipboard(text: &str, html: Option<&str>) -> Result<(), String> {
    let mut wide: Vec<u8> = Vec::with_capacity(text.len() * 2 + 2);
    for u in text.encode_utf16().chain(std::iter::once(0)) {
        wide.extend_from_slice(&u.to_le_bytes());
    }
    unsafe {
        if !crate::clipimage::open() {
            return Err(t("Gli appunti sono occupati da un'altra app").into());
        }
        let result = (|| {
            EmptyClipboard().map_err(|e| e.to_string())?;
            crate::clipimage::put(CF_UNICODETEXT.0 as u32, &wide)?;
            if let Some(html) = html {
                let format = html_format();
                if format != 0 {
                    let mut bytes = html.as_bytes().to_vec();
                    bytes.push(0);
                    crate::clipimage::put(format, &bytes)?;
                }
            }
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cf(fragment: &str) -> String {
        let clip = Clip {
            head: "<html><head><style>p{font-family:Aptos}</style></head><body><!--StartFragment-->".into(),
            fragment: String::new(),
            tail: "<!--EndFragment--></body></html>".into(),
        };
        clip.with_fragment(fragment)
    }

    #[test]
    fn reads_back_what_it_writes() {
        let raw = cf("<b>Ciao</b> mondo");
        let clip = parse(&raw).unwrap();
        assert_eq!(clip.fragment, "<b>Ciao</b> mondo");
        assert!(clip.head.contains("font-family:Aptos"));
        assert_eq!(parse(&clip.with_fragment("x")).unwrap().fragment, "x");
        assert!(parse("Version:0.9\r\nStartFragment:9999\r\nEndFragment:10000\r\n").is_none());
        assert!(parse("niente").is_none());
    }

    #[test]
    fn marks_and_rebuilds_with_the_same_tags() {
        let frag = "<span style='color:red'>Ciao <b>mondo</b></span>, vedi <a href=\"https://x.it\">il sito</a>.";
        let m = mark(frag).unwrap();
        assert_eq!(m.text, "Ciao ⟦1⟧mondo⟦2⟧, vedi ⟦3⟧il sito⟦4⟧.");
        let html = m.rebuild("Salve ⟦1⟧gente⟦2⟧, guarda ⟦3⟧la pagina⟦4⟧.").unwrap();
        assert_eq!(html, "<span style='color:red'>Salve <b>gente</b></span>, guarda <a href=\"https://x.it\">la pagina</a>.");
        assert_eq!(m.plain("Salve ⟦1⟧gente⟦2⟧, guarda ⟦3⟧la pagina⟦4⟧."), "Salve gente, guarda la pagina.");
    }

    #[test]
    fn a_lost_or_moved_mark_means_plain_text() {
        let m = mark("<b>uno</b> due <i>tre</i>").unwrap();
        assert_eq!(m.text, "uno⟦1⟧ due ⟦2⟧tre");
        assert!(m.rebuild("uno due tre").is_none());
        assert!(m.rebuild("⟦2⟧uno⟦1⟧ due").is_none());
        assert!(m.rebuild("uno⟦1⟧ due ⟦1⟧tre").is_none());
        assert_eq!(m.plain("uno⟦2⟧ due"), "uno due");
    }

    #[test]
    fn paragraphs_become_lines() {
        let frag = "<p class=MsoNormal>Primo paragrafo<o:p></o:p></p>\r\n<p class=MsoNormal>Secondo &egrave; qui<o:p></o:p></p>";
        let m = mark(frag).unwrap();
        assert_eq!(m.text, "Primo paragrafo⟦1⟧\nSecondo è qui");
        let reply = "Paragrafo uno⟦1⟧\nIl secondo è qui";
        assert_eq!(m.plain(reply), "Paragrafo uno\nIl secondo è qui");
        assert_eq!(
            m.rebuild(reply).unwrap(),
            "<p class=MsoNormal>Paragrafo uno<o:p></o:p></p>\r\n<p class=MsoNormal>Il secondo &#232; qui<o:p></o:p></p>"
        );
    }

    #[test]
    fn markup_in_the_reply_is_text() {
        let m = mark("<b>a</b>").unwrap();
        assert_eq!(m.text, "a");
        assert_eq!(m.rebuild("x < y & z").unwrap(), "<b>x &lt; y &amp; z</b>");
    }

    #[test]
    fn comments_styles_and_odd_input() {
        let m = mark("<!--[if gte mso 9]><x>1</x><![endif]--><style>b{}</style>testo").unwrap();
        assert_eq!(m.text, "testo");
        assert!(mark("<br><b></b>").is_none());
        assert!(mark("a < b e c > d").is_some());
        assert_eq!(mark("&amp;&unknown; &#x41;&#66;").unwrap().text, "&&unknown; AB");
        // Unclosed tag, broken entity, stray marks: no panic.
        let m = mark("<b attr='x>testo &#xZZ;").unwrap_or_else(|| mark("x").unwrap());
        let _ = m.rebuild("⟦⟦1⟧⟧ ⟦999999999999999999999⟧ ⟦");
        let _ = m.plain("⟦");
    }
}

/// Live check with Word: put a copy from Word on the clipboard first, then
/// `cargo test --lib richtext::live -- --ignored --nocapture`: the clipboard
/// gets the same HTML with the words changed, as a rewrite would leave it.
#[cfg(test)]
mod live {
    #[test]
    #[ignore]
    fn rewrite_what_is_on_the_clipboard() {
        let clip = super::read_clipboard().expect("niente HTML negli appunti");
        let marked = super::mark(&clip.fragment).expect("niente testo");
        println!("al modello: {:?}", marked.text);
        let reply = marked.text.replace("Capitolo", "Sezione").replace("forte", "nuova");
        let fragment = marked.rebuild(&reply).expect("segni persi");
        println!("frammento: {fragment}");
        super::set_clipboard(&marked.plain(&reply), Some(&clip.with_fragment(&fragment))).unwrap();
    }
}
