// «Anteprima» (preview.rs): what WebView2 gives natively for a tab's page,
// asked by Edoardo on 21 Nov 2026 next to the verified click and the uploads.
//
// - Frames of another site (a map, a payment form, a router's console in a
//   frame of its own address): the page's scripts cannot read them, WebView2
//   can (ICoreWebView2Frame2::ExecuteScript). Each tab's frames are kept here
//   as WebView2 creates them, numbered x1, x2…: the prefix of their refs
//   (x2e5), the same scripts of preview.rs run inside them.
// - The page's own dialogs: alert, confirm, prompt and «leave the page?».
//   WebView2's default ones are off (a dialog from a page nobody looks at
//   stopped every script and every tool). An alert is closed with OK and told
//   to the chat; the others become a card in the island: OK or Annulla is
//   the user's, never the engine's; no answer in two minutes = Annulla.
// - COM objects live on the main thread (thread_local), where WebView2 calls
//   back; the tools reach them with run_on_main_thread.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Webview};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2Deferral, ICoreWebView2Frame, ICoreWebView2Frame2, ICoreWebView2Frame7,
    ICoreWebView2ScriptDialogOpeningEventArgs, ICoreWebView2_4, COREWEBVIEW2_SCRIPT_DIALOG_KIND,
    COREWEBVIEW2_SCRIPT_DIALOG_KIND_ALERT, COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD, COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT,
};
use webview2_com::{
    ExecuteScriptCompletedHandler, FrameChildFrameCreatedEventHandler, FrameCreatedEventHandler, FrameDestroyedEventHandler,
    ScriptDialogOpeningEventHandler,
};
use windows_core_wv2::{Interface, BOOL, HSTRING, PWSTR};

use crate::i18n::{t, tf};

/// Frames kept per tab, at most (a page full of ad frames).
const MAX_FRAMES: usize = 30;
/// How long a site's question waits for the user.
const ASK_FOR: Duration = Duration::from_secs(120);

#[derive(Default)]
struct Frames {
    next: u32,
    list: Vec<(u32, ICoreWebView2Frame2)>,
}

thread_local! {
    static FRAMES: RefCell<HashMap<u32, Frames>> = RefCell::new(HashMap::new());
    /// Dialogs waiting for the card: their event's arguments and deferral.
    static WAITING: RefCell<HashMap<u64, (ICoreWebView2ScriptDialogOpeningEventArgs, ICoreWebView2Deferral)>> = RefCell::new(HashMap::new());
}

/// Hooks a tab's new browser: its frames and its dialogs.
pub fn install(w: &Webview, id: u32) {
    let _ = w.with_webview(move |pw| unsafe {
        let Ok(core) = pw.controller().CoreWebView2() else { return };
        FRAMES.with(|m| m.borrow_mut().remove(&id));
        watch_frames(&core, id);
        watch_dialogs(&core, id);
    });
}

/// The tab's browser closed: its frames go.
pub fn forget(app: &AppHandle, id: u32) {
    let _ = app.run_on_main_thread(move || FRAMES.with(|m| drop(m.borrow_mut().remove(&id))));
    DIALOGS.lock().unwrap_or_else(|e| e.into_inner()).retain(|d| d.tab != id);
}

// ── Frames ───────────────────────────────────────────────────────────────────

unsafe fn watch_frames(core: &ICoreWebView2, id: u32) {
    let Ok(core4) = core.cast::<ICoreWebView2_4>() else { return };
    let handler = FrameCreatedEventHandler::create(Box::new(move |_, args| {
        if let Some(frame) = args.and_then(|a| unsafe { a.Frame() }.ok()) {
            unsafe { add_frame(id, frame) };
        }
        Ok(())
    }));
    let mut token = 0i64;
    let _ = core4.add_FrameCreated(&handler, &mut token);
}

/// A frame of the tab, and the frames inside it (WebView2 tells only the
/// page's own frames to the browser; the others come from their frame).
unsafe fn add_frame(id: u32, frame: ICoreWebView2Frame) {
    let Ok(f2) = frame.cast::<ICoreWebView2Frame2>() else { return };
    let n = FRAMES.with(|m| {
        let mut m = m.borrow_mut();
        let e = m.entry(id).or_default();
        e.next += 1;
        e.list.push((e.next, f2));
        if e.list.len() > MAX_FRAMES {
            e.list.remove(0);
        }
        e.next
    });
    let gone = FrameDestroyedEventHandler::create(Box::new(move |_, _| {
        FRAMES.with(|m| {
            if let Some(e) = m.borrow_mut().get_mut(&id) {
                e.list.retain(|(k, _)| *k != n);
            }
        });
        Ok(())
    }));
    let mut token = 0i64;
    let _ = frame.add_Destroyed(&gone, &mut token);
    if let Ok(f7) = frame.cast::<ICoreWebView2Frame7>() {
        let child = FrameChildFrameCreatedEventHandler::create(Box::new(move |_, args| {
            if let Some(inner) = args.and_then(|a| unsafe { a.Frame() }.ok()) {
                unsafe { add_frame(id, inner) };
            }
            Ok(())
        }));
        let _ = f7.add_FrameCreated(&child, &mut token);
    }
}

