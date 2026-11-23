// winapps.rs — the Windows programs for the chat (asked by Edoardo on 21 Nov 2026, from an
// agent's desktop tool he pointed at): a window read as its accessibility
// tree (UI Automation, what screen readers use), each control with a ref,
// and clicks and typing by ref. No screenshots, no mouse, no keyboard: the
// actions go through the control's own patterns (Invoke, Toggle, Select,
// Expand, Value), so the user's pointer and focus are never touched.
//
// - Reading (desktop_windows, desktop_snapshot, desktop_find) passes without
//   a card, like reading a page of the Anteprima; nothing of the windows of
//   NO_TOUCH (sign-in, UAC, password managers) is ever read.
// - Acting (desktop_click, desktop_type) asks Consenti / Nega every time,
//   also in «Automatica» (permits::delicate_tool); «Sempre» = that program
//   for the conversation. Never: password fields, controls that send,
//   delete, pay or buy (BLOCKED_WORDS), terminals and the system's tools
//   (NO_ACT): a command typed there would be a command run.
// - UI Automation runs on a thread of its own (COM, multithreaded); a program
//   that hangs it gets a new thread, the old one is left behind.
// - Refs (d1, d2…) are the same for the same control (its RuntimeId) while
//   the chat stays on that window; another window starts again.

use std::collections::HashMap;
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use serde_json::Value;
use windows::core::BSTR;
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
use windows::Win32::System::Ole::{SafeArrayDestroy, SafeArrayGetElement, SafeArrayGetLBound, SafeArrayGetUBound};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Accessibility::*;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowLongPtrW, GetWindowTextW, IsIconic, IsWindow, IsWindowVisible, GWL_EXSTYLE,
    WS_EX_TOOLWINDOW,
};

use crate::i18n::{t, tf};

/// Lines of a window's tree, at most.
const MAX_LINES: usize = 600;
/// How deep the tree is read.
const MAX_DEPTH: usize = 30;
/// A program's answer, at most.
const WAIT: Duration = Duration::from_secs(20);

/// Programs never read nor touched: sign-in, elevation, password managers.
const NO_TOUCH: &[&str] = &[
    "consent.exe", "credentialuibroker.exe", "logonui.exe", "lockapp.exe", "keepass.exe", "keepassxc.exe", "1password.exe",
    "bitwarden.exe", "dashlane.exe", "easyisland.exe",
];
/// Programs read but never acted on: a command typed there runs, a setting
/// changed there changes the system.
const NO_ACT: &[&str] = &[
    "cmd.exe", "powershell.exe", "pwsh.exe", "windowsterminal.exe", "wt.exe", "openconsole.exe", "conhost.exe", "mintty.exe",
    "putty.exe", "regedit.exe", "mmc.exe", "taskmgr.exe", "systemsettings.exe", "securityhealthui.exe", "sechealthui.exe",
    "msconfig.exe", "control.exe", "rundll32.exe", "remotedesktopmanager.exe", "mstsc.exe",
];
/// Controls the user clicks, never EasyIsland (whole words of their name).
const BLOCKED_WORDS: &[&str] = &[
    "invia", "send", "inoltra", "forward", "pubblica", "publish", "condividi", "share", "paga", "pay", "pagamento", "payment",
    "acquista", "buy", "compra", "ordina", "order", "checkout", "elimina", "delete", "rimuovi", "remove", "cancella", "svuota",
    "empty", "formatta", "format", "disinstalla", "uninstall", "reimposta", "reset", "ripristina", "restore", "firma", "sign",
];

// ── The UI Automation thread ─────────────────────────────────────────────────

type Job = Box<dyn FnOnce(&mut Uia) + Send>;

struct Uia {
    uia: IUIAutomation,
    /// The window the refs are of.
    window: isize,
    exe: String,
    next: u32,
    /// RuntimeId → ref, and ref → element.
    keys: HashMap<String, String>,
    refs: HashMap<String, IUIAutomationElement>,
    /// The last tree the chat saw of the window, for what changed.
    last: String,
}

