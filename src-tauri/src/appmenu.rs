// The menu of the program in front, from a click on the fixed bar's «Titolo
// della finestra» (asked by Edoardo on 31 Oct 2026; docs/architettura.md →
// «Barra fissa»). Not EasyIsland's entries: the program's own menus, then the
// user's quick actions for that program (built by the island, `extra`).
//
// Two ways to read them:
// - a classic menu bar (GetMenu): the whole tree, submenus included, read
//   without opening it; a line is sent back to the program as WM_COMMAND, as if
//   picked from its own menu. Programs that fill a submenu only when it opens
//   are asked first (WM_INITMENUPOPUP, with a timeout: a hung program never
//   holds the bar).
// - otherwise UI Automation: the top-level items of the window's menu bar
//   (File, Modifica…); a line opens that menu in the program (ExpandCollapse,
//   or Invoke). Programs without a readable menu (browsers) only get the actions.
// Reading runs on its own thread with a time limit; the menu itself on the
// main thread, which owns the bar's window.

use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Wry};
use windows::core::{BSTR, PWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationExpandCollapsePattern, IUIAutomationInvokePattern,
    TreeScope_Descendants, UIA_AutomationIdPropertyId, UIA_ControlTypePropertyId,
    UIA_ExpandCollapsePatternId, UIA_InvokePatternId, UIA_MenuBarControlTypeId, UIA_MenuItemControlTypeId, UIA_TitleBarControlTypeId,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetMenu, GetMenuItemCount, GetMenuItemInfoW, IsWindow, PostMessageW, SendMessageTimeoutW, SetForegroundWindow, HMENU,
    MENUITEMINFOW, MFS_CHECKED, MFS_DISABLED, MFT_SEPARATOR, MIIM_FTYPE, MIIM_ID, MIIM_STATE, MIIM_STRING, MIIM_SUBMENU,
    SMTO_ABORTIFHUNG, WM_COMMAND, WM_INITMENUPOPUP, WM_SYSCOMMAND, GetSystemMenu,
};

/// A slow program (a big window read through UI Automation) shows the menu without its own lines.
const READ_TIMEOUT: Duration = Duration::from_millis(1500);
/// Chromium builds its accessibility tree only once a client asks: the window's
/// menu (VS Code, other apps made of web pages) is read again for this long.
const CHROMIUM_WAIT: Duration = Duration::from_millis(1000);
/// How deep and how long a classic menu is read.
const MAX_DEPTH: usize = 4;
const MAX_ITEMS: i32 = 80;

/// What a line of the program's menu does when picked.
#[derive(Clone, Copy)]
enum Line {
    /// WM_COMMAND (WM_SYSCOMMAND for the window's own menu) with this id to the window.
    Command { hwnd: isize, id: u32, sys: bool },
    /// The window's menu bar item at this place opens (UI Automation).
    Bar { hwnd: isize, index: usize },
}

/// One line read from the program: a separator, a line, or a submenu.
struct Node {
    label: String,
    enabled: bool,
    checked: bool,
    sep: bool,
    line: Option<usize>,
    items: Vec<Node>,
}

/// Windows already given time to build their accessibility tree (Chromium).
static WAITED: Mutex<Vec<isize>> = Mutex::new(Vec::new());

/// The lines of the menu last shown, by their index in its ids («appmenu:<n>»).
static LINES: Mutex<Vec<Line>> = Mutex::new(Vec::new());

/// The menu at the mouse over the bar: the program's lines, then `extra`
/// ([key, label]: the island's lines, sent back as «bar:<key>» like «…»'s).
pub fn popup(app: &AppHandle, title: String, extra: Vec<(String, String)>) {
    let target = crate::fgwin::target();
    let (tx, rx) = mpsc::channel();
    let hwnd = target.map(|h| h.0 as isize);
    std::thread::spawn(move || {
        let start = std::time::Instant::now();
        let read = hwnd.map(|h| unsafe { read(HWND(h as *mut _)) }).unwrap_or_default();
        let class = hwnd.map(|h| class_of(HWND(h as *mut _))).unwrap_or_default();
        crate::log::line(format!("app menu read: {} lines in {} ms ({class})", read.1.len(), start.elapsed().as_millis()));
        let _ = tx.send(read);
    });
    let got = rx.recv_timeout(READ_TIMEOUT);
    if got.is_err() {
        crate::log::line(format!("app menu: no answer in {} ms, window {}", READ_TIMEOUT.as_millis(), if hwnd.is_some() { "found" } else { "none" }));
    }
    let (nodes, lines) = got.unwrap_or_default();
    *LINES.lock().unwrap() = lines;
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || show(&app2, &title, &nodes, &extra));
}

