// «Ricerca per significato» on this PC (14 Nov 2026): the memory's lines turned
// into vectors here, with no service, no key and nothing leaving the PC.
//
// The model is potion-multilingual-128M (MinishLab, MIT): a static model, one
// vector of 256 numbers per word piece of a 500,000-piece vocabulary (101
// languages), and a sentence's vector is the mean of its pieces' vectors. No
// network runs at question time, and no inference library is needed: the
// tokenizer (Unigram, as in sentencepiece, with its precompiled normalisation)
// is written below and checked against the original one.
//
// It is not in the installer (512 MB): Impostazioni → Chat → Memoria downloads
// it after a click, from a fixed revision on Hugging Face, checked with SHA-256,
// and keeps it in %LOCALAPPDATA%\EasyIsland\significato-locale\ as
//   parole.bin   the pieces with their scores and the normalisation map (~20 MB)
//   vettori.bin  one row per piece, 8-bit with its scale (~130 MB)
// The rows are read from the file as needed: in memory only the pieces (~25 MB),
// dropped after 10 minutes of no use.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::i18n::{t, tf};

const REVISION: &str = "73908c3438cf03b6a01bcb9611d62b23d0726f08";
const BASE: &str = "https://huggingface.co/minishlab/potion-multilingual-128M/resolve";
const TOKENIZER_SHA: &str = "19f1909063da3cfe3bd83a782381f040dccea475f4816de11116444a73e1b6a1";
const MODEL_SHA: &str = "14b5eb39cb4ce5666da8ad1f3dc6be4346e9b2d601c073302fa0a31bf7943397";
const TOKENIZER_SIZE: u64 = 18_616_131;
const MODEL_SIZE: u64 = 512_361_560;
/// What the download weighs, for the button.
pub const DOWNLOAD_MB: u64 = (TOKENIZER_SIZE + MODEL_SIZE) / 1_000_000;

const VOCAB_MAGIC: &[u8; 4] = b"EIV1";
const ROWS_MAGIC: &[u8; 4] = b"EIM1";
/// Pieces per sentence at most, and characters read of a long one.
const MAX_TOKENS: usize = 512;
const MAX_CHARS: usize = 2_000;
/// The pieces leave memory after this long unused.
const IDLE: Duration = Duration::from_secs(600);

fn dir() -> PathBuf {
    #[cfg(test)]
    if let Some(d) = std::env::var_os("EI_MEANING_DIR") {
        return PathBuf::from(d);
    }
    crate::settings::local_dir().join("significato-locale")
}

fn vocab_path() -> PathBuf {
    dir().join("parole.bin")
}

fn rows_path() -> PathBuf {
    dir().join("vettori.bin")
}

/// The model is on this PC, whole.
pub fn ready() -> bool {
    let ok = |p: PathBuf, magic: &[u8; 4]| {
        let mut head = [0u8; 4];
        std::fs::File::open(p).and_then(|mut f| f.read_exact(&mut head)).is_ok() && &head == magic
    };
    ok(vocab_path(), VOCAB_MAGIC) && ok(rows_path(), ROWS_MAGIC)
}

// ---------------------------------------------------------------------------
// Download

#[derive(Clone, Default, Serialize)]
pub struct Status {
    pub ready: bool,
    pub busy: bool,
    /// 0–100 while downloading.
    pub percent: u32,
    pub error: String,
    /// Megabytes to download, and on disk once ready.
    pub download_mb: u64,
    pub disk_mb: u64,
}

static PROGRESS: Mutex<(bool, u32, String)> = Mutex::new((false, 0, String::new()));

pub fn status() -> Status {
    let (busy, percent, error) = PROGRESS.lock().map(|g| g.clone()).unwrap_or_default();
    let size = |p: PathBuf| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    Status {
        ready: ready(),
        busy,
        percent,
        error,
        download_mb: DOWNLOAD_MB,
        disk_mb: (size(vocab_path()) + size(rows_path())) / 1_000_000,
    }
}

fn set_progress(percent: u32) {
    if let Ok(mut g) = PROGRESS.lock() {
        g.1 = percent.min(100);
    }
}

/// Downloads and converts the model (after the click in Impostazioni). One at a time.
pub async fn download() -> Result<(), String> {
    {
        let mut g = PROGRESS.lock().map_err(|e| e.to_string())?;
        if g.0 {
            return Err(t("Il modello si sta già scaricando.").into());
        }
        *g = (true, 0, String::new());
    }
    let result = fetch_all().await;
    if let Ok(mut g) = PROGRESS.lock() {
        g.0 = false;
        g.2 = result.as_ref().err().cloned().unwrap_or_default();
    }
    match &result {
        Ok(()) => crate::log::line("significato sul PC: modello scaricato"),
        Err(e) => crate::log::line(format!("significato sul PC: download non riuscito: {e}")),
    }
    result
}