static WORKER: Mutex<Option<mpsc::Sender<Job>>> = Mutex::new(None);

fn worker() -> Result<mpsc::Sender<Job>, String> {
    let mut w = WORKER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(tx) = w.as_ref() {
        return Ok(tx.clone());
    }
    let (tx, rx) = mpsc::channel::<Job>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    std::thread::spawn(move || unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let uia: IUIAutomation = match CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
            Ok(u) => u,
            Err(e) => {
                let _ = ready_tx.send(Err(e.to_string()));
                return;
            }
        };
        let _ = ready_tx.send(Ok(()));
        let mut state = Uia { uia, window: 0, exe: String::new(), next: 0, keys: HashMap::new(), refs: HashMap::new(), last: String::new() };
        while let Ok(job) = rx.recv() {
            job(&mut state);
        }
    });
    ready_rx.recv_timeout(Duration::from_secs(5)).map_err(|_| t("UI Automation non risponde.").to_string())??;
    *w = Some(tx.clone());
    Ok(tx)
}

/// `f` on the UI Automation thread, its answer; a program that does not
/// answer in WAIT leaves that thread behind (the next call gets a new one).
async fn on_uia<T: Send + 'static>(f: impl FnOnce(&mut Uia) -> T + Send + 'static) -> Result<T, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    worker()?.send(Box::new(move |u: &mut Uia| {
        let _ = tx.send(f(u));
    })).map_err(|_| t("UI Automation non risponde.").to_string())?;
    match tokio::time::timeout(WAIT, rx).await {
        Ok(Ok(v)) => Ok(v),
        _ => {
            *WORKER.lock().unwrap_or_else(|e| e.into_inner()) = None;
            Err(t("Il programma non risponde (forse ha aperto una sua finestra): guarda le finestre con desktop_windows.").into())
        }
    }
}

/// The program of each ref given to the chat, for «Sempre» on it (permits.rs).
static REF_APP: Mutex<Option<(String, Vec<String>)>> = Mutex::new(None);

/// The program a ref of the last tree belongs to ("outlook.exe").
pub fn app_of_ref(r: &str) -> Option<String> {
    let g = REF_APP.lock().unwrap_or_else(|e| e.into_inner());
    let (exe, refs) = g.as_ref()?;
    refs.iter().any(|x| x == r.trim()).then(|| exe.clone())
}

// ── Windows ──────────────────────────────────────────────────────────────────

struct Win {
    hwnd: isize,
    exe: String,
    title: String,
}

fn title_of(hwnd: HWND) -> String {
    let mut buf = [0u16; 512];
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
    String::from_utf16_lossy(buf.get(..n.max(0) as usize).unwrap_or(&[]))
}

/// The visible windows with a title, in front first; not ours, not NO_TOUCH.
fn windows_now() -> Vec<Win> {
    unsafe extern "system" fn each(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
        let out = &mut *(lparam.0 as *mut Vec<HWND>);
        if IsWindowVisible(hwnd).as_bool() && GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW.0 as isize == 0 {
            out.push(hwnd);
        }
        windows::core::BOOL(1)
    }
    let mut all: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&mut all as *mut Vec<HWND> as isize));
    }
    all.into_iter()
        .filter_map(|h| {
            let title = title_of(h);
            if title.trim().is_empty() || crate::context::is_ours(h) || cloaked(h) {
                return None;
            }
            let exe = crate::context::exe_of(h)?;
            (!NO_TOUCH.contains(&exe.as_str())).then_some(Win { hwnd: h.0 as isize, exe, title })
        })
        .take(40)
        .collect()
}

fn cloaked(hwnd: HWND) -> bool {
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    let mut value = 0u32;
    unsafe { DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut value as *mut u32 as *mut core::ffi::c_void, 4).is_ok() && value != 0 }
}

