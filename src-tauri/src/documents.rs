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

pub fn tool_read(app: &AppHandle, args: &Value) -> Result<String, String> {
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

pub async fn tool_create(app: &AppHandle, args: &Value) -> Result<String, String> {
    let req = crate::docx::Request {
        template: arg(args, "template").to_string(),
        title: arg(args, "title").to_string(),
        values: values_of(args.get("values")),
        body: args.get("body").and_then(Value::as_str).unwrap_or_default().to_string(),
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