async fn fetch_all() -> Result<(), String> {
    std::fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(3_600))
        .build()
        .map_err(|e| e.to_string())?;
    let total = TOKENIZER_SIZE + MODEL_SIZE;

    // The tokenizer: whole in memory (18 MB), then its pieces in parole.bin.
    let mut response = get(&client, "tokenizer.json").await?;
    let mut hash = Sha256::new()?;
    let mut tok = Vec::with_capacity(TOKENIZER_SIZE as usize);
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        hash.update(&chunk)?;
        tok.extend_from_slice(&chunk);
        set_progress((tok.len() as u64 * 100 / total) as u32);
    }
    if hash.finish_hex()? != TOKENIZER_SHA {
        return Err(t("Il file scaricato non è quello atteso (impronta diversa).").into());
    }
    let vocab = tauri::async_runtime::spawn_blocking(move || vocab_from_json(&tok)).await.map_err(|e| e.to_string())??;
    let part = vocab_path().with_extension("part");
    std::fs::write(&part, &vocab).map_err(|e| e.to_string())?;

    // The vectors: converted while they arrive, never whole on disk.
    let mut response = get(&client, "model.safetensors").await?;
    let mut hash = Sha256::new()?;
    let rows_part = rows_path().with_extension("part");
    let mut conv = Converter::new(std::fs::File::create(&rows_part).map_err(|e| e.to_string())?);
    let mut got = 0u64;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        hash.update(&chunk)?;
        got += chunk.len() as u64;
        conv.push(&chunk)?;
        set_progress(((TOKENIZER_SIZE + got) * 100 / total) as u32);
    }
    conv.finish()?;
    if hash.finish_hex()? != MODEL_SHA {
        let _ = std::fs::remove_file(&rows_part);
        return Err(t("Il file scaricato non è quello atteso (impronta diversa).").into());
    }
    drop_model();
    std::fs::rename(&part, vocab_path()).map_err(|e| e.to_string())?;
    std::fs::rename(&rows_part, rows_path()).map_err(|e| e.to_string())?;
    set_progress(100);
    Ok(())
}

async fn get(client: &reqwest::Client, file: &str) -> Result<reqwest::Response, String> {
    let url = format!("{BASE}/{REVISION}/{file}");
    let response = client.get(&url).send().await.map_err(|e| tf("Hugging Face non raggiungibile: {e}", &[("e", &e.to_string())]))?;
    if !response.status().is_success() {
        return Err(tf("Hugging Face ha risposto {status}.", &[("status", &response.status().to_string())]));
    }
    Ok(response)
}

/// Takes the model off this PC.
pub fn remove() -> Result<(), String> {
    if PROGRESS.lock().map(|g| g.0).unwrap_or(false) {
        return Err(t("Il modello si sta scaricando: aspetta la fine.").into());
    }
    drop_model();
    if dir().exists() {
        std::fs::remove_dir_all(dir()).map_err(|e| e.to_string())?;
    }
    if let Ok(mut g) = PROGRESS.lock() {
        *g = (false, 0, String::new());
    }
    Ok(())
}

/// SHA-256 a piece at a time (Windows CNG, as msgraph::sha256).
struct Sha256(windows::Win32::Security::Cryptography::BCRYPT_HASH_HANDLE);

// A CNG hash object may move between threads; it is used by one at a time (owned, &mut).
unsafe impl Send for Sha256 {}

impl Sha256 {
    fn new() -> Result<Self, String> {
        use windows::Win32::Security::Cryptography::{BCryptCreateHash, BCRYPT_HASH_HANDLE, BCRYPT_SHA256_ALG_HANDLE};
        let mut h = BCRYPT_HASH_HANDLE::default();
        unsafe { BCryptCreateHash(BCRYPT_SHA256_ALG_HANDLE, &mut h, None, None, 0) }.ok().map_err(|e| e.to_string())?;
        Ok(Self(h))
    }

    fn update(&mut self, data: &[u8]) -> Result<(), String> {
        use windows::Win32::Security::Cryptography::BCryptHashData;
        unsafe { BCryptHashData(self.0, data, 0) }.ok().map_err(|e| e.to_string())
    }

    fn finish_hex(&mut self) -> Result<String, String> {
        use windows::Win32::Security::Cryptography::BCryptFinishHash;
        let mut out = [0u8; 32];
        unsafe { BCryptFinishHash(self.0, &mut out, 0) }.ok().map_err(|e| e.to_string())?;
        Ok(out.iter().map(|b| format!("{b:02x}")).collect())
    }
}

impl Drop for Sha256 {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Security::Cryptography::BCryptDestroyHash(self.0);
        }
    }
}

