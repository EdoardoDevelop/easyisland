// The chat's tools for Word and PDF documents (docs/chat.md → Documenti Word e
// PDF): document_read, document_templates, document_template_add,
// document_create, document_pdf. The work is in docx.rs and pdftext.rs; here
// only where files come from and where they go. Writes ask Consenti / Nega
// (they are not in REVERSIBLE) and always make a new file.

use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::AppHandle;

fn arg<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).unwrap_or_default().trim()
}

/// A path, the name of a file in the Vassoio, or a path in the work folder.
fn locate(app: &AppHandle, given: &str) -> Result<PathBuf, String> {
    let given = given.trim().trim_matches('"');
    if given.is_empty() {
        return Err("Manca path: il percorso del documento.".into());
    }
    let p = PathBuf::from(crate::custom::expand_env(given));
    if p.is_absolute() {
        return if p.is_file() { Ok(p) } else { Err(format!("Il file «{given}» non c'è.")) };
    }
    if let Ok(p) = crate::files::inbox_path(given) {
        if p.is_file() {
            return Ok(p);
        }
    }
    if let Some(root) = crate::workdir::root(app) {
        if let Ok(p) = crate::workdir::resolve(&root, given) {
            if p.is_file() {
                return Ok(p);
            }
        }
    }
    Err(format!("Il file «{given}» non c'è: dammi il percorso completo, il nome di un file del Vassoio o un percorso nella cartella di lavoro."))
}

/// A folder given by its path or as a path in the work folder.
fn locate_dir(app: &AppHandle, given: &str) -> Option<PathBuf> {
    let given = given.trim().trim_matches('"');
    if given.is_empty() {
        return None;
    }
    let p = PathBuf::from(crate::custom::expand_env(given));
    if p.is_absolute() {
        return p.is_dir().then_some(p);
    }
    let root = crate::workdir::root(app)?;
    crate::workdir::resolve(&root, given).ok().filter(|p| p.is_dir())
}

/// The documents of a folder and its subfolders (two levels), by path.
fn documents_in(dir: &std::path::Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut todo = vec![(dir.to_path_buf(), 0)];
    while let Some((d, depth)) = todo.pop() {
        let Ok(list) = std::fs::read_dir(&d) else { continue };
        for e in list.flatten() {
            let p = e.path();
            if p.is_dir() {
                if depth < 2 {
                    todo.push((p, depth + 1));
                }
            } else if matches!(p.extension().and_then(|x| x.to_str()).map(str::to_lowercase).as_deref(), Some("pdf" | "docx" | "dotx" | "docm" | "dotm")) {
                out.push(p);
            }
            if out.len() >= 2000 {
                break;
            }
        }
    }
    out.sort_by_key(|p| p.to_string_lossy().to_lowercase());
    out
}

/// Characters of a folder's documents given in one call, and of each one.
const FOLDER_BUDGET: usize = 120_000;
const FOLDER_EACH: usize = 25_000;

/// A whole folder, a page of files at a time: `start` is the first file (0 = the first).
fn read_folder(dir: &std::path::Path, start: usize) -> String {
    let files = documents_in(dir);
    if files.is_empty() {
        return format!("Nella cartella {} non ci sono documenti Word o PDF.", dir.display());
    }
    let mut out = format!("Cartella {}: {} documenti.\n", dir.display(), files.len());
    let mut used = 0;
    let mut next = files.len();
    for (i, p) in files.iter().enumerate().skip(start) {
        if used >= FOLDER_BUDGET {
            next = i;
            break;
        }
        let name = p.strip_prefix(dir).unwrap_or(p).display().to_string();
        let modified = std::fs::metadata(p).ok().and_then(|m| m.modified().ok()).map(|t| chrono_like(t)).unwrap_or_default();
        let text = match crate::docx::text_of_file(p) {
            Some(Ok(t)) => t,
            Some(Err(e)) => format!("[{e}]"),
            None => continue,
        };
        let mut text: String = text.chars().take(FOLDER_EACH).collect();
        if text.chars().count() >= FOLDER_EACH {
            text.push_str("\n[… tagliato: per tutto il testo chiama document_read con il percorso di questo file]");
        }
        used += text.chars().count();
        out.push_str(&format!("\n### {} ({}/{}){modified}\n\n{}\n", name, i + 1, files.len(), text.trim()));
    }
    if next < files.len() {
        out.push_str(&format!("\n[Letti i documenti {}–{} di {}: per i successivi chiama document_read con lo stesso path e start {next}.]", start + 1, next, files.len()));
    }
    out
}