/// The window the chat means: "" = the user's (in front, or the last before
/// the island), "w123" = that one, else the first whose title or program has it.
fn window_of(arg: &str) -> Result<Win, String> {
    let a = arg.trim();
    let pick = |h: HWND| -> Result<Win, String> {
        if !unsafe { IsWindow(Some(h)) }.as_bool() {
            return Err(t("Quella finestra non c'è più: guarda le finestre con desktop_windows.").into());
        }
        let exe = crate::context::exe_of(h).unwrap_or_default();
        if NO_TOUCH.contains(&exe.as_str()) || crate::context::is_ours(h) {
            return Err(t("Questa finestra EasyIsland non la legge (accessi, password, EasyIsland stesso).").into());
        }
        Ok(Win { hwnd: h.0 as isize, exe, title: title_of(h) })
    };
    if a.is_empty() {
        let h = crate::context::target().ok_or_else(|| t("Nessuna finestra in primo piano.").to_string())?;
        return pick(h);
    }
    if let Some(n) = a.strip_prefix('w').and_then(|n| n.parse::<isize>().ok()) {
        return pick(HWND(n as *mut _));
    }
    let low = a.to_lowercase();
    windows_now()
        .into_iter()
        .find(|w| w.title.to_lowercase().contains(&low) || w.exe.trim_end_matches(".exe") == low.trim_end_matches(".exe"))
        .ok_or_else(|| tf("Nessuna finestra con «{a}»: guarda le finestre con desktop_windows.", &[("a", &a)]))
}

// ── The tree ─────────────────────────────────────────────────────────────────

fn role(ct: UIA_CONTROLTYPE_ID) -> &'static str {
    match ct.0 {
        50000 => "button",
        50001 => "calendar",
        50002 => "checkbox",
        50003 => "combobox",
        50004 => "textbox",
        50005 => "link",
        50006 => "img",
        50007 => "listitem",
        50008 => "list",
        50009 => "menu",
        50010 => "menubar",
        50011 => "menuitem",
        50012 => "progressbar",
        50013 => "radio",
        50015 => "slider",
        50016 => "spinner",
        50017 => "statusbar",
        50018 => "tablist",
        50019 => "tab",
        50020 => "text",
        50021 => "toolbar",
        50023 => "tree",
        50024 => "treeitem",
        50026 => "group",
        50028 => "grid",
        50029 => "row",
        50030 => "document",
        50031 => "splitbutton",
        50032 => "window",
        50034 => "header",
        50035 => "columnheader",
        50036 => "table",
        50040 => "appbar",
        _ => "",
    }
}

/// Skipped with what is inside: scroll bars, title bars, separators, tooltips.
fn skipped(ct: UIA_CONTROLTYPE_ID) -> bool {
    matches!(ct.0, 50014 | 50022 | 50027 | 50037 | 50038)
}

unsafe fn cache_request(uia: &IUIAutomation) -> Option<IUIAutomationCacheRequest> {
    let c = uia.CreateCacheRequest().ok()?;
    for p in [
        UIA_NamePropertyId, UIA_ControlTypePropertyId, UIA_IsEnabledPropertyId, UIA_IsOffscreenPropertyId, UIA_IsPasswordPropertyId,
        UIA_ValueValuePropertyId, UIA_ValueIsReadOnlyPropertyId, UIA_ToggleToggleStatePropertyId,
        UIA_ExpandCollapseExpandCollapseStatePropertyId, UIA_SelectionItemIsSelectedPropertyId, UIA_IsInvokePatternAvailablePropertyId,
        UIA_IsTogglePatternAvailablePropertyId, UIA_IsSelectionItemPatternAvailablePropertyId,
        UIA_IsExpandCollapsePatternAvailablePropertyId, UIA_IsValuePatternAvailablePropertyId,
    ] {
        let _ = c.AddProperty(p);
    }
    let _ = c.SetTreeFilter(&uia.ControlViewCondition().ok()?);
    Some(c)
}

fn cached_bool(el: &IUIAutomationElement, p: UIA_PROPERTY_ID) -> bool {
    unsafe { el.GetCachedPropertyValue(p) }.ok().and_then(|v| bool::try_from(&v).ok()).unwrap_or(false)
}

