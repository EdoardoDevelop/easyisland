// Merging and splitting PDFs for the chat (docs/chat.md → Documenti Word e PDF):
// pages are copied from the files read by pdftext.rs into a new file, with the
// objects they use renumbered. The originals are never changed. Like the
// reader, it only uses `get` on the file's bytes: a strange file is an error,
// never a panic.
//
// What is lost: form fields (AcroForm), bookmarks, links to pages left out;
// encrypted files are refused.

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Write as _;

use crate::pdftext::{Doc, Obj};

const MAX_OUT: usize = 300 * 1024 * 1024;
const MAX_OBJECTS: usize = 2_000_000;
/// Attributes a page takes from its parents in the page tree.
const INHERITED: [&str; 4] = ["Resources", "MediaBox", "CropBox", "Rotate"];

/// A PDF read for its pages.
pub struct Source {
    doc: Doc,
    /// Object number (if any) and dictionary of each page, inherited attributes included.
    pages: Vec<(Option<u32>, Vec<(String, Obj)>)>,
}

impl Source {
    pub fn read(bytes: &[u8]) -> Result<Source, String> {
        if !bytes.get(..1024).unwrap_or(bytes).windows(5).any(|w| w == b"%PDF-") {
            return Err("Non è un file PDF.".into());
        }
        let doc = Doc::read(bytes);
        if doc.encrypted() {
            return Err("Il PDF è protetto (cifrato), anche se magari si apre senza password: non posso copiarne le pagine. Si può aprirlo e stamparlo con «Microsoft Print to PDF», poi unire quella copia.".into());
        }
        let pages = page_list(&doc);
        if pages.is_empty() {
            return Err("Nel PDF non trovo pagine.".into());
        }
        Ok(Source { doc, pages })
    }

    pub fn count(&self) -> usize {
        self.pages.len()
    }
}

fn page_list(doc: &Doc) -> Vec<(Option<u32>, Vec<(String, Obj)>)> {
    let root = doc
        .trailers
        .iter()
        .rev()
        .find_map(|t| t.get("Root"))
        .map(|r| doc.resolve(r))
        .filter(|r| r.dict().is_some())
        .or_else(|| doc.objects.values().find(|o| o.get("Type").and_then(Obj::name) == Some("Catalog")));
    let mut out = Vec::new();
    if let Some(tree) = root.and_then(|r| r.get("Pages")) {
        let mut seen = HashSet::new();
        walk(doc, tree, &[], &mut out, &mut seen, 0);
    }
    if out.is_empty() {
        let mut ids: Vec<u32> = doc.objects.iter().filter(|(_, o)| o.get("Type").and_then(Obj::name) == Some("Page")).map(|(id, _)| *id).collect();
        ids.sort_unstable();
        for id in ids {
            if let Some(d) = doc.objects.get(&id).and_then(Obj::dict) {
                out.push((Some(id), d.to_vec()));
            }
        }
    }
    out
}

fn walk(doc: &Doc, node: &Obj, inherited: &[(String, Obj)], out: &mut Vec<(Option<u32>, Vec<(String, Obj)>)>, seen: &mut HashSet<u32>, depth: usize) {
    if depth > 64 || out.len() >= 10_000 {
        return;
    }
    let id = match node {
        Obj::Ref(id) => {
            if !seen.insert(*id) {
                return;
            }
            Some(*id)
        }
        _ => None,
    };
    let Some(dict) = doc.resolve(node).dict() else { return };
    let mut inh: Vec<(String, Obj)> = inherited.to_vec();
    for key in INHERITED {
        if let Some((_, v)) = dict.iter().rev().find(|(k, _)| k == key) {
            inh.retain(|(k, _)| k != key);
            inh.push((key.to_string(), v.clone()));
        }
    }
    match dict.iter().rev().find(|(k, _)| k == "Kids").map(|(_, v)| doc.resolve(v)) {
        Some(Obj::Arr(kids)) => {
            for k in kids {
                walk(doc, k, &inh, out, seen, depth + 1);
            }
        }
        _ => {
            let mut page: Vec<(String, Obj)> = dict.iter().filter(|(k, _)| k != "Parent").cloned().collect();
            for (k, v) in inh {
                if !page.iter().any(|(pk, _)| *pk == k) {
                    page.push((k, v));
                }
            }
            if !page.iter().any(|(k, _)| k == "MediaBox") {
                page.push(("MediaBox".into(), Obj::Arr([0.0, 0.0, 595.0, 842.0].map(Obj::Num).to_vec())));
            }
            out.push((id, page));
        }
    }
}