/// tokenizer.json → parole.bin: the normalisation map, then every piece with its score.
fn vocab_from_json(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let v: serde_json::Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    let bad = || t("Il tokenizer scaricato non ha la forma attesa.").to_string();
    let model = v.get("model").ok_or_else(bad)?;
    if model.get("type").and_then(|x| x.as_str()) != Some("Unigram") {
        return Err(bad());
    }
    let unk = model.get("unk_id").and_then(|x| x.as_u64()).ok_or_else(bad)? as u32;
    let pieces = model.get("vocab").and_then(|x| x.as_array()).ok_or_else(bad)?;
    let charsmap = find_charsmap(v.get("normalizer").ok_or_else(bad)?).and_then(crate::backup::base64_decode).ok_or_else(bad)?;
    let mut out = Vec::with_capacity(16 + charsmap.len() + pieces.len() * 12);
    out.extend_from_slice(VOCAB_MAGIC);
    out.extend_from_slice(&(pieces.len() as u32).to_le_bytes());
    out.extend_from_slice(&unk.to_le_bytes());
    out.extend_from_slice(&(charsmap.len() as u32).to_le_bytes());
    out.extend_from_slice(&charsmap);
    for p in pieces {
        let piece = p.get(0).and_then(|x| x.as_str()).ok_or_else(bad)?;
        let score = p.get(1).and_then(|x| x.as_f64()).ok_or_else(bad)? as f32;
        let len = u16::try_from(piece.len()).map_err(|_| bad())?;
        out.extend_from_slice(&score.to_le_bytes());
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(piece.as_bytes());
    }
    Ok(out)
}

fn find_charsmap(n: &serde_json::Value) -> Option<&str> {
    if n.get("type").and_then(|x| x.as_str()) == Some("Precompiled") {
        return n.get("precompiled_charsmap").and_then(|x| x.as_str());
    }
    n.get("normalizers").and_then(|x| x.as_array())?.iter().find_map(find_charsmap)
}

/// model.safetensors → vettori.bin while it arrives: each row of 256 floats
/// becomes its scale and 256 signed bytes.
struct Converter {
    out: std::io::BufWriter<std::fs::File>,
    buf: Vec<u8>,
    /// Header read: rows, numbers per row, bytes of data before the matrix.
    shape: Option<(u32, u32)>,
    skip: u64,
    header_len: Option<u64>,
    rows_done: u32,
}

impl Converter {
    fn new(file: std::fs::File) -> Self {
        Self { out: std::io::BufWriter::with_capacity(1 << 20, file), buf: Vec::new(), shape: None, skip: 0, header_len: None, rows_done: 0 }
    }

    fn push(&mut self, chunk: &[u8]) -> Result<(), String> {
        self.buf.extend_from_slice(chunk);
        if self.header_len.is_none() {
            let Some(len) = self.buf.get(..8) else { return Ok(()) };
            let len = u64::from_le_bytes(len.try_into().map_err(|_| "header")?);
            if len > 10_000_000 {
                return Err(t("Il modello scaricato non ha la forma attesa.").into());
            }
            self.header_len = Some(len);
        }
        let header_len = self.header_len.unwrap_or(0) as usize;
        if self.shape.is_none() {
            let Some(head) = self.buf.get(8..8 + header_len) else { return Ok(()) };
            let (rows, dim, start) = parse_header(head)?;
            self.shape = Some((rows, dim));
            self.skip = start;
            self.buf.drain(..8 + header_len);
            self.out.write_all(ROWS_MAGIC).map_err(|e| e.to_string())?;
            self.out.write_all(&rows.to_le_bytes()).map_err(|e| e.to_string())?;
            self.out.write_all(&dim.to_le_bytes()).map_err(|e| e.to_string())?;
        }
        if self.skip > 0 {
            let n = (self.skip as usize).min(self.buf.len());
            self.buf.drain(..n);
            self.skip -= n as u64;
        }
        let Some((rows, dim)) = self.shape else { return Ok(()) };
        let row_bytes = dim as usize * 4;
        let mut at = 0;
        while self.rows_done < rows && self.buf.len() - at >= row_bytes {
            let row: Vec<f32> = self.buf[at..at + row_bytes].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
            let (scale, q) = quantize(&row);
            self.out.write_all(&scale.to_le_bytes()).map_err(|e| e.to_string())?;
            self.out.write_all(&q.iter().map(|x| *x as u8).collect::<Vec<u8>>()).map_err(|e| e.to_string())?;
            at += row_bytes;
            self.rows_done += 1;
        }
        self.buf.drain(..at);
        Ok(())
    }

    fn finish(mut self) -> Result<(), String> {
        match self.shape {
            Some((rows, _)) if rows == self.rows_done => self.out.flush().map_err(|e| e.to_string()),
            _ => Err(t("Il modello scaricato è incompleto.").into()),
        }
    }
}