/// `script(n)` in the tab's frames (`only`: just that one), each answer as
/// JSON text by frame number; null ones and frames that do not answer in
/// time are left out.
pub async fn eval_frames(app: &AppHandle, id: u32, only: Option<u32>, script: impl Fn(u32) -> String + Send + 'static) -> Vec<(u32, String)> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Option<(u32, String)>>();
    let sent = app.run_on_main_thread(move || {
        let frames: Vec<(u32, ICoreWebView2Frame2)> = FRAMES.with(|m| {
            m.borrow().get(&id).map(|e| e.list.iter().filter(|(n, _)| only.is_none_or(|o| o == *n)).cloned().collect()).unwrap_or_default()
        });
        let mut asked = 0;
        for (n, frame) in frames {
            let mut dead = BOOL::default();
            if unsafe { frame.IsDestroyed(&mut dead) }.is_err() || dead.as_bool() {
                continue;
            }
            let tx = tx.clone();
            let handler = ExecuteScriptCompletedHandler::create(Box::new(move |hr, json| {
                let _ = tx.send(hr.ok().map(|_| (n, json)));
                Ok(())
            }));
            if unsafe { frame.ExecuteScript(&HSTRING::from(script(n).as_str()), &handler) }.is_ok() {
                asked += 1;
            }
        }
        // How many answers to wait for, as the first message.
        let _ = tx.send(Some((u32::MAX, asked.to_string())));
    });
    if sent.is_err() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut expected: Option<usize> = None;
    let mut got = 0;
    let until = tokio::time::Instant::now() + Duration::from_secs(8);
    while expected.is_none_or(|e| got < e) {
        match tokio::time::timeout_at(until, rx.recv()).await {
            Ok(Some(Some((u32::MAX, n)))) => expected = Some(n.parse().unwrap_or(0)),
            Ok(Some(answer)) => {
                got += 1;
                if let Some(a) = answer.filter(|(_, j)| j != "null") {
                    out.push(a);
                }
            }
            _ => break,
        }
    }
    out.sort_by_key(|(n, _)| *n);
    out
}

/// The frame number of a ref of a frame of another site ("x2e5" → 2).
pub fn frame_of_ref(r: &str) -> Option<u32> {
    let rest = r.trim().strip_prefix('x')?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

// ── Dialogs ──────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct Dialog {
    pub tab: u32,
    seq: u64,
    /// "alert", "confirm", "prompt" or "leave".
    pub kind: &'static str,
    pub message: String,
    pub site: String,
    /// None while the card waits; then OK (true) or Annulla (false).
    pub answer: Option<bool>,
    /// Already told to the chat.
    told: bool,
}

static DIALOGS: Mutex<Vec<Dialog>> = Mutex::new(Vec::new());
static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

unsafe fn watch_dialogs(core: &ICoreWebView2, id: u32) {
    if let Ok(settings) = core.Settings() {
        let _ = settings.SetAreDefaultScriptDialogsEnabled(false);
    }
    let handler = ScriptDialogOpeningEventHandler::create(Box::new(move |_, args| {
        let Some(args) = args else { return Ok(()) };
        unsafe { opened(id, args) };
        Ok(())
    }));
    let mut token = 0i64;
    let _ = core.add_ScriptDialogOpening(&handler, &mut token);
}

unsafe fn opened(id: u32, args: ICoreWebView2ScriptDialogOpeningEventArgs) {
    let text = |get: &dyn Fn(*mut PWSTR) -> windows_core_wv2::Result<()>| {
        let mut raw = PWSTR::null();
        if get(&mut raw).is_ok() {
            webview2_com::take_pwstr(raw)
        } else {
            String::new()
        }
    };
    let mut kind = COREWEBVIEW2_SCRIPT_DIALOG_KIND::default();
    let _ = args.Kind(&mut kind);
    let message: String = text(&|p| unsafe { args.Message(p) }).chars().take(600).collect();
    let uri = text(&|p| unsafe { args.Uri(p) });
    let site = crate::preview::host_of(&uri).unwrap_or_default();
    let kind = match kind {
        COREWEBVIEW2_SCRIPT_DIALOG_KIND_ALERT => "alert",
        COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT => "prompt",
        COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD => "leave",
        _ => "confirm",
    };
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut d = Dialog { tab: id, seq, kind, message, site, answer: None, told: false };
    if kind == "alert" {
        let _ = args.Accept();
        d.answer = Some(true);
        crate::log::line(format!("anteprima: avviso del sito chiuso con OK ({})", d.site));
        // The user looking at the Anteprima reads it in the island.
        if let Some(app) = crate::preview::app().filter(crate::preview::is_open) {
            use tauri::Emitter;
            let _ = app.emit_to(crate::island::WINDOW_LABEL, "hook", serde_json::json!({
                "hook_event_name": "EasyIslandNotify",
                "title": tf("{site} dice", &[("site", &d.site)]),
                "text": d.message.clone(),
                "level": "info",
                "url": "",
            }));
        }
        keep(d);
        return;
    }
    let Ok(deferral) = args.GetDeferral() else { return };
    WAITING.with(|m| m.borrow_mut().insert(seq, (args, deferral)));
    keep(d.clone());
    let Some(app) = crate::preview::app() else { return };
    tauri::async_runtime::spawn(async move { ask(app, d).await });
}