/// "1-3, 5, 8-" (1 = the first page) → page indexes, in the order given.
pub fn parse_pages(spec: &str, count: usize) -> Result<Vec<usize>, String> {
    let spec = spec.trim().to_lowercase();
    if spec.is_empty() || spec == "tutte" || spec == "all" {
        return Ok((0..count).collect());
    }
    let mut out = Vec::new();
    for part in spec.split([',', ';', ' ']).map(str::trim).filter(|p| !p.is_empty()) {
        let num = |s: &str, default: usize| -> Result<usize, String> {
            let s = s.trim();
            if s.is_empty() {
                return Ok(default);
            }
            if s == "ultima" || s == "last" {
                return Ok(count);
            }
            s.parse::<usize>().map_err(|_| format!("«{part}» non è un numero di pagina."))
        };
        let (a, b) = match part.split_once('-') {
            Some((a, b)) => (num(a, 1)?, num(b, count)?),
            None => {
                let n = num(part, 1)?;
                (n, n)
            }
        };
        if a == 0 || b == 0 || a > count || b > count {
            return Err(format!("Pagina fuori dal documento in «{part}»: il PDF ha {count} pagine."));
        }
        if a <= b {
            out.extend(a - 1..b);
        } else {
            out.extend((b - 1..a).rev());
        }
    }
    if out.is_empty() {
        return Err("Nessuna pagina scelta.".into());
    }
    Ok(out)
}

/// A new PDF with the chosen pages of each source, in order.
pub fn assemble(parts: &[(&Source, Vec<usize>)]) -> Result<Vec<u8>, String> {
    // New objects, numbered from 1: 1 is the catalog, 2 the page tree.
    let mut objs: Vec<Obj> = vec![Obj::Null, Obj::Null];
    let mut kids = Vec::new();
    for (src, wanted) in parts {
        let all_pages: HashSet<u32> = src.pages.iter().filter_map(|p| p.0).collect();
        let mut map: HashMap<u32, u32> = HashMap::new();
        let mut queue: VecDeque<u32> = VecDeque::new();
        // Pages first, so links between chosen pages keep working.
        let mut slots = Vec::new();
        for &i in wanted {
            let Some((id, dict)) = src.pages.get(i) else { continue };
            objs.push(Obj::Null);
            let new = objs.len() as u32;
            if let Some(id) = id {
                map.entry(*id).or_insert(new);
            }
            slots.push((new, dict));
            kids.push(Obj::Ref(new));
        }
        for (new, dict) in slots {
            let mut page = vec![("Type".to_string(), Obj::Name("Page".into())), ("Parent".to_string(), Obj::Ref(2))];
            for (k, v) in dict {
                if k == "Type" || k == "Parent" {
                    continue;
                }
                page.push((k.clone(), copy(&src.doc, v, &all_pages, &mut map, &mut queue, &mut objs)));
            }
            if let Some(slot) = objs.get_mut(new as usize - 1) {
                *slot = Obj::Dict(page);
            }
        }
        while let Some(old) = queue.pop_front() {
            if objs.len() > MAX_OBJECTS {
                return Err("Il PDF ha troppi oggetti.".into());
            }
            let Some(&new) = map.get(&old) else { continue };
            let o = src.doc.objects.get(&old).cloned().unwrap_or(Obj::Null);
            let o = copy(&src.doc, &o, &all_pages, &mut map, &mut queue, &mut objs);
            if let Some(slot) = objs.get_mut(new as usize - 1) {
                *slot = o;
            }
        }
    }
    if kids.is_empty() {
        return Err("Nessuna pagina da copiare.".into());
    }
    let count = kids.len() as f64;
    objs[0] = Obj::Dict(vec![("Type".into(), Obj::Name("Catalog".into())), ("Pages".into(), Obj::Ref(2))]);
    objs[1] = Obj::Dict(vec![("Type".into(), Obj::Name("Pages".into())), ("Kids".into(), Obj::Arr(kids)), ("Count".into(), Obj::Num(count))]);
    write(&objs)
}