/// The one F32 matrix of a safetensors header: rows, numbers per row, where it starts.
fn parse_header(head: &[u8]) -> Result<(u32, u32, u64), String> {
    let bad = || t("Il modello scaricato non ha la forma attesa.").to_string();
    let v: serde_json::Value = serde_json::from_slice(head).map_err(|_| bad())?;
    let (_, m) = v.as_object().ok_or_else(bad)?.iter().find(|(k, _)| k.as_str() != "__metadata__").ok_or_else(bad)?;
    if m.get("dtype").and_then(|x| x.as_str()) != Some("F32") {
        return Err(bad());
    }
    let shape: Vec<u64> = m.get("shape").and_then(|x| x.as_array()).ok_or_else(bad)?.iter().filter_map(|x| x.as_u64()).collect();
    let offsets: Vec<u64> = m.get("data_offsets").and_then(|x| x.as_array()).ok_or_else(bad)?.iter().filter_map(|x| x.as_u64()).collect();
    match (shape.as_slice(), offsets.as_slice()) {
        ([rows, dim], [start, end]) if *dim > 0 && *dim <= 4_096 && end - start == rows * dim * 4 => Ok((*rows as u32, *dim as u32, *start)),
        _ => Err(bad()),
    }
}

fn quantize(row: &[f32]) -> (f32, Vec<i8>) {
    let max = row.iter().fold(0f32, |m, x| m.max(x.abs()));
    if max == 0.0 {
        return (0.0, vec![0; row.len()]);
    }
    let scale = max / 127.0;
    (scale, row.iter().map(|x| (x / scale).round().clamp(-127.0, 127.0) as i8).collect())
}

// ---------------------------------------------------------------------------
// The model in memory

struct Model {
    /// All the pieces' bytes, one after the other; `starts[i]..starts[i+1]` is piece i.
    blob: Vec<u8>,
    starts: Vec<u32>,
    scores: Vec<f32>,
    /// Piece ids sorted by their bytes, for the prefix search.
    sorted: Vec<u32>,
    unk: u32,
    min_score: f32,
    longest: usize,
    norm: Precompiled,
    rows: u32,
    dim: u32,
    file: std::fs::File,
}

static MODEL: Mutex<Option<(Arc<Model>, Instant)>> = Mutex::new(None);

fn drop_model() {
    if let Ok(mut g) = MODEL.lock() {
        *g = None;
    }
}

fn model() -> Result<Arc<Model>, String> {
    let mut g = MODEL.lock().map_err(|e| e.to_string())?;
    if let Some((m, used)) = g.as_mut() {
        *used = Instant::now();
        return Ok(m.clone());
    }
    let m = Arc::new(load()?);
    *g = Some((m.clone(), Instant::now()));
    drop(g);
    // Out of memory after a while unused (the rows stay in the file anyway).
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(60));
        let Ok(mut g) = MODEL.lock() else { return };
        match g.as_ref() {
            Some((_, used)) if used.elapsed() >= IDLE => {
                *g = None;
                return;
            }
            Some(_) => {}
            None => return,
        }
    });
    Ok(m)
}

fn load() -> Result<Model, String> {
    let bytes = std::fs::read(vocab_path()).map_err(|_| t("Il modello per il significato non è su questo PC.").to_string())?;
    let bad = || t("Il modello per il significato è rovinato: scaricalo di nuovo.").to_string();
    let u32_at = |at: usize| bytes.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]));
    if bytes.get(..4) != Some(VOCAB_MAGIC.as_slice()) {
        return Err(bad());
    }
    let n = u32_at(4).ok_or_else(bad)? as usize;
    let unk = u32_at(8).ok_or_else(bad)?;
    let map_len = u32_at(12).ok_or_else(bad)? as usize;
    let norm = Precompiled::new(bytes.get(16..16 + map_len).ok_or_else(bad)?).ok_or_else(bad)?;
    let mut at = 16 + map_len;
    let mut blob = Vec::with_capacity(bytes.len());
    let mut starts = Vec::with_capacity(n + 1);
    let mut scores = Vec::with_capacity(n);
    for _ in 0..n {
        let score = bytes.get(at..at + 4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).ok_or_else(bad)?;
        let len = bytes.get(at + 4..at + 6).map(|b| u16::from_le_bytes([b[0], b[1]])).ok_or_else(bad)? as usize;
        let piece = bytes.get(at + 6..at + 6 + len).ok_or_else(bad)?;
        starts.push(blob.len() as u32);
        blob.extend_from_slice(piece);
        scores.push(score);
        at += 6 + len;
    }
    starts.push(blob.len() as u32);
    let piece = |i: u32| &blob[starts[i as usize] as usize..starts[i as usize + 1] as usize];
    let mut sorted: Vec<u32> = (0..n as u32).filter(|i| !piece(*i).is_empty()).collect();
    sorted.sort_unstable_by(|a, b| piece(*a).cmp(piece(*b)));
    let longest = (0..n as u32).map(|i| piece(i).len()).max().unwrap_or(1);
    let min_score = scores.iter().copied().fold(f32::INFINITY, f32::min);

    let mut file = std::fs::File::open(rows_path()).map_err(|_| bad())?;
    let mut head = [0u8; 12];
    file.read_exact(&mut head).map_err(|_| bad())?;
    if &head[..4] != ROWS_MAGIC {
        return Err(bad());
    }
    let rows = u32::from_le_bytes([head[4], head[5], head[6], head[7]]);
    let dim = u32::from_le_bytes([head[8], head[9], head[10], head[11]]);
    if dim == 0 || dim > 4_096 {
        return Err(bad());
    }
    Ok(Model { blob, starts, scores, sorted, unk, min_score, longest, norm, rows, dim, file })
}

