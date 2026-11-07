// A local HTML page printed in PDF by WebView2 (integrazioni personali, custom.rs):
// a hidden window opens the page and Page.printToPDF prints it, by the page's own
// @page when it has one, on A4 otherwise. The window is not one of EasyIsland's:
// a file:// page, no capability, no way to the app's commands, and it stays on
// that page.

use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Url, WebviewUrl, WebviewWindowBuilder};

use crate::i18n::{t, tf};

static PRINTS: AtomicU32 = AtomicU32::new(0);
const PRINT_TIMEOUT: Duration = Duration::from_secs(30);

type Answer = Arc<Mutex<Option<tokio::sync::oneshot::Sender<Result<String, String>>>>>;

fn answer(to: &Answer, result: Result<String, String>) {
    if let Some(tx) = to.lock().unwrap().take() {
        let _ = tx.send(result);
    }
}

/// The answer of Page.printToPDF → the PDF's bytes.
fn bytes_of(json: &str) -> Result<Vec<u8>, String> {
    let v: Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let data = v.get("data").and_then(Value::as_str).ok_or(t("WebView2 non ha creato il PDF."))?;
    let bytes = crate::backup::base64_decode(data).ok_or(t("WebView2 non ha creato il PDF."))?;
    if bytes.starts_with(b"%PDF") {
        Ok(bytes)
    } else {
        Err(t("WebView2 non ha creato il PDF.").into())
    }
}

pub async fn print(app: &AppHandle, page: &Path) -> Result<Vec<u8>, String> {
    let url = Url::from_file_path(page).map_err(|_| t("Pagina del PDF non valida."))?;
    let label = format!("custom-pdf-{}", PRINTS.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = tokio::sync::oneshot::channel();
    let to: Answer = Arc::new(Mutex::new(Some(tx)));
    let loaded = to.clone();
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .visible(false)
        .skip_taskbar(true)
        // The same arguments and folder as the other windows: WebView2 refuses a second environment.
        .additional_browser_args(crate::BROWSER_ARGS)
        .on_navigation(|u| u.scheme() == "file")
        .on_page_load(move |w, p| {
            if p.event() != PageLoadEvent::Finished {
                return;
            }
            let to = loaded.clone();
            let failed = to.clone();
            let ran = w.with_webview(move |pw| {
                let core = match unsafe { pw.controller().CoreWebView2() } {
                    Ok(core) => core,
                    Err(e) => return answer(&to, Err(e.to_string())),
                };
                // Letter is WebView2's own default; A4 unless the page's @page says otherwise.
                let params = json!({ "printBackground": true, "preferCSSPageSize": true, "paperWidth": 8.27, "paperHeight": 11.69 });
                crate::preview::cdp(&core, "Page.printToPDF", &params, move |r| answer(&to, r));
            });
            if let Err(e) = ran {
                answer(&failed, Err(e.to_string()));
            }
        });
    if let Some(dir) = crate::webview_dir() {
        builder = builder.data_directory(dir);
    }
    let window = builder.build().map_err(|e| tf("Finestra del PDF non creata: {e}", &[("e", &e.to_string())]))?;
    let printed = tokio::time::timeout(PRINT_TIMEOUT, rx).await;
    let _ = window.destroy();
    match printed {
        Ok(Ok(Ok(json))) => bytes_of(&json),
        Ok(Ok(Err(e))) => Err(tf("PDF non creato: {e}", &[("e", &e)])),
        Ok(Err(_)) => Err(t("WebView2 non ha creato il PDF.").into()),
        Err(_) => Err(t("Il PDF ci mette troppo: riprova.").into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// With a real WebView2, by hand: `cargo test --lib pdf::tests::real_print -- --ignored --nocapture`.
    /// Its own profile, so it works with EasyIsland open. Exit code 0 = PDF written in %TEMP%.
    #[test]
    #[ignore]
    fn real_print() {
        let dir = std::env::temp_dir().join("easyisland-prova-pdf");
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir.join("profilo"));
        let page = dir.join("pagina.html");
        std::fs::write(&page, "<!doctype html><meta charset=utf-8><style>@page{size:A4;margin:12mm}h1{color:#fff;background:#e8590c}</style><h1>Documento di trasporto</h1><p>Città: Amelia (TR) è perché</p>").unwrap();
        let app = tauri::Builder::default().any_thread().build(tauri::generate_context!()).unwrap();
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            let out = print(&handle, &page).await;
            match &out {
                Ok(bytes) => {
                    std::fs::write(dir.join("prova.pdf"), bytes).unwrap();
                    println!("PDF di {} byte in {}", bytes.len(), dir.display());
                }
                Err(e) => println!("PDF non creato: {e}"),
            }
            handle.exit(if out.is_ok() { 0 } else { 1 });
        });
        app.run(|_, _| {});
    }

    #[test]
    fn only_a_real_pdf_is_accepted() {
        let good = format!("{{\"data\":\"{}\"}}", crate::claude::base64_for(b"%PDF-1.7 x"));
        assert_eq!(bytes_of(&good).unwrap(), b"%PDF-1.7 x");
        let html = format!("{{\"data\":\"{}\"}}", crate::claude::base64_for(b"<html>"));
        assert!(bytes_of(&html).is_err());
        assert!(bytes_of("{}").is_err());
        assert!(bytes_of("niente").is_err());
    }
}