fn show(app: &AppHandle, title: &str, nodes: &[Node], extra: &[(String, String)]) {
    let Some(win) = app.get_window(crate::CHARACTER_LABEL) else { return };
    let built = Menu::new(app).and_then(|menu| {
        if !title.is_empty() {
            menu.append(&MenuItem::with_id(app, "appmenu:-", title.replace('&', "&&"), false, None::<&str>)?)?;
            menu.append(&PredefinedMenuItem::separator(app)?)?;
        }
        if nodes.is_empty() {
            let none = crate::i18n::t("Nessun menu da leggere per questo programma");
            menu.append(&MenuItem::with_id(app, "appmenu:-", none, false, None::<&str>)?)?;
        } else {
            append(app, nodes, &|item| menu.append(item))?;
        }
        if !extra.is_empty() {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
            for (key, label) in extra {
                if key.is_empty() {
                    menu.append(&PredefinedMenuItem::separator(app)?)?;
                    continue;
                }
                menu.append(&MenuItem::with_id(app, format!("bar:{key}"), label.replace('&', "&&"), !key.starts_with('-'), None::<&str>)?)?;
            }
        }
        Ok(menu)
    });
    let menu = match built {
        Ok(m) => m,
        Err(e) => {
            crate::log::line(format!("app menu not built: {e}"));
            return;
        }
    };
    // As the bar's other menus: TrackPopupMenu needs a foreground owner to close on an outside click.
    crate::island::set_activating(&win, true);
    if let Err(e) = win.popup_menu(&menu) {
        crate::log::line(format!("app menu: {e}"));
    }
    crate::island::make_non_activating(&win);
}

fn append(app: &AppHandle, nodes: &[Node], add: &dyn Fn(&dyn IsMenuItem<Wry>) -> tauri::Result<()>) -> tauri::Result<()> {
    for n in nodes {
        if n.sep {
            add(&PredefinedMenuItem::separator(app)?)?;
        } else if !n.items.is_empty() {
            let sub = Submenu::new(app, &n.label, n.enabled)?;
            append(app, &n.items, &|item| sub.append(item))?;
            add(&sub)?;
        } else {
            let id = n.line.map(|i| format!("appmenu:{i}")).unwrap_or_else(|| "appmenu:-".into());
            if n.checked {
                add(&CheckMenuItem::with_id(app, id, &n.label, n.enabled, true, None::<&str>)?)?;
            } else {
                add(&MenuItem::with_id(app, id, &n.label, n.enabled, None::<&str>)?)?;
            }
        }
    }
    Ok(())
}

/// A line of the program's menu was picked (tray.rs, «appmenu:<n>»).
pub fn run(which: &str) {
    let Some(line) = which.parse::<usize>().ok().and_then(|i| LINES.lock().unwrap().get(i).copied()) else { return };
    match line {
        Line::Command { hwnd, id, sys } => unsafe {
            let hwnd = HWND(hwnd as *mut _);
            if !IsWindow(Some(hwnd)).as_bool() {
                return;
            }
            // In front first: a dialog the command opens belongs to it.
            let _ = SetForegroundWindow(hwnd);
            let (msg, w) = if sys { (WM_SYSCOMMAND, id as usize) } else { (WM_COMMAND, id as usize & 0xFFFF) };
            let _ = PostMessageW(Some(hwnd), msg, WPARAM(w), LPARAM(0));
        },
        Line::Bar { hwnd, index } => {
            std::thread::spawn(move || unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let hwnd = HWND(hwnd as *mut _);
                if IsWindow(Some(hwnd)).as_bool() {
                    let _ = SetForegroundWindow(hwnd);
                    if let Some(item) = bar_items(hwnd).and_then(|(_, items)| items.into_iter().nth(index)) {
                        open(&item);
                    }
                }
                CoUninitialize();
            });
        }
    }
}

fn class_of(hwnd: HWND) -> String {
    let mut buf = [0u16; 128];
    let n = unsafe { windows::Win32::UI::WindowsAndMessaging::GetClassNameW(hwnd, &mut buf) };
    String::from_utf16_lossy(buf.get(..n.max(0) as usize).unwrap_or(&[]))
}