fn cached_i32(el: &IUIAutomationElement, p: UIA_PROPERTY_ID) -> Option<i32> {
    unsafe { el.GetCachedPropertyValue(p) }.ok().and_then(|v| i32::try_from(&v).ok())
}

fn cached_text(el: &IUIAutomationElement, p: UIA_PROPERTY_ID) -> String {
    unsafe { el.GetCachedPropertyValue(p) }.ok().and_then(|v: VARIANT| BSTR::try_from(&v).ok()).map(|b| b.to_string()).unwrap_or_default()
}

/// The control's RuntimeId as text: the same control gives the same one.
unsafe fn runtime_key(el: &IUIAutomationElement) -> Option<String> {
    let arr = el.GetRuntimeId().ok()?;
    if arr.is_null() {
        return None;
    }
    let lo = SafeArrayGetLBound(arr, 1).ok();
    let hi = SafeArrayGetUBound(arr, 1).ok();
    let mut parts = Vec::new();
    if let (Some(lo), Some(hi)) = (lo, hi) {
        for i in lo..=hi.min(lo + 16) {
            let mut v = 0i32;
            if SafeArrayGetElement(arr, &i, &mut v as *mut i32 as *mut core::ffi::c_void).is_ok() {
                parts.push(v.to_string());
            }
        }
    }
    let _ = SafeArrayDestroy(arr);
    (!parts.is_empty()).then(|| parts.join("."))
}

fn clip(s: &str, n: usize) -> String {
    let s: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() > n {
        format!("{}…", s.chars().take(n).collect::<String>())
    } else {
        s
    }
}

impl Uia {
    /// The refs are of `w` from now on (another window: they start again).
    fn on_window(&mut self, w: &Win) {
        if self.window != w.hwnd {
            self.window = w.hwnd;
            self.exe = w.exe.clone();
            self.next = 0;
            self.keys.clear();
            self.refs.clear();
            self.last.clear();
        }
    }

    fn ref_of(&mut self, el: &IUIAutomationElement) -> String {
        let key = unsafe { runtime_key(el) };
        if let Some(r) = key.as_ref().and_then(|k| self.keys.get(k)) {
            self.refs.insert(r.clone(), el.clone());
            return r.clone();
        }
        self.next += 1;
        let r = format!("d{}", self.next);
        if let Some(k) = key {
            self.keys.insert(k, r.clone());
        }
        self.refs.insert(r.clone(), el.clone());
        r
    }

    /// The window's tree, one line per control or text, indented; with
    /// `want`, only the controls and texts with all those words.
    unsafe fn tree(&mut self, w: &Win, want: &[String]) -> Result<String, String> {
        self.on_window(w);
        let root = self.uia.ElementFromHandle(HWND(w.hwnd as *mut _)).map_err(|e| e.to_string())?;
        let cache = cache_request(&self.uia).ok_or_else(|| t("UI Automation non risponde.").to_string())?;
        let cond = self.uia.ControlViewCondition().map_err(|e| e.to_string())?;
        let mut lines = Vec::new();
        let mut hidden = 0usize;
        self.walk(&root, &cond, &cache, 0, want, &mut lines, &mut hidden);
        if lines.len() >= MAX_LINES {
            lines.push(t("… (finestra grande: tagliata; usa desktop_find)").to_string());
        }
        let mut out = format!("{} — {} [w{}]\n", w.title, w.exe, w.hwnd);
        if hidden > 0 && want.is_empty() {
            out.push_str(&tf("({n} elementi fuori dalla vista non elencati)\n", &[("n", &hidden)]));
        }
        out.push('\n');
        out.push_str(&lines.join("\n"));
        let exe = self.exe.clone();
        *REF_APP.lock().unwrap_or_else(|e| e.into_inner()) = Some((exe, self.refs.keys().cloned().collect()));
        Ok(out)
    }