/// " · modificato il 08/11/2026" from a file's time.
fn chrono_like(t: std::time::SystemTime) -> String {
    let Ok(d) = t.duration_since(std::time::UNIX_EPOCH) else { return String::new() };
    let days = (d.as_secs() / 86_400) as i64;
    // Civil date from days since 1970 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!(" · modificato il {day:02}/{month:02}/{year}")
}

pub fn tool_read(app: &AppHandle, args: &Value) -> Result<String, String> {
    if let Some(dir) = locate_dir(app, arg(args, "path")) {
        let start = args.get("start").and_then(Value::as_u64).unwrap_or(0) as usize;
        return Ok(read_folder(&dir, start));
    }
    let path = locate(app, arg(args, "path"))?;
    let text = crate::docx::text_of_file(&path).ok_or("Leggo solo documenti Word (.docx, .dotx) e PDF; gli altri file di testo si leggono con Read.")??;
    Ok(format!("{}\n\n{text}", path.display()))
}

/// Where a new document goes besides the Vassoio: the folder asked for, else the work folder.
fn folder_of(app: &AppHandle, args: &Value) -> String {
    let asked = arg(args, "folder");
    if !asked.is_empty() {
        return asked.to_string();
    }
    crate::workdir::root(app).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
}

fn delivered(app: &AppHandle, file: &crate::files::DroppedFile, folder: &str) -> String {
    crate::moments::emit(app, json!({ "kind": "tray", "name": file.name, "path": file.path, "size": file.size }));
    if folder.is_empty() {
        format!("«{}» è nel Vassoio ({}).", file.name, file.path)
    } else {
        format!("«{}» è nel Vassoio ({}) e in {}.", file.name, file.path, crate::custom::expand_env(folder))
    }
}

fn values_of(v: Option<&Value>) -> HashMap<String, String> {
    let mut out = HashMap::new();
    if let Some(map) = v.and_then(Value::as_object) {
        for (k, v) in map {
            let text = match v {
                Value::String(s) => s.clone(),
                Value::Null => String::new(),
                other => other.to_string(),
            };
            out.insert(k.clone(), text);
        }
    }
    out
}

/// The pictures written in the body as `![…](path)`: files of the Vassoio, of the work folder or paths.
fn pictures_of(app: &AppHandle, body: &str) -> Result<HashMap<String, crate::docx::Picture>, String> {
    let refs = crate::docx::image_refs(body);
    if refs.len() > 40 {
        return Err("Al massimo 40 immagini per documento.".into());
    }
    let mut out = HashMap::new();
    for r in refs {
        let path = locate(app, &r).map_err(|e| format!("Immagine: {e}"))?;
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if size > 25 * 1024 * 1024 {
            return Err(format!("L'immagine «{r}» è troppo grande (oltre 25 MB)."));
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("L'immagine «{r}» non si legge: {e}"))?;
        out.insert(r, crate::docx::Picture { bytes });
    }
    Ok(out)
}