impl Model {
    fn piece(&self, i: u32) -> &[u8] {
        let i = i as usize;
        match (self.starts.get(i), self.starts.get(i + 1)) {
            (Some(a), Some(b)) => self.blob.get(*a as usize..*b as usize).unwrap_or(&[]),
            _ => &[],
        }
    }

    /// The pieces that `text` starts with, shortest first.
    fn prefixes(&self, text: &[u8], out: &mut Vec<(usize, u32)>) {
        out.clear();
        let mut lo = 0usize;
        let mut hi = self.sorted.len();
        for len in 1..=text.len().min(self.longest) {
            let key = &text[..len];
            // The range of pieces that start with `key` narrows as it grows.
            let from = lo + self.sorted[lo..hi].partition_point(|i| self.piece(*i) < key);
            let to = from + self.sorted[from..hi].partition_point(|i| self.piece(*i).starts_with(key));
            if from == to {
                return;
            }
            if let Some(&id) = self.sorted.get(from) {
                if self.piece(id) == key && std::str::from_utf8(key).is_ok() {
                    out.push((len, id));
                }
            }
            lo = from;
            hi = to;
        }
    }

    /// The text as piece ids, as the original tokenizer gives them (unknown pieces left out).
    fn tokens(&self, text: &str) -> Vec<u32> {
        // The added tokens («[PAD]», «[UNK]») are taken whole before anything
        // else, as the original does; the text between them goes on alone.
        let added: Vec<(u32, &str)> = [0u32, self.unk]
            .into_iter()
            .filter_map(|id| std::str::from_utf8(self.piece(id)).ok().filter(|p| p.starts_with('[')).map(|p| (id, p)))
            .collect();
        if let Some((at, id, len)) = added.iter().filter_map(|(id, p)| text.find(p).map(|at| (at, *id, p.len()))).min_by_key(|x| x.0) {
            let mut ids = self.tokens(&text[..at]);
            if id != self.unk {
                ids.push(id);
            }
            ids.extend(self.tokens(&text[at + len..]));
            ids.truncate(MAX_TOKENS);
            return ids;
        }
        let normal = normalize(&self.norm, text);
        if normal.is_empty() {
            return Vec::new();
        }
        // Metaspace, prepended always (unless the text starts with one already).
        let mut s = normal.replace(' ', "\u{2581}");
        if !s.starts_with('\u{2581}') {
            s.insert(0, '\u{2581}');
        }
        let bytes = s.as_bytes();
        let n = bytes.len();
        // Viterbi: the best path ending at every byte.
        #[derive(Clone, Copy)]
        struct Node {
            score: f32,
            from: usize,
            id: u32,
            set: bool,
        }
        let mut best = vec![Node { score: 0.0, from: 0, id: 0, set: false }; n + 1];
        best[0].set = true;
        let unk_score = self.min_score - 10.0;
        let mut found = Vec::new();
        let mut at = 0;
        while at < n {
            let width = s[at..].chars().next().map(char::len_utf8).unwrap_or(1);
            let here = best[at].score;
            self.prefixes(&bytes[at..], &mut found);
            let mut single = false;
            for &(len, id) in &found {
                let score = here + self.scores.get(id as usize).copied().unwrap_or(unk_score);
                let target = &mut best[at + len];
                if !target.set || score > target.score {
                    *target = Node { score, from: at, id, set: true };
                }
                single |= len == width;
            }
            if !single {
                let target = &mut best[at + width];
                let score = here + unk_score;
                if !target.set || score > target.score {
                    *target = Node { score, from: at, id: self.unk, set: true };
                }
            }
            at += width;
        }
        let mut ids = Vec::new();
        let mut end = n;
        while end > 0 {
            let node = best[end];
            if node.id != self.unk {
                ids.push(node.id);
            }
            end = node.from;
        }
        ids.reverse();
        ids.truncate(MAX_TOKENS);
        ids
    }