/// A copy of `o` with its references renumbered; objects reached for the first
/// time are queued. Pages left out and the old page tree become null.
fn copy(doc: &Doc, o: &Obj, pages: &HashSet<u32>, map: &mut HashMap<u32, u32>, queue: &mut VecDeque<u32>, objs: &mut Vec<Obj>) -> Obj {
    match o {
        Obj::Ref(id) => {
            if let Some(n) = map.get(id) {
                return Obj::Ref(*n);
            }
            if pages.contains(id) {
                return Obj::Null;
            }
            let target = doc.objects.get(id);
            if target.and_then(|t| t.get("Type")).and_then(Obj::name).is_some_and(|t| t == "Pages" || t == "Page" || t == "Catalog") {
                return Obj::Null;
            }
            if target.is_none() {
                return Obj::Null;
            }
            objs.push(Obj::Null);
            let n = objs.len() as u32;
            map.insert(*id, n);
            queue.push_back(*id);
            Obj::Ref(n)
        }
        Obj::Arr(v) => Obj::Arr(v.iter().map(|x| copy(doc, x, pages, map, queue, objs)).collect()),
        Obj::Dict(d) => Obj::Dict(d.iter().map(|(k, v)| (k.clone(), copy(doc, v, pages, map, queue, objs))).collect()),
        Obj::Stream(d, data) => Obj::Stream(
            d.iter().filter(|(k, _)| k != "Length").map(|(k, v)| (k.clone(), copy(doc, v, pages, map, queue, objs))).collect(),
            data.clone(),
        ),
        other => other.clone(),
    }
}