    #[allow(clippy::too_many_arguments)]
    unsafe fn walk(&mut self, parent: &IUIAutomationElement, cond: &IUIAutomationCondition, cache: &IUIAutomationCacheRequest, depth: usize, want: &[String], lines: &mut Vec<String>, hidden: &mut usize) {
        if depth > MAX_DEPTH || lines.len() >= MAX_LINES {
            return;
        }
        let Ok(kids) = parent.FindAllBuildCache(TreeScope_Children, cond, cache) else { return };
        let n = kids.Length().unwrap_or(0);
        for i in 0..n {
            if lines.len() >= MAX_LINES {
                return;
            }
            let Ok(el) = kids.GetElement(i) else { continue };
            let ct = el.CachedControlType().unwrap_or_default();
            if skipped(ct) {
                continue;
            }
            if cached_bool(&el, UIA_IsOffscreenPropertyId) && ct.0 != 50032 {
                *hidden += 1;
                continue;
            }
            let name = clip(&el.CachedName().map(|b| b.to_string()).unwrap_or_default(), 100);
            let r = role(ct);
            let acts = [UIA_IsInvokePatternAvailablePropertyId, UIA_IsTogglePatternAvailablePropertyId, UIA_IsSelectionItemPatternAvailablePropertyId, UIA_IsExpandCollapsePatternAvailablePropertyId]
                .iter()
                .any(|p| cached_bool(&el, *p));
            let password = cached_bool(&el, UIA_IsPasswordPropertyId);
            let editable = cached_bool(&el, UIA_IsValuePatternAvailablePropertyId) && !cached_bool(&el, UIA_ValueIsReadOnlyPropertyId);
            let control = acts || editable;
            let pad = "  ".repeat(depth);
            let matches = |text: &str| {
                let low = text.to_lowercase();
                want.iter().all(|w| low.contains(w))
            };
            if control {
                let mut line = format!("{pad}- {} {:?} [ref={}]", if r.is_empty() { "control" } else { r }, name, self.ref_of(&el));
                if password {
                    line.push_str(" [password]");
                } else if cached_bool(&el, UIA_IsValuePatternAvailablePropertyId) {
                    let v = clip(&cached_text(&el, UIA_ValueValuePropertyId), 120);
                    if !v.is_empty() && v != name {
                        line.push_str(&format!(": {v:?}"));
                    }
                }
                if cached_i32(&el, UIA_ToggleToggleStatePropertyId) == Some(1) || cached_bool(&el, UIA_SelectionItemIsSelectedPropertyId) {
                    line.push_str(" [checked]");
                }
                match cached_i32(&el, UIA_ExpandCollapseExpandCollapseStatePropertyId) {
                    Some(0) => line.push_str(" [expanded=false]"),
                    Some(1) => line.push_str(" [expanded=true]"),
                    _ => {}
                }
                if !cached_bool(&el, UIA_IsEnabledPropertyId) {
                    line.push_str(" [disabled]");
                }
                if want.is_empty() || matches(&line) {
                    lines.push(if want.is_empty() { line } else { line.trim_start().to_string() });
                }
                // Lists, trees, menus and combo boxes hold controls too.
                if matches!(ct.0, 50003 | 50007 | 50011 | 50024 | 50029 | 50031) {
                    self.walk(&el, cond, cache, depth + 1, want, lines, hidden);
                }
                continue;
            }
            if r == "text" {
                if !name.is_empty() && (want.is_empty() || matches(&name)) {
                    let t = format!("{pad}- text: {name:?}");
                    lines.push(if want.is_empty() { t } else { t.trim_start().to_string() });
                }
                continue;
            }
            // A container: shown when it has a name or a role worth seeing.
            let mut inner = depth;
            if want.is_empty() && !r.is_empty() && !(name.is_empty() && matches!(r, "group" | "window" | "document")) {
                lines.push(format!("{pad}- {r}{}:", if name.is_empty() { String::new() } else { format!(" {name:?}") }));
                inner = depth + 1;
            }
            self.walk(&el, cond, cache, inner, want, lines, hidden);
        }
    }