    /// The sentence's vector: the mean of its pieces' rows, unit length.
    fn embed(&self, text: &str) -> Vec<f32> {
        use std::os::windows::fs::FileExt;
        let text: String = text.chars().take(MAX_CHARS).collect();
        let dim = self.dim as usize;
        let mut sum = vec![0f32; dim];
        let mut row = vec![0u8; 4 + dim];
        let mut count = 0;
        for id in self.tokens(&text) {
            if id >= self.rows {
                continue;
            }
            let offset = 12 + id as u64 * (4 + dim as u64);
            if self.file.seek_read(&mut row, offset).ok() != Some(row.len()) {
                continue;
            }
            let scale = f32::from_le_bytes([row[0], row[1], row[2], row[3]]);
            for (s, q) in sum.iter_mut().zip(&row[4..]) {
                *s += *q as i8 as f32 * scale;
            }
            count += 1;
        }
        if count == 0 {
            return Vec::new();
        }
        let norm = sum.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            sum.iter_mut().for_each(|x| *x /= norm);
        }
        sum
    }
}

/// The vectors of `texts` (empty for a text with no known piece). Blocking: call off the async runtime.
pub fn embed(texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    let m = model()?;
    Ok(texts.iter().map(|t| m.embed(t)).collect())
}

// ---------------------------------------------------------------------------
// Normalisation, as the tokenizer's: the precompiled map (NFKC and the
// sentencepiece rules), runs of spaces as one, punctuation set apart, spaces
// trimmed.

const SPACED: &str = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

fn normalize(map: &Precompiled, text: &str) -> String {
    let mut s = map.normalize(text);
    // " {2,}" → " "
    s = collapse(&s, |c| c == ' ');
    let mut spaced = String::with_capacity(s.len() + 16);
    for c in s.chars() {
        if SPACED.contains(c) {
            spaced.push(' ');
            spaced.push(c);
            spaced.push(' ');
        } else {
            spaced.push(c);
        }
    }
    // "\s+" → " ", then trimmed.
    collapse(&spaced, char::is_whitespace).trim_matches(char::is_whitespace).to_string()
}

fn collapse(s: &str, space: impl Fn(char) -> bool) -> String {
    let mut out = String::with_capacity(s.len());
    let mut run = false;
    for c in s.chars() {
        if space(c) {
            if !run {
                out.push(' ');
            }
            run = true;
        } else {
            out.push(c);
            run = false;
        }
    }
    out
}

/// sentencepiece's precompiled character map: a double-array trie over the
/// bytes of the text, pointing into a block of replacement strings.
struct Precompiled {
    trie: Vec<u32>,
    normalized: Vec<u8>,
}

