// The text of a PDF, for the chat (docx.rs's sibling, docs/chat.md → Documenti
// Word e PDF). Written here instead of a library: the release build aborts on a
// panic, so a parser that panics on a strange file would close the app; this
// one only uses `get` and returns what it could read.
//
// What it reads: objects (also inside object streams), Flate/ASCIIHex streams,
// the page tree, fonts with ToUnicode or a simple encoding, text operators and
// forms. What it does not: encrypted files, scans (no text inside), exact
// layout (lines come from the position of the text, spaces are guessed).

use std::collections::{HashMap, HashSet};
use std::io::Read;

const MAX_FILE: usize = 150 * 1024 * 1024;
const MAX_STREAM: u64 = 64 * 1024 * 1024;
const MAX_PAGES: usize = 3000;
const MAX_TEXT: usize = 200_000;

#[derive(Debug, Clone)]
pub(crate) enum Obj {
    Null,
    Bool(#[allow(dead_code)] bool),
    Num(f64),
    Str(Vec<u8>),
    Name(String),
    Arr(Vec<Obj>),
    Dict(Vec<(String, Obj)>),
    Ref(u32),
    Stream(Vec<(String, Obj)>, Vec<u8>),
    Kw(#[allow(dead_code)] String),
}

impl Obj {
    pub(crate) fn dict(&self) -> Option<&[(String, Obj)]> {
        match self {
            Obj::Dict(d) | Obj::Stream(d, _) => Some(d),
            _ => None,
        }
    }
    pub(crate) fn get(&self, key: &str) -> Option<&Obj> {
        self.dict()?.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v)
    }
    fn num(&self) -> Option<f64> {
        match self {
            Obj::Num(n) => Some(*n),
            _ => None,
        }
    }
    pub(crate) fn name(&self) -> Option<&str> {
        match self {
            Obj::Name(n) => Some(n),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------- lexer

fn is_space(c: u8) -> bool {
    matches!(c, 0 | 9 | 10 | 12 | 13 | 32)
}

fn is_delim(c: u8) -> bool {
    matches!(c, b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%')
}

struct Lexer<'a> {
    b: &'a [u8],
    i: usize,
}

#[derive(Debug, Clone)]
enum Tok {
    Num(f64, bool),
    Str(Vec<u8>),
    Name(String),
    Kw(String),
    ArrOpen,
    ArrClose,
    DictOpen,
    DictClose,
}

impl<'a> Lexer<'a> {
    fn new(b: &'a [u8]) -> Self {
        Lexer { b, i: 0 }
    }

    fn at(&self, k: usize) -> Option<u8> {
        self.b.get(self.i + k).copied()
    }

    fn skip_space(&mut self) {
        while let Some(c) = self.at(0) {
            if is_space(c) {
                self.i += 1;
            } else if c == b'%' {
                while let Some(c) = self.at(0) {
                    if c == b'\n' || c == b'\r' {
                        break;
                    }
                    self.i += 1;
                }
            } else {
                break;
            }
        }
    }

    fn next(&mut self) -> Option<Tok> {
        loop {
            self.skip_space();
            let c = self.at(0)?;
            match c {
                b'[' => {
                    self.i += 1;
                    return Some(Tok::ArrOpen);
                }
                b']' => {
                    self.i += 1;
                    return Some(Tok::ArrClose);
                }
                b'<' if self.at(1) == Some(b'<') => {
                    self.i += 2;
                    return Some(Tok::DictOpen);
                }
                b'>' if self.at(1) == Some(b'>') => {
                    self.i += 2;
                    return Some(Tok::DictClose);
                }
                b'<' => return Some(Tok::Str(self.hex())),
                b'(' => return Some(Tok::Str(self.literal())),
                b'/' => {
                    self.i += 1;
                    let mut raw = Vec::new();
                    while let Some(c) = self.at(0) {
                        if is_space(c) || is_delim(c) {
                            break;
                        }
                        raw.push(c);
                        self.i += 1;
                    }
                    return Some(Tok::Name(name_of(&raw)));
                }
                b')' | b'>' | b'{' | b'}' => {
                    self.i += 1;
                    continue;
                }
                _ => {
                    let start = self.i;
                    while let Some(c) = self.at(0) {
                        if is_space(c) || is_delim(c) {
                            break;
                        }
                        self.i += 1;
                    }
                    let word = self.b.get(start..self.i).unwrap_or_default();
                    if word.is_empty() {
                        self.i += 1;
                        continue;
                    }
                    let s = String::from_utf8_lossy(word);
                    if let Some(n) = number(&s) {
                        return Some(Tok::Num(n, !s.contains('.')));
                    }
                    return Some(Tok::Kw(s.into_owned()));
                }
            }
        }
    }

    fn hex(&mut self) -> Vec<u8> {
        self.i += 1;
        let mut digits = Vec::new();
        while let Some(c) = self.at(0) {
            self.i += 1;
            if c == b'>' {
                break;
            }
            if let Some(d) = (c as char).to_digit(16) {
                digits.push(d as u8);
            }
        }
        if digits.len() % 2 == 1 {
            digits.push(0);
        }
        digits.chunks(2).map(|p| (p.first().copied().unwrap_or(0) << 4) | p.get(1).copied().unwrap_or(0)).collect()
    }

    fn literal(&mut self) -> Vec<u8> {
        self.i += 1;
        let mut out = Vec::new();
        let mut depth = 1;
        while let Some(c) = self.at(0) {
            self.i += 1;
            match c {
                b'(' => {
                    depth += 1;
                    out.push(c);
                }
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                    out.push(c);
                }
                b'\\' => {
                    let Some(e) = self.at(0) else { break };
                    self.i += 1;
                    match e {
                        b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'),
                        b't' => out.push(b'\t'),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'\r' => {
                            if self.at(0) == Some(b'\n') {
                                self.i += 1;
                            }
                        }
                        b'\n' => {}
                        b'0'..=b'7' => {
                            let mut v = (e - b'0') as u32;
                            for _ in 0..2 {
                                match self.at(0) {
                                    Some(d @ b'0'..=b'7') => {
                                        v = v * 8 + (d - b'0') as u32;
                                        self.i += 1;
                                    }
                                    _ => break,
                                }
                            }
                            out.push((v & 0xff) as u8);
                        }
                        other => out.push(other),
                    }
                }
                _ => out.push(c),
            }
        }
        out
    }
}

fn number(s: &str) -> Option<f64> {
    let first = s.chars().next()?;
    if !(first.is_ascii_digit() || matches!(first, '+' | '-' | '.')) {
        return None;
    }
    if !s.chars().all(|c| c.is_ascii_digit() || matches!(c, '+' | '-' | '.')) {
        return None;
    }
    s.parse().ok().or(Some(0.0))
}

fn name_of(raw: &[u8]) -> String {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(&c) = raw.get(i) {
        if c == b'#' {
            if let Some(v) = raw.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok()).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// One value from the lexer (with "1 0 R" as a reference).
fn parse(lx: &mut Lexer, first: Tok, depth: usize) -> Obj {
    if depth > 64 {
        return Obj::Null;
    }
    match first {
        Tok::Num(n, int) => {
            if int && n >= 0.0 {
                let save = lx.i;
                if let Some(Tok::Num(_, true)) = lx.next() {
                    if let Some(Tok::Kw(k)) = lx.next() {
                        if k == "R" {
                            return Obj::Ref(n as u32);
                        }
                    }
                }
                lx.i = save;
            }
            Obj::Num(n)
        }
        Tok::Str(s) => Obj::Str(s),
        Tok::Name(n) => Obj::Name(n),
        Tok::Kw(k) => match k.as_str() {
            "true" => Obj::Bool(true),
            "false" => Obj::Bool(false),
            "null" => Obj::Null,
            _ => Obj::Kw(k),
        },
        Tok::ArrOpen => {
            let mut v = Vec::new();
            while let Some(t) = lx.next() {
                if matches!(t, Tok::ArrClose) {
                    break;
                }
                if let Tok::Kw(k) = &t {
                    if k == "endobj" || k == "stream" {
                        break;
                    }
                }
                v.push(parse(lx, t, depth + 1));
            }
            Obj::Arr(v)
        }
        Tok::DictOpen => {
            let mut d = Vec::new();
            while let Some(t) = lx.next() {
                match t {
                    Tok::DictClose => break,
                    Tok::Name(k) => {
                        let Some(v) = lx.next() else { break };
                        if matches!(v, Tok::DictClose) {
                            break;
                        }
                        d.push((k, parse(lx, v, depth + 1)));
                    }
                    Tok::Kw(k) if k == "endobj" || k == "stream" => break,
                    _ => {}
                }
            }
            Obj::Dict(d)
        }
        Tok::ArrClose | Tok::DictClose => Obj::Null,
    }
}

// ---------------------------------------------------------------- the file

pub(crate) struct Doc {
    pub(crate) objects: HashMap<u32, Obj>,
    pub(crate) trailers: Vec<Obj>,
}

fn find(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    hay.get(from..)?.windows(needle.len()).position(|w| w == needle).map(|p| p + from)
}

impl Doc {
    pub(crate) fn read(b: &[u8]) -> Doc {
        let mut doc = Doc { objects: HashMap::new(), trailers: Vec::new() };
        let mut lx = Lexer::new(b);
        let mut last: [Option<Tok>; 2] = [None, None];
        while let Some(t) = lx.next() {
            match &t {
                Tok::Kw(k) if k == "obj" => {
                    if let [Some(Tok::Num(id, true)), Some(Tok::Num(_, true))] = &last {
                        let id = *id as u32;
                        let obj = match lx.next() {
                            Some(first) => parse(&mut lx, first, 0),
                            None => Obj::Null,
                        };
                        let save = lx.i;
                        let obj = match lx.next() {
                            Some(Tok::Kw(k)) if k == "stream" => {
                                let data = stream_bytes(b, &mut lx, &obj);
                                Obj::Stream(obj.dict().map(<[_]>::to_vec).unwrap_or_default(), data)
                            }
                            _ => {
                                lx.i = save;
                                obj
                            }
                        };
                        doc.objects.insert(id, obj);
                    }
                    last = [None, None];
                    continue;
                }
                Tok::Kw(k) if k == "trailer" => {
                    if let Some(first) = lx.next() {
                        doc.trailers.push(parse(&mut lx, first, 0));
                    }
                }
                _ => {}
            }
            last = [last[1].take(), Some(t)];
        }
        // Objects packed in object streams.
        let packs: Vec<Obj> = doc.objects.values().filter(|o| o.get("Type").and_then(Obj::name) == Some("ObjStm")).cloned().collect();
        for pack in packs {
            let Some(data) = decode(&pack) else { continue };
            let n = pack.get("N").and_then(Obj::num).unwrap_or(0.0) as usize;
            let first = pack.get("First").and_then(Obj::num).unwrap_or(0.0) as usize;
            let mut head = Lexer::new(data.get(..first.min(data.len())).unwrap_or_default());
            let mut pairs = Vec::new();
            for _ in 0..n.min(100_000) {
                match (head.next(), head.next()) {
                    (Some(Tok::Num(id, _)), Some(Tok::Num(off, _))) => pairs.push((id as u32, off as usize)),
                    _ => break,
                }
            }
            for (id, off) in pairs {
                if doc.objects.contains_key(&id) {
                    continue;
                }
                let Some(slice) = data.get(first + off..) else { continue };
                let mut lx = Lexer::new(slice);
                if let Some(t) = lx.next() {
                    doc.objects.insert(id, parse(&mut lx, t, 0));
                }
            }
        }
        // Cross-reference streams carry the trailer.
        for o in doc.objects.values() {
            if o.get("Type").and_then(Obj::name) == Some("XRef") {
                doc.trailers.push(Obj::Dict(o.dict().map(<[_]>::to_vec).unwrap_or_default()));
            }
        }
        doc
    }

    pub(crate) fn resolve<'a>(&'a self, mut o: &'a Obj) -> &'a Obj {
        for _ in 0..16 {
            match o {
                Obj::Ref(id) => match self.objects.get(id) {
                    Some(next) => o = next,
                    None => return &Obj::Null,
                },
                _ => return o,
            }
        }
        &Obj::Null
    }

    fn get<'a>(&'a self, o: &'a Obj, key: &str) -> Option<&'a Obj> {
        let v = self.resolve(o).get(key)?;
        Some(self.resolve(v))
    }

    pub(crate) fn encrypted(&self) -> bool {
        self.trailers.iter().any(|t| t.get("Encrypt").is_some())
    }

    /// The pages in order, each with its resources (inherited from the tree).
    fn pages(&self) -> Vec<(&Obj, Option<&Obj>)> {
        let root = self
            .trailers
            .iter()
            .rev()
            .find_map(|t| t.get("Root"))
            .map(|r| self.resolve(r))
            .filter(|r| r.dict().is_some())
            .or_else(|| self.objects.values().find(|o| o.get("Type").and_then(Obj::name) == Some("Catalog")));
        let mut out = Vec::new();
        if let Some(tree) = root.and_then(|r| self.get(r, "Pages")) {
            let mut seen = HashSet::new();
            self.walk(tree, None, &mut out, &mut seen, 0);
        }
        if out.is_empty() {
            let mut ids: Vec<&u32> = self.objects.iter().filter(|(_, o)| o.get("Type").and_then(Obj::name) == Some("Page")).map(|(id, _)| id).collect();
            ids.sort();
            for id in ids {
                if let Some(o) = self.objects.get(id) {
                    out.push((o, self.get(o, "Resources")));
                }
            }
        }
        out
    }

    fn walk<'a>(&'a self, node: &'a Obj, res: Option<&'a Obj>, out: &mut Vec<(&'a Obj, Option<&'a Obj>)>, seen: &mut HashSet<*const Obj>, depth: usize) {
        if depth > 64 || out.len() >= MAX_PAGES || !seen.insert(node as *const Obj) {
            return;
        }
        let res = self.get(node, "Resources").or(res);
        match self.get(node, "Kids") {
            Some(Obj::Arr(kids)) => {
                for k in kids {
                    self.walk(self.resolve(k), res, out, seen, depth + 1);
                }
            }
            _ => out.push((node, res)),
        }
    }
}

fn stream_bytes(b: &[u8], lx: &mut Lexer, dict: &Obj) -> Vec<u8> {
    let mut start = lx.i;
    if b.get(start) == Some(&b'\r') {
        start += 1;
    }
    if b.get(start) == Some(&b'\n') {
        start += 1;
    }
    // A direct /Length that ends right before "endstream".
    if let Some(len) = dict.get("Length").and_then(Obj::num) {
        let end = start + len as usize;
        let after = b.get(end..(end + 20).min(b.len())).unwrap_or_default();
        let trimmed: Vec<u8> = after.iter().copied().skip_while(|c| is_space(*c)).take(9).collect();
        if trimmed == b"endstream" {
            lx.i = end;
            return b.get(start..end).unwrap_or_default().to_vec();
        }
    }
    let end = find(b, b"endstream", start).unwrap_or(b.len());
    lx.i = (end + 9).min(b.len());
    let mut data_end = end;
    while data_end > start && matches!(b.get(data_end - 1), Some(b'\n' | b'\r')) {
        data_end -= 1;
    }
    b.get(start..data_end).unwrap_or_default().to_vec()
}

fn inflate(data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let z = flate2::read::ZlibDecoder::new(data).take(MAX_STREAM).read_to_end(&mut out);
    if z.is_ok() && !out.is_empty() {
        return Some(out);
    }
    // Some files end the stream early: what came out before the error is good.
    if !out.is_empty() {
        return Some(out);
    }
    let mut raw = Vec::new();
    let _ = flate2::read::DeflateDecoder::new(data).take(MAX_STREAM).read_to_end(&mut raw);
    (!raw.is_empty()).then_some(raw)
}

fn unpredict(data: Vec<u8>, parms: Option<&Obj>) -> Vec<u8> {
    let predictor = parms.and_then(|p| p.get("Predictor")).and_then(Obj::num).unwrap_or(1.0) as u32;
    if predictor < 10 {
        return data;
    }
    let colors = parms.and_then(|p| p.get("Colors")).and_then(Obj::num).unwrap_or(1.0).max(1.0) as usize;
    let columns = parms.and_then(|p| p.get("Columns")).and_then(Obj::num).unwrap_or(1.0).max(1.0) as usize;
    let bpp = colors.max(1);
    let row = colors * columns;
    let mut out = Vec::with_capacity(data.len());
    let mut prev = vec![0u8; row];
    for chunk in data.chunks(row + 1) {
        let Some((&kind, line)) = chunk.split_first() else { break };
        let mut cur = line.to_vec();
        cur.resize(row, 0);
        for i in 0..row {
            let left = if i >= bpp { cur.get(i - bpp).copied().unwrap_or(0) } else { 0 };
            let up = prev.get(i).copied().unwrap_or(0);
            let ul = if i >= bpp { prev.get(i - bpp).copied().unwrap_or(0) } else { 0 };
            let add = match kind {
                1 => left,
                2 => up,
                3 => ((left as u16 + up as u16) / 2) as u8,
                4 => {
                    let p = left as i16 + up as i16 - ul as i16;
                    let (pa, pb, pc) = ((p - left as i16).abs(), (p - up as i16).abs(), (p - ul as i16).abs());
                    if pa <= pb && pa <= pc { left } else if pb <= pc { up } else { ul }
                }
                _ => 0,
            };
            if let Some(c) = cur.get_mut(i) {
                *c = c.wrapping_add(add);
            }
        }
        out.extend_from_slice(&cur);
        prev = cur;
    }
    out
}

/// The bytes of a stream after its filters; None for a filter not handled here.
fn decode(o: &Obj) -> Option<Vec<u8>> {
    let Obj::Stream(_, data) = o else { return None };
    let filters: Vec<String> = match o.get("Filter") {
        Some(Obj::Name(n)) => vec![n.clone()],
        Some(Obj::Arr(v)) => v.iter().filter_map(|x| x.name().map(str::to_string)).collect(),
        _ => Vec::new(),
    };
    let parms: Vec<Option<&Obj>> = match o.get("DecodeParms") {
        Some(Obj::Arr(v)) => v.iter().map(Some).collect(),
        Some(p) => vec![Some(p)],
        None => Vec::new(),
    };
    let mut cur = data.clone();
    for (i, f) in filters.iter().enumerate() {
        cur = match f.as_str() {
            "FlateDecode" | "Fl" => unpredict(inflate(&cur)?, parms.get(i).copied().flatten()),
            "ASCIIHexDecode" | "AHx" => {
                let mut lx = Lexer::new(&cur);
                let mut v = cur.clone();
                v.insert(0, b'<');
                lx.b = &v;
                lx.hex()
            }
            _ => return None,
        };
    }
    Some(cur)
}

// ---------------------------------------------------------------- fonts

/// Windows-1252, the usual simple encoding (WinAnsi), for 0x80–0x9F.
fn win_ansi(c: u8) -> char {
    const HIGH: [u16; 32] = [
        0x20AC, 0, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017D, 0, 0, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0, 0x017E, 0x0178,
    ];
    if (0x80..0xA0).contains(&c) {
        HIGH.get((c - 0x80) as usize).and_then(|u| char::from_u32(*u as u32)).filter(|c| *c != '\0').unwrap_or(' ')
    } else {
        c as char
    }
}

/// A glyph name of /Differences → its character, for the common ones.
fn glyph(name: &str) -> Option<String> {
    if name.chars().count() == 1 {
        return Some(name.to_string());
    }
    if let Some(h) = name.strip_prefix("uni").or_else(|| name.strip_prefix('u')) {
        if (4..=6).contains(&h.len()) {
            if let Some(c) = u32::from_str_radix(h.get(..4).unwrap_or(h), 16).ok().and_then(char::from_u32) {
                return Some(c.to_string());
            }
        }
    }
    let s = match name {
        "space" | "nbspace" => " ",
        "zero" => "0",
        "one" => "1",
        "two" => "2",
        "three" => "3",
        "four" => "4",
        "five" => "5",
        "six" => "6",
        "seven" => "7",
        "eight" => "8",
        "nine" => "9",
        "period" => ".",
        "comma" => ",",
        "colon" => ":",
        "semicolon" => ";",
        "hyphen" | "minus" => "-",
        "endash" => "–",
        "emdash" => "—",
        "parenleft" => "(",
        "parenright" => ")",
        "bracketleft" => "[",
        "bracketright" => "]",
        "slash" => "/",
        "backslash" => "\\",
        "exclam" => "!",
        "question" => "?",
        "quotesingle" => "'",
        "quoteright" => "’",
        "quoteleft" => "‘",
        "quotedbl" => "\"",
        "quotedblleft" => "“",
        "quotedblright" => "”",
        "ampersand" => "&",
        "percent" => "%",
        "at" => "@",
        "plus" => "+",
        "equal" => "=",
        "underscore" => "_",
        "asterisk" => "*",
        "numbersign" => "#",
        "dollar" => "$",
        "euro" | "Euro" => "€",
        "sterling" => "£",
        "degree" => "°",
        "bullet" => "•",
        "ellipsis" => "…",
        "less" => "<",
        "greater" => ">",
        "fi" => "fi",
        "fl" => "fl",
        "ff" => "ff",
        "agrave" => "à",
        "aacute" => "á",
        "egrave" => "è",
        "eacute" => "é",
        "igrave" => "ì",
        "iacute" => "í",
        "ograve" => "ò",
        "oacute" => "ó",
        "ugrave" => "ù",
        "uacute" => "ú",
        "Agrave" => "À",
        "Egrave" => "È",
        "Eacute" => "É",
        "Igrave" => "Ì",
        "Ograve" => "Ò",
        "Ugrave" => "Ù",
        "ccedilla" => "ç",
        "Ccedilla" => "Ç",
        "ntilde" => "ñ",
        "adieresis" => "ä",
        "odieresis" => "ö",
        "udieresis" => "ü",
        "germandbls" => "ß",
        "copyright" => "©",
        "registered" => "®",
        "trademark" => "™",
        "section" => "§",
        "paragraph" => "¶",
        "ordfeminine" => "ª",
        "ordmasculine" => "º",
        _ => return None,
    };
    Some(s.to_string())
}

struct Font {
    /// ToUnicode: code → text, and the lengths of codes in bytes.
    map: HashMap<u32, String>,
    widths: Vec<usize>,
    /// A simple font: one byte per code, through this table.
    simple: Option<Vec<Option<String>>>,
    /// How wide each code is, in thousandths of the font size.
    advance: HashMap<u32, f64>,
    default_advance: f64,
}

impl Font {
    fn of(doc: &Doc, font: &Obj) -> Font {
        let mut f = Font { map: HashMap::new(), widths: Vec::new(), simple: None, advance: HashMap::new(), default_advance: 500.0 };
        let two_byte = doc.get(font, "Subtype").and_then(Obj::name) == Some("Type0");
        if let Some(cmap) = doc.get(font, "ToUnicode").and_then(decode) {
            cmap_parse(&cmap, &mut f.map, &mut f.widths);
        }
        if f.widths.is_empty() {
            f.widths.push(if two_byte { 2 } else { 1 });
        }
        if two_byte {
            // The widths of a CID font: /DW and /W of its descendant.
            if let Some(Obj::Arr(desc)) = doc.get(font, "DescendantFonts") {
                if let Some(cid) = desc.first().map(|d| doc.resolve(d)) {
                    f.default_advance = doc.get(cid, "DW").and_then(Obj::num).unwrap_or(1000.0);
                    if let Some(Obj::Arr(w)) = doc.get(cid, "W") {
                        let mut i = 0;
                        while i < w.len() {
                            let first = w.get(i).map(|o| doc.resolve(o)).and_then(Obj::num).unwrap_or(0.0) as u32;
                            match w.get(i + 1).map(|o| doc.resolve(o)) {
                                Some(Obj::Arr(list)) => {
                                    for (k, v) in list.iter().enumerate().take(65_536) {
                                        if let Some(v) = doc.resolve(v).num() {
                                            f.advance.insert(first + k as u32, v);
                                        }
                                    }
                                    i += 2;
                                }
                                Some(Obj::Num(last)) => {
                                    let v = w.get(i + 2).map(|o| doc.resolve(o)).and_then(Obj::num).unwrap_or(f.default_advance);
                                    for c in first..=(*last as u32).min(first.saturating_add(65_535)) {
                                        f.advance.insert(c, v);
                                    }
                                    i += 3;
                                }
                                _ => break,
                            }
                        }
                    }
                }
            }
        } else {
            let first = doc.get(font, "FirstChar").and_then(Obj::num).unwrap_or(0.0) as u32;
            if let Some(Obj::Arr(w)) = doc.get(font, "Widths") {
                for (k, v) in w.iter().enumerate().take(256) {
                    if let Some(v) = doc.resolve(v).num() {
                        f.advance.insert(first + k as u32, v);
                    }
                }
            }
            let mut table: Vec<Option<String>> = (0u8..=255).map(|c| Some(win_ansi(c).to_string())).collect();
            if let Some(enc) = doc.get(font, "Encoding") {
                if let Some(Obj::Arr(diff)) = enc.get("Differences").map(|d| doc.resolve(d)) {
                    let mut code = 0usize;
                    for d in diff {
                        match d {
                            Obj::Num(n) => code = *n as usize,
                            Obj::Name(n) => {
                                if let Some(slot) = table.get_mut(code) {
                                    *slot = glyph(n);
                                }
                                code += 1;
                            }
                            _ => {}
                        }
                    }
                }
            }
            f.simple = Some(table);
        }
        f
    }

    /// The text of a string, how wide it is (thousandths of the size) and how
    /// many single-byte spaces it has (for the word spacing).
    fn text(&self, bytes: &[u8]) -> (String, f64, usize) {
        let mut out = String::new();
        let mut width = 0.0;
        let mut spaces = 0;
        let mut i = 0;
        let mut ws = self.widths.clone();
        ws.sort_unstable();
        ws.dedup();
        while i < bytes.len() {
            let mut done = false;
            for w in &ws {
                let Some(chunk) = bytes.get(i..i + w) else { continue };
                let code = chunk.iter().fold(0u32, |a, b| (a << 8) | *b as u32);
                if let Some(t) = self.map.get(&code) {
                    out.push_str(t);
                    width += self.advance.get(&code).copied().unwrap_or(self.default_advance);
                    if *w == 1 && code == 32 {
                        spaces += 1;
                    }
                    i += w;
                    done = true;
                    break;
                }
            }
            if done {
                continue;
            }
            match &self.simple {
                Some(table) => {
                    if let Some(b) = bytes.get(i) {
                        if let Some(Some(t)) = table.get(*b as usize) {
                            out.push_str(t);
                        }
                        width += self.advance.get(&(*b as u32)).copied().unwrap_or(self.default_advance);
                        if *b == 32 {
                            spaces += 1;
                        }
                    }
                    i += 1;
                }
                None => {
                    let w = ws.last().copied().unwrap_or(2).max(1);
                    let code = bytes.get(i..i + w).map(|c| c.iter().fold(0u32, |a, b| (a << 8) | *b as u32)).unwrap_or(0);
                    width += self.advance.get(&code).copied().unwrap_or(self.default_advance);
                    i += w;
                }
            }
        }
        (out, width, spaces)
    }
}

fn utf16(b: &[u8]) -> String {
    let units: Vec<u16> = b.chunks(2).map(|p| ((p.first().copied().unwrap_or(0) as u16) << 8) | p.get(1).copied().unwrap_or(0) as u16).collect();
    String::from_utf16_lossy(&units)
}

fn code(b: &[u8]) -> u32 {
    b.iter().take(4).fold(0u32, |a, c| (a << 8) | *c as u32)
}

/// bfchar and bfrange of a ToUnicode CMap.
fn cmap_parse(data: &[u8], map: &mut HashMap<u32, String>, widths: &mut Vec<usize>) {
    let mut lx = Lexer::new(data);
    let mut toks: Vec<Tok> = Vec::new();
    while let Some(t) = lx.next() {
        toks.push(t);
        if toks.len() > 2_000_000 {
            break;
        }
    }
    let mut i = 0;
    let mut mode = "";
    while i < toks.len() {
        match &toks[i] {
            Tok::Kw(k) if k.starts_with("begin") => mode = if k == "begincodespacerange" { "space" } else if k == "beginbfchar" { "char" } else if k == "beginbfrange" { "range" } else { "" },
            Tok::Kw(k) if k.starts_with("end") => mode = "",
            Tok::Str(a) => match mode {
                "space" => {
                    if !widths.contains(&a.len()) && (1..=4).contains(&a.len()) {
                        widths.push(a.len());
                    }
                    i += 1;
                }
                "char" => {
                    if let Some(Tok::Str(b)) = toks.get(i + 1) {
                        map.insert(code(a), utf16(b));
                        if !widths.contains(&a.len()) && (1..=4).contains(&a.len()) {
                            widths.push(a.len());
                        }
                    }
                    i += 1;
                }
                "range" => {
                    let lo = code(a);
                    let hi = match toks.get(i + 1) {
                        Some(Tok::Str(b)) => code(b),
                        _ => lo,
                    };
                    let hi = hi.min(lo.saturating_add(65_535));
                    if !widths.contains(&a.len()) && (1..=4).contains(&a.len()) {
                        widths.push(a.len());
                    }
                    match toks.get(i + 2) {
                        Some(Tok::Str(dst)) => {
                            let base: Vec<u16> = dst.chunks(2).map(|p| ((p.first().copied().unwrap_or(0) as u16) << 8) | p.get(1).copied().unwrap_or(0) as u16).collect();
                            for (k, c) in (lo..=hi).enumerate() {
                                let mut units = base.clone();
                                if let Some(last) = units.last_mut() {
                                    *last = last.wrapping_add(k as u16);
                                }
                                map.insert(c, String::from_utf16_lossy(&units));
                            }
                            i += 2;
                        }
                        Some(Tok::ArrOpen) => {
                            let mut j = i + 3;
                            let mut c = lo;
                            while let Some(Tok::Str(dst)) = toks.get(j) {
                                if c <= hi {
                                    map.insert(c, utf16(dst));
                                }
                                c = c.saturating_add(1);
                                j += 1;
                            }
                            i = j;
                        }
                        _ => i += 1,
                    }
                }
                _ => {}
            },
            _ => {}
        }
        i += 1;
    }
}

// ---------------------------------------------------------------- page text

struct Writer {
    out: String,
    last_y: Option<f64>,
    end_x: f64,
}

impl Writer {
    /// `advance`: how wide the text is, in the same units as `x`.
    fn put(&mut self, text: &str, x: f64, y: f64, size: f64, advance: f64) {
        if text.is_empty() {
            self.end_x = x + advance;
            return;
        }
        let size = size.abs().max(1.0);
        match self.last_y {
            Some(ly) if (ly - y).abs() > size * 0.5 => {
                let gap = (ly - y).abs();
                self.out.push('\n');
                if gap > size * 2.2 {
                    self.out.push('\n');
                }
            }
            Some(_) => {
                if (x > self.end_x + size * 0.2 || x < self.end_x - size * 2.0) && !self.out.ends_with([' ', '\n']) && !text.starts_with(' ') {
                    self.out.push(' ');
                }
            }
            None => {}
        }
        self.out.push_str(text);
        self.last_y = Some(y);
        self.end_x = x + advance;
    }
}

fn fonts_of<'a>(doc: &'a Doc, res: Option<&'a Obj>, cache: &mut HashMap<*const Obj, std::rc::Rc<Font>>) -> HashMap<String, std::rc::Rc<Font>> {
    let mut out = HashMap::new();
    let Some(fonts) = res.and_then(|r| doc.get(r, "Font")) else { return out };
    for (name, f) in fonts.dict().unwrap_or_default() {
        let f = doc.resolve(f);
        let key = f as *const Obj;
        let font = cache.entry(key).or_insert_with(|| std::rc::Rc::new(Font::of(doc, f))).clone();
        out.insert(name.clone(), font);
    }
    out
}

fn run_content(doc: &Doc, data: &[u8], res: Option<&Obj>, w: &mut Writer, cache: &mut HashMap<*const Obj, std::rc::Rc<Font>>, depth: usize) {
    if depth > 4 {
        return;
    }
    let fonts = fonts_of(doc, res, cache);
    let mut lx = Lexer::new(data);
    let mut args: Vec<Obj> = Vec::new();
    let mut font: Option<std::rc::Rc<Font>> = None;
    let (mut size, mut scale) = (10.0f64, 1.0f64);
    let (mut lx0, mut ly0, mut x, mut y) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
    let mut leading = 0.0f64;
    let (mut char_space, mut word_space) = (0.0f64, 0.0f64);
    let num = |a: &[Obj], i: usize| a.get(i).and_then(Obj::num).unwrap_or(0.0);
    while let Some(t) = lx.next() {
        let Tok::Kw(op) = t else {
            let o = parse(&mut lx, t, 0);
            if args.len() < 64 {
                args.push(o);
            }
            continue;
        };
        // Shows a string at (x, y); the x where the next one starts.
        let (cs, ws, font_now) = (char_space, word_space, font.clone());
        let show = |bytes: &[u8], x: f64, y: f64, w: &mut Writer| -> f64 {
            let Some(f) = &font_now else { return x };
            let (text, width, spaces) = f.text(bytes);
            let count = bytes.len() / f.widths.iter().copied().max().unwrap_or(1).max(1);
            let advance = (width / 1000.0 * size + cs * count as f64 + ws * spaces as f64) * scale;
            w.put(&text, x, y, size * scale, advance);
            x + advance
        };
        match op.as_str() {
            "BT" => {
                lx0 = 0.0;
                ly0 = 0.0;
                x = 0.0;
                y = 0.0;
                scale = 1.0;
            }
            "Tf" => {
                font = args.first().and_then(Obj::name).and_then(|n| fonts.get(n)).cloned();
                size = num(&args, 1);
            }
            "TL" => leading = num(&args, 0),
            "Tc" => char_space = num(&args, 0),
            "Tw" => word_space = num(&args, 0),
            "Tm" => {
                scale = (num(&args, 0).powi(2) + num(&args, 1).powi(2)).sqrt().max(0.01);
                lx0 = num(&args, 4);
                ly0 = num(&args, 5);
                x = lx0;
                y = ly0;
            }
            "Td" | "TD" => {
                if op == "TD" {
                    leading = -num(&args, 1);
                }
                lx0 += num(&args, 0) * scale;
                ly0 += num(&args, 1) * scale;
                x = lx0;
                y = ly0;
            }
            "T*" => {
                ly0 -= leading.max(size) * scale;
                x = lx0;
                y = ly0;
            }
            "Tj" => {
                if let Some(Obj::Str(s)) = args.last() {
                    x = show(s, x, y, w);
                }
            }
            "'" | "\"" => {
                ly0 -= leading.max(size) * scale;
                x = lx0;
                y = ly0;
                if op == "\"" {
                    word_space = num(&args, 0);
                    char_space = num(&args, 1);
                }
                if let Some(Obj::Str(s)) = args.last() {
                    x = show(s, x, y, w);
                }
            }
            "TJ" => {
                if let Some(Obj::Arr(parts)) = args.last() {
                    for p in parts {
                        match p {
                            Obj::Str(s) => x = show(s, x, y, w),
                            Obj::Num(n) => {
                                x -= n / 1000.0 * size * scale;
                                if *n < -250.0 && !w.out.ends_with([' ', '\n']) && !w.out.is_empty() {
                                    w.out.push(' ');
                                }
                                w.end_x = x;
                            }
                            _ => {}
                        }
                    }
                }
            }
            "Do" => {
                let form = args.first().and_then(Obj::name).and_then(|n| res.and_then(|r| doc.get(r, "XObject")).and_then(|xo| xo.get(n)).map(|o| doc.resolve(o)));
                if let Some(form) = form.filter(|f| f.get("Subtype").and_then(Obj::name) == Some("Form")) {
                    if let Some(data) = decode(form) {
                        let inner = doc.get(form, "Resources").or(res);
                        run_content(doc, &data, inner, w, cache, depth + 1);
                    }
                }
            }
            "BI" => {
                // An inline image: its bytes up to "EI".
                let mut at = lx.i;
                loop {
                    match find(lx.b, b"EI", at) {
                        Some(p) if p > 0 && lx.b.get(p - 1).is_some_and(|c| is_space(*c)) && lx.b.get(p + 2).is_none_or(|c| is_space(*c)) => {
                            lx.i = p + 2;
                            break;
                        }
                        Some(p) => at = p + 2,
                        None => {
                            lx.i = lx.b.len();
                            break;
                        }
                    }
                }
            }
            _ => {}
        }
        args.clear();
    }
}

/// A line with its digits as "#": "pag. 2 di 10" and "pag. 3 di 10" are the same running header.
fn shape(line: &str) -> String {
    line.trim().chars().map(|c| if c.is_ascii_digit() { '#' } else { c }).collect()
}

/// A page number line, or one that carries it ("… · pag. 2 di 10", "Pagina 3/8", "4").
fn has_page_number(line: &str) -> bool {
    let l = line.trim().to_lowercase();
    let words: Vec<&str> = l.split(|c: char| c.is_whitespace() || c == '·' || c == '|').filter(|w| !w.is_empty()).collect();
    let num = |w: &str| !w.is_empty() && w.chars().all(|c| c.is_ascii_digit());
    if words.len() == 1 && num(words[0]) {
        return true;
    }
    let n_of_m = words.windows(3).any(|w| num(w[0]) && matches!(w[1], "di" | "of" | "/") && num(w[2]));
    let slash = words.iter().any(|w| {
        let mut parts = w.split('/');
        matches!((parts.next(), parts.next(), parts.next()), (Some(a), Some(b), None) if num(a) && num(b))
    });
    let label = words.iter().any(|w| matches!(w.trim_end_matches('.'), "pag" | "pagina" | "page" | "p"));
    n_of_m || (slash && label)
}

/// The lines a running header or footer can be: the first and last
/// `EDGE` lines with text of a page (indexes in `page.lines()`).
const EDGE: usize = 3;

fn edges(page: &str) -> Vec<usize> {
    let full: Vec<usize> = page.lines().enumerate().filter(|(_, l)| !l.trim().is_empty()).map(|(i, _)| i).collect();
    let mut out: Vec<usize> = full.iter().take(EDGE).chain(full.iter().rev().take(EDGE)).copied().collect();
    out.sort_unstable();
    out.dedup();
    out
}

/// Running headers and footers: a line at the top or bottom of at least half
/// of the pages (and of two) stays only where it first appears. Lines that
/// differ only by the page number count as one when they carry it. Returns
/// the lines taken out.
fn drop_running_lines(pages: &mut [String]) -> usize {
    use std::collections::HashSet;
    if pages.len() < 2 {
        return 0;
    }
    let need = pages.len().div_ceil(2).max(2);
    let key = |l: &str| if has_page_number(l) { shape(l) } else { l.trim().to_string() };
    let mut count: HashMap<String, usize> = HashMap::new();
    for p in pages.iter() {
        let lines: Vec<&str> = p.lines().collect();
        let mut seen = HashSet::new();
        for i in edges(p) {
            let Some(l) = lines.get(i).map(|l| l.trim()) else { continue };
            if l.chars().count() >= 4 && seen.insert(key(l)) {
                *count.entry(key(l)).or_default() += 1;
            }
        }
    }
    let mut kept: HashSet<String> = HashSet::new();
    let mut removed = 0;
    for p in pages.iter_mut() {
        let at: HashSet<usize> = edges(p).into_iter().collect();
        let mut out = String::new();
        for (i, l) in p.lines().enumerate() {
            let k = key(l);
            if at.contains(&i) && l.trim().chars().count() >= 4 && count.get(&k).is_some_and(|n| *n >= need) && !kept.insert(k) {
                removed += 1;
                continue;
            }
            out.push_str(l);
            out.push('\n');
        }
        *p = out.trim().to_string();
    }
    removed
}

/// The text of a PDF, page by page.
pub fn text(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() > MAX_FILE {
        return Err("Il PDF è troppo grande (oltre 150 MB).".into());
    }
    if !bytes.get(..1024).unwrap_or(bytes).windows(5).any(|w| w == b"%PDF-") {
        return Err("Non è un file PDF.".into());
    }
    let doc = Doc::read(bytes);
    if doc.encrypted() {
        return Err("Il PDF è protetto (cifrato): non si legge senza aprirlo con la password.".into());
    }
    let pages = doc.pages();
    if pages.is_empty() {
        return Err("Nel PDF non ho trovato pagine leggibili.".into());
    }
    let mut cache = HashMap::new();
    let mut texts: Vec<String> = Vec::new();
    let mut size = 0usize;
    let mut cut = false;
    let mut letters = 0usize;
    for (page, res) in pages.iter() {
        let mut data = Vec::new();
        match doc.get(page, "Contents") {
            Some(Obj::Arr(parts)) => {
                for p in parts {
                    if let Some(d) = decode(doc.resolve(p)) {
                        data.extend(d);
                        data.push(b'\n');
                    }
                }
            }
            Some(s @ Obj::Stream(..)) => data = decode(s).unwrap_or_default(),
            _ => {}
        }
        let mut w = Writer { out: String::new(), last_y: None, end_x: 0.0 };
        run_content(&doc, &data, *res, &mut w, &mut cache, 0);
        // Lines without text go; never more than one empty line in a row.
        let mut page_text = String::new();
        for line in w.out.lines().map(str::trim_end) {
            let empty = line.trim().is_empty();
            if empty && (page_text.is_empty() || page_text.ends_with("\n\n")) {
                continue;
            }
            page_text.push_str(if empty { "" } else { line });
            page_text.push('\n');
        }
        letters += page_text.chars().filter(|c| c.is_alphanumeric()).count();
        size += page_text.chars().count();
        texts.push(page_text.trim().to_string());
        if size > MAX_TEXT {
            cut = true;
            break;
        }
    }
    let repeated = drop_running_lines(&mut texts);
    let mut out = String::new();
    for (n, t) in texts.iter().enumerate() {
        if pages.len() > 1 {
            out.push_str(&format!("\n\n[Pagina {}]\n", n + 1));
        }
        out.push_str(t.trim());
    }
    if out.chars().count() > MAX_TEXT {
        out = out.chars().take(MAX_TEXT).collect::<String>();
        cut = true;
    }
    if cut {
        out.push_str("\n\n[…PDF tagliato qui: è molto lungo]");
    }
    if repeated > 0 {
        out.push_str(&format!("\n\n[Intestazione e piè di pagina solo alla prima pagina: −{repeated} righe.]"));
    }
    if letters < 20 * pages.len().min(5) {
        let note = "[Il PDF non ha quasi testo: probabilmente è una scansione, e le scansioni non si leggono.]";
        return Ok(if out.trim().is_empty() { note.to_string() } else { format!("{}\n\n{note}", out.trim()) });
    }
    Ok(out.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn running_headers_and_footers_stay_once() {
        let mut pages: Vec<String> = (1..=4)
            .map(|n| format!("Offerta Rossi · pag. {n} di 4\nTesto della pagina {n}\nUna riga {n}\nQuantità 2\nAltra riga {n}\nUltima riga {n}\nEasytech S.r.l. · Terni · P.IVA 01713230553"))
            .collect();
        let removed = drop_running_lines(&mut pages);
        assert_eq!(removed, 6);
        assert!(pages[0].contains("pag. 1 di 4") && pages[0].contains("P.IVA"));
        // "Quantità 2" is on every page, but in the middle: it stays.
        assert_eq!(pages[2], "Testo della pagina 3\nUna riga 3\nQuantità 2\nAltra riga 3\nUltima riga 3");
        assert!(pages.iter().all(|p| p.contains("Testo della pagina")));
        assert!(has_page_number("Pagina 3/8") && has_page_number("12") && !has_page_number("Via Roma 3/B"));
        let mut one = vec!["Solo una pagina".to_string()];
        assert_eq!(drop_running_lines(&mut one), 0);
    }

    fn pdf(content: &[u8], extra: &str) -> Vec<u8> {
        let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        std::io::Write::write_all(&mut z, content).unwrap();
        let packed = z.finish().unwrap();
        let mut b = b"%PDF-1.7\n%\xe2\xe3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 4 0 R /F2 6 0 R >> >> >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>\nendobj\n4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Differences [ 200 /egrave /Euro ] >> >>\nendobj\n".to_vec();
        b.extend(format!("5 0 obj\n<< /Length {} /Filter /FlateDecode >>\nstream\n", packed.len()).as_bytes());
        b.extend(&packed);
        b.extend(b"\nendstream\nendobj\n");
        let cmap = b"/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0001> <0043> <0002> <00F2> endbfchar 1 beginbfrange <0010> <0012> <0061> endbfrange endcmap";
        b.extend(format!("6 0 obj\n<< /Type /Font /Subtype /Type0 /ToUnicode 7 0 R >>\nendobj\n7 0 obj\n<< /Length {} >>\nstream\n", cmap.len()).as_bytes());
        b.extend(cmap);
        b.extend(b"\nendstream\nendobj\n");
        b.extend(extra.as_bytes());
        b.extend(b"trailer\n<< /Root 1 0 R >>\n%%EOF\n");
        b
    }

    #[test]
    fn text_lines_and_fonts_are_read() {
        let content = b"BT /F1 12 Tf 72 700 Td (Caff\\310 \\311 10) Tj 0 -14 Td [(Seconda) -300 (riga)] TJ /F2 12 Tf 0 -40 Td <000100020010001100120010> Tj ET";
        assert_eq!(text(&pdf(content, "")).unwrap(), "Caffè € 10\nSeconda riga\n\nCòabca");
    }

    #[test]
    fn encrypted_and_broken_files_are_errors_not_panics() {
        assert!(text(b"hello").is_err());
        let enc = pdf(b"BT ET", "trailer\n<< /Encrypt 9 0 R >>\n");
        assert!(text(&enc).unwrap_err().contains("protetto"));
        // Cut anywhere: never a panic.
        let good = pdf(b"BT /F1 12 Tf (abc) Tj ET", "");
        for cut in (0..good.len()).step_by(7) {
            let _ = text(&good[..cut]);
        }
        let _ = text(b"%PDF-1.4 1 0 obj << /Kids [1 0 R] /Type /Pages >> endobj trailer << /Root 1 0 R >>");
    }

    #[test]
    fn a_page_without_text_says_it_is_a_scan() {
        assert!(text(&pdf(b"q 100 0 0 100 0 0 cm Q", "")).unwrap().contains("scansione"));
    }
}