fn number(n: f64) -> String {
    if !n.is_finite() {
        return "0".into();
    }
    if n.fract() == 0.0 && n.abs() < 1e15 {
        return format!("{}", n as i64);
    }
    let s = format!("{n:.5}");
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

fn name(n: &str, out: &mut Vec<u8>) {
    out.push(b'/');
    for b in n.bytes() {
        if (0x21..=0x7e).contains(&b) && !b"()<>[]{}/%#".contains(&b) {
            out.push(b);
        } else {
            out.extend_from_slice(format!("#{b:02X}").as_bytes());
        }
    }
}

fn put(o: &Obj, out: &mut Vec<u8>) {
    match o {
        Obj::Null => out.extend_from_slice(b"null"),
        Obj::Bool(b) => out.extend_from_slice(if *b { b"true" } else { b"false" }),
        Obj::Num(n) => out.extend_from_slice(number(*n).as_bytes()),
        Obj::Str(s) => {
            out.push(b'<');
            for b in s {
                out.extend_from_slice(format!("{b:02X}").as_bytes());
            }
            out.push(b'>');
        }
        Obj::Name(n) => name(n, out),
        Obj::Arr(v) => {
            out.push(b'[');
            for (i, x) in v.iter().enumerate() {
                if i > 0 {
                    out.push(b' ');
                }
                put(x, out);
            }
            out.push(b']');
        }
        Obj::Dict(d) => dict(d, out),
        Obj::Ref(id) => out.extend_from_slice(format!("{id} 0 R").as_bytes()),
        Obj::Stream(d, data) => {
            let mut d = d.clone();
            d.push(("Length".into(), Obj::Num(data.len() as f64)));
            dict(&d, out);
            out.extend_from_slice(b"\nstream\r\n");
            out.extend_from_slice(data);
            out.extend_from_slice(b"\r\nendstream");
        }
        Obj::Kw(k) => out.extend_from_slice(k.as_bytes()),
    }
}

fn dict(d: &[(String, Obj)], out: &mut Vec<u8>) {
    out.extend_from_slice(b"<<");
    for (k, v) in d {
        name(k, out);
        out.push(b' ');
        put(v, out);
        out.push(b' ');
    }
    out.extend_from_slice(b">>");
}

fn write(objs: &[Obj]) -> Result<Vec<u8>, String> {
    let mut out: Vec<u8> = b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = Vec::with_capacity(objs.len());
    for (i, o) in objs.iter().enumerate() {
        offsets.push(out.len());
        let _ = write!(out, "{} 0 obj\n", i + 1);
        put(o, &mut out);
        out.extend_from_slice(b"\nendobj\n");
        if out.len() > MAX_OUT {
            return Err("Il PDF che ne viene è troppo grande (oltre 300 MB).".into());
        }
    }
    let xref = out.len();
    let _ = write!(out, "xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1);
    for off in offsets {
        let _ = write!(out, "{off:010} 00000 n \n");
    }
    let _ = write!(out, "trailer\n<</Size {} /Root 1 0 R>>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pdf(pages: &[&str]) -> Vec<u8> {
        // Pages inherit their resources and size from the tree, like many real files.
        let mut objs = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            String::new(),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        ];
        let mut kids = Vec::new();
        for text in pages {
            let content = format!("BT /F1 12 Tf 72 700 Td ({text}) Tj ET");
            objs.push(format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()));
            let c = objs.len();
            objs.push(format!("<< /Type /Page /Parent 2 0 R /Contents {c} 0 R >>"));
            kids.push(format!("{} 0 R", objs.len()));
        }
        objs[1] = format!("<< /Type /Pages /Kids [{}] /Count {} /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> >>", kids.join(" "), pages.len());
        let mut out = b"%PDF-1.4\n".to_vec();
        for (i, o) in objs.iter().enumerate() {
            out.extend_from_slice(format!("{} 0 obj\n{o}\nendobj\n", i + 1).as_bytes());
        }
        out.extend_from_slice(b"trailer\n<< /Root 1 0 R >>\n%%EOF\n");
        out
    }

    #[test]
    fn pages_are_chosen_merged_and_read_back() {
        let a = Source::read(&pdf(&["Uno", "Due", "Tre"])).unwrap();
        let b = Source::read(&pdf(&["Quattro"])).unwrap();
        assert_eq!(a.count(), 3);
        let out = assemble(&[(&a, parse_pages("3,1", 3).unwrap()), (&b, vec![0])]).unwrap();
        let text = crate::pdftext::text(&out).unwrap();
        let order: Vec<usize> = ["Tre", "Uno", "Quattro"].iter().map(|w| text.find(w).unwrap()).collect();
        assert!(order.windows(2).all(|w| w[0] < w[1]), "{text}");
        assert!(!text.contains("Due"));
        let again = Source::read(&out).unwrap();
        assert_eq!(again.count(), 3);
    }

    #[test]
    fn page_ranges() {
        assert_eq!(parse_pages("1-3, 5", 6).unwrap(), vec![0, 1, 2, 4]);
        assert_eq!(parse_pages("5-", 6).unwrap(), vec![4, 5]);
        assert_eq!(parse_pages("ultima", 6).unwrap(), vec![5]);
        assert_eq!(parse_pages("3-1", 6).unwrap(), vec![2, 1, 0]);
        assert!(parse_pages("7", 6).is_err());
        assert!(parse_pages("x", 6).is_err());
        assert!(Source::read(b"not a pdf").is_err());
    }
}

#[cfg(test)]
mod live {
    /// EI_PDFS = files separated by ";", EI_OUT = folder: writes unito.pdf and parte-N.pdf.
    #[test]
    #[ignore]
    fn merge_and_split_real_files() {
        let out = std::path::PathBuf::from(std::env::var("EI_OUT").unwrap());
        let sources: Vec<super::Source> = std::env::var("EI_PDFS").unwrap().split(';').map(|p| super::Source::read(&std::fs::read(p).unwrap()).unwrap()).collect();
        let parts: Vec<(&super::Source, Vec<usize>)> = sources.iter().map(|s| (s, (0..s.count()).collect())).collect();
        let merged = super::assemble(&parts).unwrap();
        std::fs::write(out.join("unito.pdf"), &merged).unwrap();
        let m = super::Source::read(&merged).unwrap();
        println!("unito: {} pagine, {} byte", m.count(), merged.len());
        for (i, p) in [vec![0], (1..m.count()).collect()].into_iter().enumerate() {
            if p.is_empty() {
                continue;
            }
            std::fs::write(out.join(format!("parte-{i}.pdf")), super::assemble(&[(&m, p)]).unwrap()).unwrap();
        }
        println!("{}", crate::pdftext::text(&merged).unwrap().chars().take(1500).collect::<String>());
    }
}