fn keep(d: Dialog) {
    let mut all = DIALOGS.lock().unwrap_or_else(|e| e.into_inner());
    all.push(d);
    if all.len() > 40 {
        all.remove(0);
    }
}

/// The card: OK or Annulla, by the user.
async fn ask(app: AppHandle, d: Dialog) {
    let title = match d.kind {
        "leave" => t("Il sito chiede se lasciare la pagina"),
        "prompt" => t("Il sito chiede un valore"),
        _ => t("Il sito chiede una conferma"),
    };
    let message = if d.kind == "leave" && d.message.trim().is_empty() { t("Le modifiche non salvate si perdono.").to_string() } else { d.message.clone() };
    let text = tf("{site} (Anteprima): «{m}»", &[("site", &d.site), ("m", &message)]);
    let (ok, no) = (t("OK").to_string(), t("Annulla").to_string());
    let answer = crate::moments::ask_card(&app, title, &text, "warn", vec![ok.clone(), no], ASK_FOR).await;
    let yes = matches!(answer, Some(crate::moments::CardAnswer::Chose(ref c)) if *c == ok);
    crate::log::line(format!("anteprima: domanda del sito ({}) {} ({})", d.kind, if yes { "OK" } else { "Annulla" }, d.site));
    {
        let mut all = DIALOGS.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(x) = all.iter_mut().find(|x| x.seq == d.seq) {
            x.answer = Some(yes);
        }
    }
    let seq = d.seq;
    let _ = app.run_on_main_thread(move || {
        if let Some((args, deferral)) = WAITING.with(|m| m.borrow_mut().remove(&seq)) {
            unsafe {
                if yes {
                    // A prompt keeps the value the page suggested.
                    let mut raw = PWSTR::null();
                    if args.DefaultText(&mut raw).is_ok() {
                        let _ = args.SetResultText(&HSTRING::from(webview2_com::take_pwstr(raw)));
                    }
                    let _ = args.Accept();
                }
                let _ = deferral.Complete();
            }
        }
    });
}

/// A question of the tab's page still waiting for the user.
pub fn waiting(id: u32) -> Option<Dialog> {
    DIALOGS.lock().unwrap_or_else(|e| e.into_inner()).iter().find(|d| d.tab == id && d.answer.is_none()).cloned()
}

/// What the page asked or said since the chat last heard, once each: lines
/// for the next answer of a preview tool.
pub fn news() -> Vec<String> {
    let mut all = DIALOGS.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = Vec::new();
    for d in all.iter_mut().filter(|d| !d.told && d.answer.is_some()) {
        d.told = true;
        out.push(describe(d));
    }
    out
}

/// One dialog in words, for the chat.
pub fn describe(d: &Dialog) -> String {
    let tab = d.tab.to_string();
    let args: [(&str, &dyn std::fmt::Display); 2] = [("tab", &tab), ("m", &d.message)];
    match (d.kind, d.answer) {
        ("alert", _) => tf("[Scheda {tab}: la pagina ha mostrato un avviso, chiuso con OK: «{m}»]", &args),
        (_, None) => tf("[Scheda {tab}: la pagina chiede conferma: «{m}». La scelta è dell'utente, nella card dell'isola (OK / Annulla): aspetta e poi guarda di nuovo la pagina; non insistere.]", &args),
        (_, Some(true)) => tf("[Scheda {tab}: alla domanda della pagina «{m}» l'utente ha risposto OK.]", &args),
        (_, Some(false)) => tf("[Scheda {tab}: alla domanda della pagina «{m}» l'utente ha risposto Annulla (o non ha risposto).]", &args),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refs_of_other_site_frames() {
        assert_eq!(frame_of_ref("x2e5"), Some(2));
        assert_eq!(frame_of_ref("x12f1e3"), Some(12));
        assert_eq!(frame_of_ref("e5"), None);
        assert_eq!(frame_of_ref("f1e5"), None);
        assert_eq!(frame_of_ref("x"), None);
    }

    #[test]
    fn dialogs_told_once() {
        keep(Dialog { tab: 900, seq: 9_000_001, kind: "alert", message: "Salvato".into(), site: "a.it".into(), answer: Some(true), told: false });
        let first = news();
        assert!(first.iter().any(|l| l.contains("Salvato")));
        assert!(!news().iter().any(|l| l.contains("Salvato")));
        keep(Dialog { tab: 901, seq: 9_000_002, kind: "confirm", message: "Eliminare?".into(), site: "a.it".into(), answer: None, told: false });
        assert!(waiting(901).is_some());
        assert!(!news().iter().any(|l| l.contains("Eliminare?")));
    }
}