    /// The element of a ref of the last tree, still there.
    unsafe fn element(&self, r: &str) -> Result<IUIAutomationElement, String> {
        let el = self.refs.get(r.trim()).ok_or_else(|| tf("Il riferimento {r} non è dell'ultima lettura: rifai desktop_snapshot.", &[("r", &r)]))?;
        if el.CurrentProcessId().is_err() {
            return Err(tf("{r} non c'è più (la finestra è cambiata): rifai desktop_snapshot.", &[("r", &r)]));
        }
        Ok(el.clone())
    }
}

// ── Guards ───────────────────────────────────────────────────────────────────

/// A name the user clicks, never EasyIsland.
fn blocked_name(name: &str) -> bool {
    name.to_lowercase().split(|c: char| !c.is_alphanumeric()).any(|w| BLOCKED_WORDS.contains(&w))
}

/// The program of the window can be acted on.
fn can_act(w: &Win) -> Result<(), String> {
    if NO_ACT.contains(&w.exe.as_str()) {
        return Err(tf("In {e} EasyIsland non clicca e non scrive (terminali, impostazioni e strumenti di sistema, accessi remoti): lì lo fa l'utente.", &[("e", &w.exe)]));
    }
    // The «Esegui» box of Windows runs what is typed.
    let title = w.title.trim().to_lowercase();
    if w.exe == "explorer.exe" && (title == "esegui" || title == "run") {
        return Err(t("Nella finestra «Esegui» EasyIsland non scrive: è un comando.").into());
    }
    Ok(())
}

// ── Tools ────────────────────────────────────────────────────────────────────

pub async fn tool(name: &str, args: &Value) -> Result<String, String> {
    let s = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or_default().trim().to_string();
    match name {
        "desktop_windows" => {
            let all = windows_now();
            if all.is_empty() {
                return Ok(t("Nessuna finestra aperta.").into());
            }
            let front = unsafe { GetForegroundWindow() }.0 as isize;
            let user = crate::context::target().map(|h| h.0 as isize).unwrap_or(front);
            Ok(all
                .iter()
                .map(|w| {
                    let mark = if w.hwnd == user { "*" } else { " " };
                    let min = if unsafe { IsIconic(HWND(w.hwnd as *mut _)) }.as_bool() { t(" (ridotta a icona)") } else { "" };
                    format!("{mark}w{} {} — {}{min}", w.hwnd, w.exe, clip(&w.title, 100))
                })
                .collect::<Vec<_>>()
                .join("\n"))
        }
        "desktop_snapshot" => {
            let w = window_of(&s("window"))?;
            let out = on_uia(move |u| unsafe {
                let tree = u.tree(&w, &[])?;
                u.last = tree.clone();
                Ok::<String, String>(tree)
            })
            .await??;
            Ok(out)
        }
        "desktop_find" => {
            let q = s("query");
            if q.is_empty() {
                return Err(t("Manca query: le parole da cercare nella finestra.").into());
            }
            let want: Vec<String> = q.to_lowercase().split_whitespace().map(str::to_string).collect();
            let w = window_of(&s("window"))?;
            let out = on_uia(move |u| unsafe { u.tree(&w, &want) }).await??;
            let found = out.lines().skip(2).filter(|l| !l.trim().is_empty()).take(25).collect::<Vec<_>>();
            if found.is_empty() {
                return Ok(tf("Nella finestra non c'è «{q}».", &[("q", &q)]));
            }
            Ok(format!("{}\n{}", out.lines().next().unwrap_or_default(), found.join("\n")))
        }
        "desktop_click" | "desktop_type" => {
            let r = s("ref");
            if r.is_empty() {
                return Err(t("Manca ref: il riferimento dell'elemento (da desktop_snapshot o desktop_find).").into());
            }
            let typing = name == "desktop_type";
            let text = args.get("text").and_then(Value::as_str).unwrap_or_default().to_string();
            let append = args.get("append").and_then(Value::as_bool).unwrap_or(false);
            let action = s("action");
            let done = on_uia(move |u| unsafe { act(u, &r, typing, &text, append, &action) }).await??;
            // A moment for the program, then what changed in its window.
            tokio::time::sleep(Duration::from_millis(500)).await;
            let after = on_uia(|u| unsafe {
                let hwnd = HWND(u.window as *mut _);
                if !IsWindow(Some(hwnd)).as_bool() {
                    return Ok::<String, String>(t("La finestra si è chiusa.").to_string());
                }
                let w = Win { hwnd: u.window, exe: u.exe.clone(), title: title_of(hwnd) };
                let before = std::mem::take(&mut u.last);
                let now = u.tree(&w, &[])?;
                u.last = now.clone();
                Ok(changes(&before, &now).unwrap_or(now))
            })
            .await
            .and_then(|r| r)
            .unwrap_or_default();
            // A dialog the program opened comes in front.
            let front = unsafe { GetForegroundWindow() };
            let mut note = String::new();
            if !front.0.is_null() && !crate::context::is_ours(front) {
                let same_exe = crate::context::exe_of(front);
                let title = title_of(front);
                let known = WORKER_WINDOW.lock().map(|w| *w).unwrap_or(0);
                if front.0 as isize != known && same_exe.is_some() {
                    note = tf("\n\nIn primo piano ora c'è «{t}» (w{h}): per leggerla desktop_snapshot con window w{h}.", &[("t", &title), ("h", &(front.0 as isize))]);
                }
            }
            Ok(format!("{done}\n\n{after}{note}"))
        }
        _ => Err(format!("unknown tool {name}")),
    }
}

