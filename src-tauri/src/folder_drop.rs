// The character dropped on a folder: which file or folder is under the cursor.
//
// An Explorer window gives the item under the cursor (the name of the list or
// details row, joined to the folder the active tab shows), or that folder
// itself over its background, address bar or title. The desktop gives the icon
// under the cursor, looked up in the user's and the public Desktop folders.
// Anything else — another app, the empty desktop, a virtual folder such as
// "Questo PC" — is None, and the drop just moves the character as before.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use windows::core::{Interface, PWSTR};
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IServiceProvider, CLSCTX_ALL,
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, UIA_DataItemControlTypeId, UIA_ListItemControlTypeId,
};
use windows::Win32::UI::Shell::{
    FOLDERID_Desktop, FOLDERID_PublicDesktop, IFolderView, IPersistFolder2, IShellBrowser, IShellWindows, IWebBrowser2,
    SHGetKnownFolderPath, SHGetPathFromIDListEx, SID_STopLevelBrowser, ShellWindows, GPFIDL_DEFAULT, KF_FLAG_DEFAULT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetClassNameW, GetWindowLongPtrW, IsWindowVisible, SetWindowLongPtrW, WindowFromPoint, GA_ROOT,
    GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
};

/// Explorer answers in a few milliseconds; a hung one must not hold the drop.
const TIMEOUT: Duration = Duration::from_millis(1500);

/// The file or folder under the physical point (x, y), seen through `own` — the
/// island's window, which is under the cursor too.
pub fn path_at(own: HWND, x: i32, y: i32) -> Option<PathBuf> {
    let own = own.0 as isize;
    let (tx, rx) = mpsc::channel();
    // Its own thread and COM apartment: the command runs on the UI thread.
    std::thread::spawn(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        let found = unsafe { lookup(HWND(own as *mut _), POINT { x, y }) };
        let _ = tx.send(found);
        unsafe { CoUninitialize() };
    });
    rx.recv_timeout(TIMEOUT).ok().flatten()
}

unsafe fn lookup(own: HWND, pt: POINT) -> Option<PathBuf> {
    let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
    // Click-through for a moment, the way the island already is away from its
    // shape (tao's set_ignore_cursor_events), so the hit tests see what is below.
    let style = GetWindowLongPtrW(own, GWL_EXSTYLE);
    SetWindowLongPtrW(own, GWL_EXSTYLE, style | (WS_EX_TRANSPARENT.0 | WS_EX_LAYERED.0) as isize);
    let hit = WindowFromPoint(pt);
    let element = uia.ElementFromPoint(pt).ok();
    SetWindowLongPtrW(own, GWL_EXSTYLE, style);

    let root = GetAncestor(hit, GA_ROOT);
    if root.is_invalid() || root == own {
        return None;
    }
    let name = element.and_then(|e| item_name(&uia, e));
    match class_name(root).as_str() {
        "CabinetWClass" => {
            let folder = explorer_folder(root)?;
            Some(name.map(|n| folder.join(n)).filter(|p| p.exists()).unwrap_or(folder))
        }
        "Progman" | "WorkerW" => {
            let name = name?;
            [&FOLDERID_Desktop, &FOLDERID_PublicDesktop]
                .into_iter()
                .filter_map(|id| known_folder(id))
                .map(|d| d.join(&name))
                .find(|p| p.exists())
        }
        _ => None,
    }
}

/// The name of the list or details row the element belongs to (the hit is often
/// its text or icon, a level or two down).
unsafe fn item_name(uia: &IUIAutomation, mut el: IUIAutomationElement) -> Option<String> {
    let walker = uia.ControlViewWalker().ok()?;
    for _ in 0..4 {
        let kind = el.CurrentControlType().ok()?;
        if kind == UIA_ListItemControlTypeId || kind == UIA_DataItemControlTypeId {
            let name = el.CurrentName().ok()?.to_string();
            // A name with a path separator is not a file name (and must not climb out).
            return (!name.is_empty() && !name.contains(['\\', '/', ':'])).then_some(name);
        }
        el = walker.GetParentElement(&el).ok()?;
    }
    None
}

/// The folder the window's active tab shows. Every tab of a Windows 11 Explorer
/// window is a separate shell window with the same top-level HWND; the active
/// one is the tab whose own window is visible.
unsafe fn explorer_folder(root: HWND) -> Option<PathBuf> {
    let windows: IShellWindows = CoCreateInstance(&ShellWindows, None, CLSCTX_ALL).ok()?;
    let mut fallback = None;
    for i in 0..windows.Count().ok()? {
        let Ok(disp) = windows.Item(&VARIANT::from(i)) else { continue };
        let Ok(browser) = disp.cast::<IWebBrowser2>() else { continue };
        if browser.HWND().ok().map(|h| h.0) != Some(root.0 as isize) {
            continue;
        }
        let Ok(sp) = disp.cast::<IServiceProvider>() else { continue };
        let Ok(shell) = sp.QueryService::<IShellBrowser>(&SID_STopLevelBrowser) else { continue };
        let Some(path) = shell_folder(&shell) else { continue };
        if shell.GetWindow().map(|tab| IsWindowVisible(tab).as_bool()).unwrap_or(false) {
            return Some(path);
        }
        fallback.get_or_insert(path);
    }
    fallback
}

/// A real folder on disk; None for "Questo PC", Rete, Raccolte…
unsafe fn shell_folder(shell: &IShellBrowser) -> Option<PathBuf> {
    let view: IFolderView = shell.QueryActiveShellView().ok()?.cast().ok()?;
    let folder: IPersistFolder2 = view.GetFolder().ok()?;
    let pidl = folder.GetCurFolder().ok()?;
    // Long paths too, which SHGetPathFromIDListW (MAX_PATH) returns empty.
    let mut buf = vec![0u16; 32768];
    let ok = SHGetPathFromIDListEx(pidl, &mut buf, GPFIDL_DEFAULT).as_bool();
    CoTaskMemFree(Some(pidl as _));
    if !ok {
        return None;
    }
    let path = PathBuf::from(wide(&buf));
    path.is_dir().then_some(path)
}

unsafe fn known_folder(id: &windows::core::GUID) -> Option<PathBuf> {
    let p: PWSTR = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
    let path = p.to_string().ok().map(PathBuf::from);
    CoTaskMemFree(Some(p.0 as _));
    path.filter(|d| Path::new(d).is_dir())
}

unsafe fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 64];
    let n = GetClassNameW(hwnd, &mut buf) as usize;
    String::from_utf16_lossy(&buf[..n])
}

fn wide(buf: &[u16]) -> String {
    let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..n])
}