/// The program's menu: its lines as nodes, and what each line does. The menu
/// bar (classic, else UI Automation), then the window's own menu (Alt+Space),
/// which every window has and some programs add to (Chrome: new tab, task
/// manager…): a submenu after a menu bar, the lines themselves without one.
unsafe fn read(hwnd: HWND) -> (Vec<Node>, Vec<Line>) {
    let mut lines = Vec::new();
    let mut nodes = Vec::new();
    let bar = GetMenu(hwnd);
    if !bar.is_invalid() && GetMenuItemCount(Some(bar)) > 0 {
        nodes = classic(hwnd, bar, 0, false, &mut lines);
    }
    if nodes.is_empty() {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        nodes = automation(hwnd, &mut lines);
        CoUninitialize();
    }
    let sys = GetSystemMenu(hwnd, false);
    if !sys.is_invalid() {
        // Its lines' states (Ripristina, Ingrandisci) as when it opens.
        let _ = SendMessageTimeoutW(hwnd, WM_INITMENUPOPUP, WPARAM(sys.0 as usize), LPARAM(1 << 16), SMTO_ABORTIFHUNG, 150, None);
        let own = classic(hwnd, sys, 0, true, &mut lines);
        if !own.is_empty() {
            if nodes.is_empty() {
                nodes = own;
            } else {
                nodes.push(Node { label: String::new(), enabled: true, checked: false, sep: true, line: None, items: Vec::new() });
                nodes.push(Node { label: crate::i18n::t("Finestra").to_string(), enabled: true, checked: false, sep: false, line: None, items: own });
            }
        }
    }
    (nodes, lines)
}

/// A classic menu and its submenus, as they would show.
unsafe fn classic(hwnd: HWND, menu: HMENU, depth: usize, sys: bool, lines: &mut Vec<Line>) -> Vec<Node> {
    let mut out: Vec<Node> = Vec::new();
    let count = GetMenuItemCount(Some(menu)).min(MAX_ITEMS);
    for pos in 0..count.max(0) {
        let mut info = MENUITEMINFOW {
            cbSize: std::mem::size_of::<MENUITEMINFOW>() as u32,
            fMask: MIIM_FTYPE | MIIM_STATE | MIIM_ID | MIIM_SUBMENU | MIIM_STRING,
            ..Default::default()
        };
        if GetMenuItemInfoW(menu, pos as u32, true, &mut info).is_err() {
            continue;
        }
        if info.fType.0 & MFT_SEPARATOR.0 != 0 {
            // No separator first, last or twice.
            if out.last().is_some_and(|n| !n.sep) {
                out.push(Node { label: String::new(), enabled: true, checked: false, sep: true, line: None, items: Vec::new() });
            }
            continue;
        }
        let label = item_text(menu, pos as u32, info.cch);
        if label.trim().is_empty() {
            continue; // drawn by the program (owner-draw): nothing to read
        }
        let enabled = info.fState.0 & MFS_DISABLED.0 == 0;
        let checked = info.fState.0 & MFS_CHECKED.0 != 0;
        if !info.hSubMenu.is_invalid() {
            if depth + 1 >= MAX_DEPTH {
                continue;
            }
            // Filled on opening by some programs: as if it opened.
            let lp = pos as isize | if sys { 1 << 16 } else { 0 };
            let _ = SendMessageTimeoutW(hwnd, WM_INITMENUPOPUP, WPARAM(info.hSubMenu.0 as usize), LPARAM(lp), SMTO_ABORTIFHUNG, 150, None);
            let items = classic(hwnd, info.hSubMenu, depth + 1, sys, lines);
            if !items.is_empty() {
                out.push(Node { label, enabled, checked: false, sep: false, line: None, items });
            }
            continue;
        }
        let line = lines.len();
        lines.push(Line::Command { hwnd: hwnd.0 as isize, id: info.wID, sys });
        out.push(Node { label, enabled, checked, sep: false, line: Some(line), items: Vec::new() });
    }
    while out.last().is_some_and(|n| n.sep) {
        out.pop();
    }
    out
}

unsafe fn item_text(menu: HMENU, pos: u32, cch: u32) -> String {
    let mut buf = vec![0u16; cch as usize + 1];
    let mut info = MENUITEMINFOW {
        cbSize: std::mem::size_of::<MENUITEMINFOW>() as u32,
        fMask: MIIM_STRING,
        dwTypeData: PWSTR(buf.as_mut_ptr()),
        cch: cch + 1,
        ..Default::default()
    };
    if GetMenuItemInfoW(menu, pos, true, &mut info).is_err() {
        return String::new();
    }
    let n = (info.cch as usize).min(buf.len());
    String::from_utf16_lossy(buf.get(..n).unwrap_or(&[]))
}