/// The window the refs are of, outside the UI Automation thread (for the note after an action).
static WORKER_WINDOW: Mutex<isize> = Mutex::new(0);

unsafe fn act(u: &mut Uia, r: &str, typing: bool, text: &str, append: bool, action: &str) -> Result<String, String> {
    let el = u.element(r)?;
    if let Ok(mut w) = WORKER_WINDOW.lock() {
        *w = u.window;
    }
    let hwnd = HWND(u.window as *mut _);
    can_act(&Win { hwnd: u.window, exe: u.exe.clone(), title: title_of(hwnd) })?;
    let name = el.CurrentName().map(|b| b.to_string()).unwrap_or_default();
    let what = if name.trim().is_empty() { r.to_string() } else { clip(&name, 60) };
    if !el.CurrentIsEnabled().map(|b| b.as_bool()).unwrap_or(true) {
        return Err(tf("«{w}» è disattivato: il programma non lo fa usare adesso.", &[("w", &what)]));
    }
    if typing {
        if el.CurrentIsPassword().map(|b| b.as_bool()).unwrap_or(false) {
            return Err(t("Le password le scrive l'utente.").into());
        }
        let p = el
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            .map_err(|_| tf("In «{w}» non si scrive senza tastiera: lo fa l'utente.", &[("w", &what)]))?;
        if p.CurrentIsReadOnly().map(|b| b.as_bool()).unwrap_or(false) {
            return Err(tf("«{w}» è di sola lettura.", &[("w", &what)]));
        }
        let value = if append { format!("{}{text}", p.CurrentValue().map(|b| b.to_string()).unwrap_or_default()) } else { text.to_string() };
        p.SetValue(&BSTR::from(value.as_str())).map_err(|e| e.to_string())?;
        return Ok(tf("Scritto in «{w}».", &[("w", &what)]));
    }
    if blocked_name(&name) {
        return Err(tf("«{w}» lo clicca l'utente: EasyIsland nei programmi non invia, non elimina, non paga e non acquista.", &[("w", &what)]));
    }
    let try_invoke = || el.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId).ok().map(|p| p.Invoke().is_ok());
    let try_toggle = || el.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId).ok().map(|p| p.Toggle().is_ok());
    let try_select = || el.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId).ok().map(|p| p.Select().is_ok());
    let try_expand = || {
        el.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId).ok().map(|p| {
            let open = p.CurrentExpandCollapseState().map(|s| s.0 == 1).unwrap_or(false);
            let want_open = match action {
                "expand" => true,
                "collapse" => false,
                _ => !open,
            };
            if want_open { p.Expand().is_ok() } else { p.Collapse().is_ok() }
        })
    };
    let try_default = || el.GetCurrentPatternAs::<IUIAutomationLegacyIAccessiblePattern>(UIA_LegacyIAccessiblePatternId).ok().map(|p| p.DoDefaultAction().is_ok());
    let done = match action {
        "toggle" => try_toggle(),
        "select" => try_select(),
        "expand" | "collapse" => try_expand(),
        "invoke" => try_invoke(),
        _ => try_invoke().or_else(try_toggle).or_else(try_select).or_else(try_expand).or_else(try_default),
    };
    match done {
        Some(true) => Ok(tf("Fatto su «{w}».", &[("w", &what)])),
        Some(false) => Err(tf("«{w}» non ha risposto al clic.", &[("w", &what)])),
        None => Err(tf("«{w}» si usa solo con il mouse: lo fa l'utente.", &[("w", &what)])),
    }
}