pub async fn tool_create(app: &AppHandle, args: &Value) -> Result<String, String> {
    let body = args.get("body").and_then(Value::as_str).unwrap_or_default().to_string();
    let req = crate::docx::Request {
        template: arg(args, "template").to_string(),
        title: arg(args, "title").to_string(),
        values: values_of(args.get("values")),
        pictures: pictures_of(app, &body)?,
        body,
        lines: crate::docx::lines_of(args.get("rows"))?,
    };
    let made = tauri::async_runtime::spawn_blocking(move || crate::docx::make(&req)).await.map_err(|e| e.to_string())??;
    let name = [arg(args, "filename"), arg(args, "title"), arg(args, "template")].into_iter().find(|s| !s.is_empty()).unwrap_or("documento");
    let base = match crate::custom::safe_name(name, "docx") {
        b if b.is_empty() => "documento".to_string(),
        b => b,
    };
    let folder = folder_of(app, args);
    let file = crate::custom::deliver(&base, "docx", &made.bytes, &folder)?;
    let mut out = vec![delivered(app, &file, &folder)];
    if let Some(n) = &made.number {
        out.push(format!("Numero assegnato: {n}."));
    }
    if let Some(t) = &made.totals {
        let vat: i64 = t.vat.iter().map(|v| v.1).sum();
        out.push(format!("Imponibile {}, IVA {}, totale {} (calcolati da EasyIsland).", crate::docx::money(t.taxable), crate::docx::money(vat), crate::docx::money(t.total)));
    }
    if !made.missing.is_empty() {
        out.push(format!("Segnaposto del modello rimasti vuoti: {}.", made.missing.iter().map(|k| format!("{{{k}}}")).collect::<Vec<_>>().join(", ")));
    }
    if args.get("pdf").and_then(Value::as_bool) == Some(true) {
        let docx = PathBuf::from(&file.path);
        match crate::docx::word_pdf(&docx).await.and_then(|bytes| crate::custom::deliver(&base, "pdf", &bytes, &folder)) {
            Ok(pdf) => out.push(format!("PDF: {}", delivered(app, &pdf, &folder))),
            Err(e) => out.push(format!("PDF non creato: {e} Il .docx c'è.")),
        }
    }
    Ok(out.join(" "))
}

pub async fn tool_pdf(app: &AppHandle, args: &Value) -> Result<String, String> {
    let path = locate(app, arg(args, "path"))?;
    let ext = path.extension().and_then(|e| e.to_str()).map(str::to_lowercase).unwrap_or_default();
    if !matches!(ext.as_str(), "docx" | "dotx" | "docm" | "doc" | "rtf" | "odt") {
        return Err("Solo documenti di Word (.docx, .doc, .rtf, .odt).".into());
    }
    let bytes = crate::docx::word_pdf(&path).await?;
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "documento".into());
    let wanted = arg(args, "filename");
    let base = crate::custom::safe_name(if wanted.is_empty() { &stem } else { wanted }, "pdf");
    let folder = folder_of(app, args);
    let file = crate::custom::deliver(if base.is_empty() { "documento" } else { &base }, "pdf", &bytes, &folder)?;
    Ok(delivered(app, &file, &folder))
}

pub fn tool_template_add(app: &AppHandle, args: &Value) -> Result<String, String> {
    let path = locate(app, arg(args, "path"))?;
    crate::docx::add_template(&path.to_string_lossy(), arg(args, "name"))
}

/// The bytes of a PDF to take pages from: a PDF, or a Word document made PDF by Word.
async fn pdf_bytes(app: &AppHandle, given: &str) -> Result<(PathBuf, Vec<u8>), String> {
    let path = locate(app, given)?;
    let ext = path.extension().and_then(|e| e.to_str()).map(str::to_lowercase).unwrap_or_default();
    let bytes = match ext.as_str() {
        "pdf" => std::fs::read(&path).map_err(|e| format!("«{}» non si legge: {e}", path.display()))?,
        "docx" | "dotx" | "docm" | "doc" | "rtf" | "odt" => crate::docx::word_pdf(&path).await?,
        _ => return Err(format!("«{}» non è un PDF né un documento di Word.", path.display())),
    };
    Ok((path, bytes))
}

fn stem_of(path: &std::path::Path) -> String {
    path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "documento".into())
}

