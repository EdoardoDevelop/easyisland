// Files dropped on the island.
//
// Recent WebView2 runtimes host the page's input window in their own process,
// and that window carries WebView2's drop target. Tauri's own drop target (wry)
// sits on a parent window that OLE never reaches, so a drop with Tauri's
// `dragDropEnabled` was always refused. Instead the page takes the drop as an
// ordinary HTML5 drop and hands the `File` objects back with
// `chrome.webview.postMessageWithAdditionalObjects`; WebView2 turns them into
// ICoreWebView2File here, which carries the real path on disk.

use tauri::{AppHandle, Emitter};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2,
};
use webview2_com::WebMessageReceivedEventHandler;
use windows_core_wv2::{Interface, PWSTR};

use crate::island::{self, WINDOW_LABEL};

/// Listens for dropped files on the island and emits `file-drop` with their paths.
pub fn install(app: &AppHandle) {
    let Some(win) = island::window(app) else { return };
    let handle = app.clone();
    let _ = win.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            crate::log::line("drop: no CoreWebView2".to_string());
            return;
        };
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let paths = args.map(|a| dropped_paths(&a)).unwrap_or_default();
            if !paths.is_empty() {
                let _ = handle.emit_to(WINDOW_LABEL, "file-drop", paths);
            }
            Ok(())
        }));
        let mut token = 0i64;
        if let Err(err) = core.add_WebMessageReceived(&handler, &mut token) {
            crate::log::line(format!("drop: could not listen for files: {err}"));
        }
    });
}

/// Paths of the files attached to a web message; empty for any other message
/// (Tauri's own IPC goes through the same channel without attachments).
unsafe fn dropped_paths(
    args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebMessageReceivedEventArgs,
) -> Vec<String> {
    let Ok(args) = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>() else { return Vec::new() };
    let Ok(objects) = (unsafe { args.AdditionalObjects() }) else { return Vec::new() };
    let mut count = 0u32;
    if unsafe { objects.Count(&mut count) }.is_err() {
        return Vec::new();
    }
    let mut paths = Vec::new();
    for i in 0..count {
        let Ok(obj) = (unsafe { objects.GetValueAtIndex(i) }) else { continue };
        let Ok(file) = obj.cast::<ICoreWebView2File>() else { continue };
        let mut path = PWSTR::null();
        if unsafe { file.Path(&mut path) }.is_ok() && !path.is_null() {
            paths.push(webview2_com::take_pwstr(path));
        }
    }
    paths
}