/// The new lines of `now` against `before`; None when most changed.
fn changes(before: &str, now: &str) -> Option<String> {
    if before.is_empty() {
        return None;
    }
    let mut old: HashMap<&str, usize> = HashMap::new();
    for l in before.lines().skip(1) {
        *old.entry(l.trim_end()).or_default() += 1;
    }
    let lines: Vec<&str> = now.lines().skip(1).filter(|l| !l.trim().is_empty()).collect();
    let mut fresh = Vec::new();
    for l in &lines {
        match old.get_mut(l.trim_end()) {
            Some(n) if *n > 0 => *n -= 1,
            _ => fresh.push(*l),
        }
    }
    if fresh.is_empty() {
        return Some(t("La finestra non è cambiata.").to_string());
    }
    if fresh.len() * 2 > lines.len() || fresh.len() > 80 {
        return None;
    }
    Some(format!("{}\n{}", tf("Cambiato nella finestra ({n} righe nuove; desktop_snapshot per vederla tutta):", &[("n", &fresh.len())]), fresh.join("\n")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_clicks_what_sends_deletes_or_pays() {
        assert!(blocked_name("Invia"));
        assert!(blocked_name("Elimina messaggio"));
        assert!(blocked_name("Send"));
        assert!(blocked_name("Paga ora"));
        assert!(!blocked_name("Salva"));
        assert!(!blocked_name("Apri"));
        // Whole words only: «Inviato» (a folder) is not «Invia».
        assert!(!blocked_name("Posta inviata"));
    }

    #[test]
    fn never_acts_in_terminals_or_run() {
        let w = |exe: &str, title: &str| Win { hwnd: 0, exe: exe.into(), title: title.into() };
        assert!(can_act(&w("powershell.exe", "PS")).is_err());
        assert!(can_act(&w("windowsterminal.exe", "x")).is_err());
        assert!(can_act(&w("explorer.exe", "Esegui")).is_err());
        assert!(can_act(&w("explorer.exe", "Documenti")).is_ok());
        assert!(can_act(&w("outlook.exe", "Posta")).is_ok());
    }

    #[test]
    fn after_an_action_only_what_changed() {
        let a = "Titolo — x.exe [w1]\n\n- button \"A\" [ref=d1]\n- button \"B\" [ref=d2]\n- text: \"c\"";
        assert_eq!(changes(a, a).as_deref(), Some(t("La finestra non è cambiata.")));
        let b = format!("{a}\n- text: \"nuovo\"");
        assert!(changes(a, &b).unwrap().ends_with("- text: \"nuovo\""));
    }

    /// By hand (`cargo test desktop -- --ignored --nocapture`): the tree of the window in front.
    #[test]
    #[ignore]
    fn reads_the_window_in_front() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let list = rt.block_on(tool("desktop_windows", &serde_json::json!({}))).unwrap();
        println!("{list}");
        let first = list.lines().next().unwrap().trim_start_matches('*').trim().split(' ').next().unwrap().to_string();
        println!("{}", rt.block_on(tool("desktop_snapshot", &serde_json::json!({ "window": first }))).unwrap());
    }
}