pub async fn tool_pdf_merge(app: &AppHandle, args: &Value) -> Result<String, String> {
    let list = args.get("files").and_then(Value::as_array).cloned().unwrap_or_default();
    if list.is_empty() {
        return Err("Manca files: i PDF (o i Word) da unire, in ordine.".into());
    }
    if list.len() > 100 {
        return Err("Al massimo 100 file per volta.".into());
    }
    let mut sources = Vec::new();
    for item in &list {
        let (path, pages) = match item {
            Value::String(s) => (s.as_str(), ""),
            other => (other.get("path").and_then(Value::as_str).unwrap_or_default(), other.get("pages").and_then(Value::as_str).unwrap_or_default()),
        };
        let (path, bytes) = pdf_bytes(app, path).await?;
        let src = tauri::async_runtime::spawn_blocking(move || crate::pdfpages::Source::read(&bytes)).await.map_err(|e| e.to_string())?.map_err(|e| format!("{}: {e}", path.display()))?;
        let chosen = crate::pdfpages::parse_pages(pages, src.count()).map_err(|e| format!("{}: {e}", path.display()))?;
        sources.push((path, src, chosen));
    }
    let first = sources.first().map(|s| stem_of(&s.0)).unwrap_or_default();
    let pages: usize = sources.iter().map(|s| s.2.len()).sum();
    let summary: Vec<String> = sources.iter().map(|(p, src, c)| format!("{} ({} di {} pagine)", stem_of(p), c.len(), src.count())).collect();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let parts: Vec<(&crate::pdfpages::Source, Vec<usize>)> = sources.iter().map(|(_, s, c)| (s, c.clone())).collect();
        crate::pdfpages::assemble(&parts)
    })
    .await
    .map_err(|e| e.to_string())??;
    let wanted = arg(args, "filename");
    let fallback = if list.len() == 1 { format!("{first} estratto") } else { format!("{first} unito") };
    let base = match crate::custom::safe_name(if wanted.is_empty() { &fallback } else { wanted }, "pdf") {
        b if b.is_empty() => "documento".to_string(),
        b => b,
    };
    let folder = folder_of(app, args);
    let file = crate::custom::deliver(&base, "pdf", &bytes, &folder)?;
    Ok(format!("{} {pages} pagine: {}.", delivered(app, &file, &folder), summary.join(", ")))
}

pub async fn tool_pdf_split(app: &AppHandle, args: &Value) -> Result<String, String> {
    let (path, bytes) = pdf_bytes(app, arg(args, "path")).await?;
    let src = tauri::async_runtime::spawn_blocking(move || crate::pdfpages::Source::read(&bytes)).await.map_err(|e| e.to_string())??;
    let count = src.count();
    let ranges: Vec<String> = match args.get("ranges").and_then(Value::as_array) {
        Some(r) if !r.is_empty() => r.iter().filter_map(|v| v.as_str().map(str::to_string).or_else(|| v.as_u64().map(|n| n.to_string()))).collect(),
        _ => (1..=count).map(|n| n.to_string()).collect(),
    };
    if ranges.len() > 200 {
        return Err(format!("Verrebbero {} file: al massimo 200. Dammi gli intervalli (ranges), es. [\"1-10\", \"11-20\"].", ranges.len()));
    }
    let mut chosen = Vec::new();
    for r in &ranges {
        chosen.push((r.trim().replace(' ', ""), crate::pdfpages::parse_pages(r, count)?));
    }
    let wanted = arg(args, "filename");
    let stem = if wanted.is_empty() { stem_of(&path) } else { wanted.to_string() };
    let folder = folder_of(app, args);
    let src = std::sync::Arc::new(src);
    let mut out = Vec::new();
    for (label, pages) in chosen {
        let s = src.clone();
        let bytes = tauri::async_runtime::spawn_blocking(move || crate::pdfpages::assemble(&[(&*s, pages)])).await.map_err(|e| e.to_string())??;
        let base = match crate::custom::safe_name(&format!("{stem} p{label}"), "pdf") {
            b if b.is_empty() => "documento".to_string(),
            b => b,
        };
        let file = crate::custom::deliver(&base, "pdf", &bytes, &folder)?;
        crate::moments::emit(app, json!({ "kind": "tray", "name": file.name, "path": file.path, "size": file.size }));
        out.push(file.name);
    }
    let where_ = if folder.is_empty() { "nel Vassoio".to_string() } else { format!("nel Vassoio e in {}", crate::custom::expand_env(&folder)) };
    Ok(format!("{} file {where_} (il PDF aveva {count} pagine): {}.", out.len(), out.join(", ")))
}