/// The window's menu bar through UI Automation, without the title bar's own («Sistema»).
unsafe fn bar_items(hwnd: HWND) -> Option<(IUIAutomation, Vec<IUIAutomationElement>)> {
    let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
    let root = uia.ElementFromHandle(hwnd).ok()?;
    let is_bar = uia.CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(UIA_MenuBarControlTypeId.0)).ok()?;
    let system = uia.CreatePropertyCondition(UIA_AutomationIdPropertyId, &VARIANT::from(BSTR::from("SystemMenuBar"))).ok()?;
    let not_system = uia.CreateNotCondition(&system).ok()?;
    let cond = uia.CreateAndCondition(&is_bar, &not_system).ok()?;
    // Not the one in the title bar (the window's «Sistema» menu, under another id in some windows).
    let walker = uia.ControlViewWalker().ok()?;
    let bars = root.FindAll(TreeScope_Descendants, &cond).ok()?;
    let bar = (0..bars.Length().ok()?).filter_map(|i| bars.GetElement(i).ok()).find(|b| {
        walker.GetParentElement(b).and_then(|p| p.CurrentControlType()).map_or(true, |k| k != UIA_TitleBarControlTypeId)
    })?;
    let is_item = uia.CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(UIA_MenuItemControlTypeId.0)).ok()?;
    // Descendants: web pages (VS Code) wrap the items; a closed menu has no lines in the tree.
    let found = bar.FindAll(TreeScope_Descendants, &is_item).ok()?;
    let items = (0..found.Length().ok()?).filter_map(|i| found.GetElement(i).ok()).collect();
    Some((uia, items))
}

unsafe fn automation(hwnd: HWND, lines: &mut Vec<Line>) -> Vec<Node> {
    // Waited for once per window; browsers never have a menu bar.
    let browser = crate::context::exe_path(hwnd).is_some_and(|p| {
        let p = p.to_lowercase();
        ["\\chrome.exe", "\\msedge.exe", "\\brave.exe", "\\vivaldi.exe", "\\opera.exe"].iter().any(|e| p.ends_with(e))
    });
    let chromium = class_of(hwnd).starts_with("Chrome_WidgetWin") && !browser && !WAITED.lock().unwrap().contains(&(hwnd.0 as isize));
    if chromium {
        let mut waited = WAITED.lock().unwrap();
        if waited.len() > 64 {
            waited.clear();
        }
        waited.push(hwnd.0 as isize);
    }
    let start = std::time::Instant::now();
    let found = loop {
        match bar_items(hwnd) {
            Some(f) if !f.1.is_empty() => break Some(f),
            _ if chromium && start.elapsed() < CHROMIUM_WAIT => std::thread::sleep(Duration::from_millis(120)),
            _ => break None,
        }
    };
    let Some((_uia, items)) = found else { return Vec::new() };
    let mut out = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let label = item.CurrentName().map(|s| s.to_string()).unwrap_or_default();
        if label.trim().is_empty() {
            continue;
        }
        let enabled = item.CurrentIsEnabled().map(|b| b.as_bool()).unwrap_or(true);
        let line = lines.len();
        lines.push(Line::Bar { hwnd: hwnd.0 as isize, index });
        out.push(Node { label, enabled, checked: false, sep: false, line: Some(line), items: Vec::new() });
    }
    out
}

/// Opens a menu bar item in the program: its menu drops down there.
unsafe fn open(item: &IUIAutomationElement) {
    if let Ok(p) = item.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId) {
        if p.Expand().is_ok() {
            return;
        }
    }
    if let Ok(p) = item.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) {
        let _ = p.Invoke();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::core::BOOL;
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW, IsWindowVisible};

    /// By hand (`cargo test appmenu -- --ignored --nocapture`): the menus of the windows open now.
    #[test]
    #[ignore]
    fn reads_the_menus_of_open_windows() {
        unsafe extern "system" fn each(hwnd: HWND, data: LPARAM) -> BOOL {
            let out = &mut *(data.0 as *mut Vec<isize>);
            if IsWindowVisible(hwnd).as_bool() {
                out.push(hwnd.0 as isize);
            }
            true.into()
        }
        let mut all: Vec<isize> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(each), LPARAM(&mut all as *mut _ as isize));
        }
        for h in all {
            let hwnd = HWND(h as *mut _);
            let mut buf = [0u16; 200];
            let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
            let title = String::from_utf16_lossy(buf.get(..n.max(0) as usize).unwrap_or(&[]));
            if title.is_empty() {
                continue;
            }
            let start = std::time::Instant::now();
            let (nodes, lines) = unsafe { read(hwnd) };
            let top: Vec<String> = nodes.iter().filter(|n| !n.sep).map(|n| if n.items.is_empty() { n.label.clone() } else { format!("{} [{}]", n.label, n.items.iter().filter(|m| !m.sep).map(|m| m.label.as_str()).collect::<Vec<_>>().join(", ")) }).collect();
            println!("{title:.50} | {} lines, {} ms | {}", lines.len(), start.elapsed().as_millis(), top.join(", "));
        }
    }
}