impl Precompiled {
    fn new(bytes: &[u8]) -> Option<Self> {
        let size = u32::from_le_bytes(bytes.get(..4)?.try_into().ok()?) as usize;
        let trie = bytes.get(4..4 + size)?.chunks_exact(4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
        let normalized = bytes.get(4 + size..)?.to_vec();
        Some(Self { trie, normalized })
    }

    /// The first (shortest) entry `key` starts with.
    fn first_match(&self, key: &[u8]) -> Option<usize> {
        let unit_at = |i: usize| self.trie.get(i).copied();
        let offset = |u: u32| ((u >> 10) << ((u & (1 << 9)) >> 6)) as usize;
        let label = |u: u32| u & ((1 << 31) | 0xFF);
        let has_leaf = |u: u32| (u >> 8) & 1 == 1;
        let value = |u: u32| (u & ((1 << 31) - 1)) as usize;
        let mut pos = 0usize;
        let mut unit = unit_at(pos)?;
        pos ^= offset(unit);
        for &c in key {
            if c == 0 {
                break;
            }
            pos ^= c as usize;
            unit = unit_at(pos)?;
            if label(unit) != c as u32 {
                return None;
            }
            pos ^= offset(unit);
            if has_leaf(unit) {
                return Some(value(unit_at(pos)?));
            }
        }
        None
    }

    fn transform(&self, part: &str) -> Option<&str> {
        let start = self.first_match(part.as_bytes())?;
        let rest = self.normalized.get(start..)?;
        let end = rest.iter().position(|b| *b == 0).unwrap_or(rest.len());
        std::str::from_utf8(&rest[..end]).ok()
    }

    fn normalize(&self, text: &str) -> String {
        use unicode_segmentation::UnicodeSegmentation;
        let mut out = String::with_capacity(text.len());
        for grapheme in text.graphemes(true) {
            if grapheme.len() < 6 {
                if let Some(n) = self.transform(grapheme) {
                    out.push_str(n);
                    continue;
                }
            }
            for (i, c) in grapheme.char_indices() {
                match self.transform(&grapheme[i..i + c.len_utf8()]) {
                    Some(n) => out.push_str(n),
                    None => out.push(c),
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_survive_eight_bits() {
        let row = vec![0.5, -0.25, 0.0, 1.0];
        let (scale, q) = quantize(&row);
        let back: Vec<f32> = q.iter().map(|x| *x as f32 * scale).collect();
        for (a, b) in row.iter().zip(&back) {
            assert!((a - b).abs() < 0.01);
        }
        assert_eq!(quantize(&[0.0, 0.0]).0, 0.0);
    }

    #[test]
    fn punctuation_apart_and_spaces_once() {
        let map = Precompiled { trie: vec![0], normalized: Vec::new() };
        assert_eq!(normalize(&map, "  Ciao,   mondo!\n"), "Ciao , mondo !");
        assert_eq!(normalize(&map, " \t "), "");
    }

    #[test]
    fn the_header_gives_the_matrix() {
        let head = br#"{"__metadata__":{},"embeddings":{"dtype":"F32","shape":[3,2],"data_offsets":[0,24]}}"#;
        assert_eq!(parse_header(head).unwrap(), (3, 2, 0));
        let wrong = br#"{"embeddings":{"dtype":"F16","shape":[3,2],"data_offsets":[0,12]}}"#;
        assert!(parse_header(wrong).is_err());
    }

    #[test]
    fn the_converter_takes_the_bytes_in_any_pieces() {
        let head = br#"{"embeddings":{"dtype":"F32","shape":[2,2],"data_offsets":[0,16]}}"#;
        let mut all = (head.len() as u64).to_le_bytes().to_vec();
        all.extend_from_slice(head);
        for x in [1.0f32, -1.0, 0.5, 0.25] {
            all.extend_from_slice(&x.to_le_bytes());
        }
        let path = std::env::temp_dir().join(format!("ei-conv-{}.bin", std::process::id()));
        let mut c = Converter::new(std::fs::File::create(&path).unwrap());
        for chunk in all.chunks(5) {
            c.push(chunk).unwrap();
        }
        c.finish().unwrap();
        let out = std::fs::read(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(&out[..4], ROWS_MAGIC);
        assert_eq!(out.len(), 12 + 2 * (4 + 2));
        assert_eq!(out[16] as i8, 127);
        assert_eq!(out[17] as i8, -127);
    }

    /// The download as the button does it (530 MB), into EI_MEANING_DIR.
    #[test]
    #[ignore = "downloads the model: EI_MEANING_DIR=<out> cargo test download_live -- --ignored --nocapture"]
    fn download_live() {
        let started = Instant::now();
        tauri::async_runtime::block_on(download()).unwrap();
        println!("scaricato e convertito in {:?}: {} MB su disco", started.elapsed(), status().disk_mb);
        assert!(ready());
        let lines: Vec<String> = (0..3_000).map(|i| format!("Nota {i}: il cliente Rossi ha un NAS Synology in ufficio e un backup notturno")).collect();
        let started = Instant::now();
        let v = embed(&lines).unwrap();
        println!("3.000 righe in {:?}", started.elapsed());
        assert_eq!(v.len(), 3_000);
    }

    /// The files of the fixed revision, already on disk (EI_POTION), turned into
    /// the model's files in EI_MEANING_DIR as the download does.
    #[test]
    #[ignore = "EI_POTION=<folder with tokenizer.json and model.safetensors> EI_MEANING_DIR=<out>"]
    fn install_from_files() {
        let from = PathBuf::from(std::env::var("EI_POTION").unwrap());
        std::fs::create_dir_all(dir()).unwrap();
        let tok = std::fs::read(from.join("tokenizer.json")).unwrap();
        let mut h = Sha256::new().unwrap();
        h.update(&tok).unwrap();
        assert_eq!(h.finish_hex().unwrap(), TOKENIZER_SHA);
        std::fs::write(vocab_path(), vocab_from_json(&tok).unwrap()).unwrap();
        let mut h = Sha256::new().unwrap();
        let mut c = Converter::new(std::fs::File::create(rows_path()).unwrap());
        let mut f = std::fs::File::open(from.join("model.safetensors")).unwrap();
        let mut buf = vec![0u8; 1 << 20];
        loop {
            let n = f.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            h.update(&buf[..n]).unwrap();
            c.push(&buf[..n]).unwrap();
        }
        c.finish().unwrap();
        assert_eq!(h.finish_hex().unwrap(), MODEL_SHA);
        assert!(ready());
    }

    /// With the model downloaded on this PC: the pieces of these sentences are
    /// the original tokenizer's (scripts/significato-verifica.py writes the file).
    #[test]
    #[ignore = "needs the model on this PC and EI_TOKENS=<file of «text\\tids» lines>"]
    fn tokens_like_the_original() {
        let file = std::env::var("EI_TOKENS").unwrap();
        let m = model().unwrap();
        let mut wrong = 0;
        let mut total = 0;
        let mut worst = 1f32;
        for line in std::fs::read_to_string(file).unwrap().lines() {
            let mut cols = line.split('\t');
            let (Some(text), Some(ids), vector) = (cols.next(), cols.next(), cols.next()) else { continue };
            let mut plain = String::new();
            let mut chars = text.chars();
            while let Some(c) = chars.next() {
                match (c, c == '\\') {
                    (_, true) => match chars.next() {
                        Some('n') => plain.push('\n'),
                        Some('t') => plain.push('\t'),
                        Some(x) => plain.push(x),
                        None => {}
                    },
                    _ => plain.push(c),
                }
            }
            let text = plain;
            let want: Vec<u32> = ids.split(' ').filter_map(|x| x.parse().ok()).collect();
            let got = m.tokens(&text);
            total += 1;
            if got != want {
                wrong += 1;
                println!("DIVERSO: {text:?}\n  atteso {want:?}\n  avuto  {got:?}");
            }
            // The vector, against the original model's (float, no 8 bits).
            if let Some(vector) = vector.filter(|v| !v.is_empty()) {
                let want: Vec<f32> = vector.split(' ').filter_map(|x| x.parse().ok()).collect();
                let got = m.embed(&text);
                let cos: f32 = want.iter().zip(&got).map(|(a, b)| a * b).sum();
                if cos < 0.99 {
                    println!("VETTORE {cos:.3}: {text:?}");
                }
                worst = worst.min(cos);
            }
        }
        println!("{} su {total} uguali; vettori: coseno peggiore {worst:.4}", total - wrong);
        assert_eq!(wrong, 0);
        assert!(worst > 0.99);
    }

    #[test]
    #[ignore = "needs the model on this PC"]
    fn meaning_on_this_pc() {
        let s = |a: &str, b: &str| {
            let v = embed(&[a.to_string(), b.to_string()]).unwrap();
            v[0].iter().zip(&v[1]).map(|(x, y)| x * y).sum::<f32>()
        };
        let pairs = [
            ("Il computer dell'ufficio non si accende", "Il PC della segreteria è spento"),
            ("Il computer dell'ufficio non si accende", "Previsioni del tempo per domani"),
            ("il NAS del cliente Rossi", "server di Rossi"),
            ("il NAS del cliente Rossi", "ricetta della carbonara"),
            ("fattura di ottobre", "invoice for October"),
        ];
        for (a, b) in pairs {
            println!("{:.2}  {a} | {b}", s(a, b));
        }
        assert!(s(pairs[0].0, pairs[0].1) > s(pairs[1].0, pairs[1].1));
        // Questions against memory lines: the ones that should be found, and not.
        let near = [
            ("come si chiama il server di Bianchi?", "Bianchi ha un NAS Synology DS920+ in ufficio"),
            ("la stampante di Verdi non va", "Verdi: HP LaserJet in rete, IP 192.168.1.50"),
            ("che password ha il wifi dell'ufficio?", "La rete Wi-Fi della sede si chiama Ufficio-5G, chiave in Devolutions"),
            ("quando scade il dominio di Rossi?", "rossi.it rinnovo del dominio a marzo su Aruba"),
            ("backup di stanotte", "Il backup notturno di Veeam parte alle 2:00"),
            ("preventivo switch", "Per i preventivi di rete uso switch Ubiquiti con ricarico del 30%"),
            ("che antivirus usa il cliente?", "Su tutti i PC di Neri c'è ESET Endpoint"),
            ("telefono di Gialli", "Gialli: centralino 3CX, interno 201"),
        ];
        let far = [
            ("come si chiama il server di Bianchi?", "Il backup notturno di Veeam parte alle 2:00"),
            ("la stampante di Verdi non va", "rossi.it rinnovo del dominio a marzo su Aruba"),
            ("che password ha il wifi dell'ufficio?", "Gialli: centralino 3CX, interno 201"),
            ("quando scade il dominio di Rossi?", "Su tutti i PC di Neri c'è ESET Endpoint"),
            ("backup di stanotte", "Verdi: HP LaserJet in rete, IP 192.168.1.50"),
            ("preventivo switch", "La rete Wi-Fi della sede si chiama Ufficio-5G, chiave in Devolutions"),
            ("che antivirus usa il cliente?", "Per i preventivi di rete uso switch Ubiquiti con ricarico del 30%"),
            ("telefono di Gialli", "Bianchi ha un NAS Synology DS920+ in ufficio"),
        ];
        let show = |name: &str, list: &[(&str, &str)]| {
            let mut v: Vec<f32> = list.iter().map(|(a, b)| s(a, b)).collect();
            v.sort_by(f32::total_cmp);
            println!("{name}: {}", v.iter().map(|x| format!("{x:.2}")).collect::<Vec<_>>().join(" "));
        };
        show("vicine", &near);
        show("lontane", &far);
    }
}
