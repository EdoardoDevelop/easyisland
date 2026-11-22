// The Windows taskbar off, and always back (Edoardo, 19 and 22 Nov 2026:
// «dammi la possibilità di disattivare la barra delle applicazioni windows»):
// Impostazioni → Barra fissa → «Barra delle applicazioni di Windows», off
// unless chosen. Written for the parked Dock (branch claude/dock), used alone.
//
// Adapted from an MIT-licensed dock for Windows (notice in LICENSE).
//
// How: auto-hide (frees the work area) plus the taskbar windows made
// invisible and click-through. `ShowWindow(SW_HIDE)` does not hold on
// Windows 11: Explorer shows the taskbar again.
//
// Always back: the user's own auto-hide is saved to a file the first time and
// deleted only when given back (after a crash our auto-hide is never taken for
// theirs); a guard process (`easyisland.exe --guardia-barra <pid>`) gives it
// back when the app ends or stops answering; `--ripristina-barra` does it by
// hand (uninstaller, emergencies); at start a leftover file is given back.

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;
use std::{env, fs, mem::size_of, path::Path, path::PathBuf};

use windows::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::{COLORREF, HWND, LPARAM},
        UI::{
            Shell::{SHAppBarMessage, ABM_GETSTATE, ABM_SETSTATE, ABS_AUTOHIDE, APPBARDATA},
            WindowsAndMessaging::{
                FindWindowExW, GetLayeredWindowAttributes, GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE, LWA_ALPHA, WS_EX_LAYERED, WS_EX_TRANSPARENT,
            },
        },
    },
};

const PRIMARY: PCWSTR = w!("Shell_TrayWnd");
const SECONDARY: PCWSTR = w!("Shell_SecondaryTrayWnd");
const GHOST: isize = (WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0) as isize;

/// The command-line switches handled before the app starts (main.rs).
pub const GUARD_FLAG: &str = "--guardia-barra";
pub const RESTORE_FLAG: &str = "--ripristina-barra";

fn state_file() -> PathBuf {
    PathBuf::from(env::var_os("LOCALAPPDATA").unwrap_or_default()).join("EasyIsland").join("barra-windows")
}

/// Whether the taskbar was left taken over (the file of the user's own state is there).
pub fn taken() -> bool {
    state_file().exists()
}

/// Each `apply` starts a new keeper; the older one stops.
static KEEPER: AtomicU32 = AtomicU32::new(0);
/// How often the keeper looks: Explorer restarted, Windows showed it again, the guard died.
const KEEP_EVERY: Duration = Duration::from_secs(5);

/// Follows the setting: hidden and kept hidden, or given back (also when a
/// run before left it hidden and the setting is now off).
pub fn apply(hide: bool) {
    let gen = KEEPER.fetch_add(1, Ordering::SeqCst).wrapping_add(1);
    if !hide {
        if taken() {
            std::thread::spawn(|| {
                give_back();
                crate::log::line("barra di Windows: rimessa");
            });
        }
        return;
    }
    std::thread::spawn(move || {
        let mut said = false;
        while KEEPER.load(Ordering::SeqCst) == gen {
            ensure_guard();
            if !held() {
                let ok = take_over();
                if ok && !said {
                    crate::log::line("barra di Windows: nascosta");
                    said = true;
                }
            }
            std::thread::sleep(KEEP_EVERY);
        }
    });
}

/// At exit (the guard would do it too).
pub fn shutdown() {
    KEEPER.fetch_add(1, Ordering::SeqCst);
    if taken() {
        give_back_on_exit();
    }
}

/// Hidden as `take_over` leaves it, on every screen: nothing to do.
fn held() -> bool {
    let bars = taskbars();
    taken() && !bars.is_empty() && autohide_enabled() && bars.iter().all(|&h| is_ghost(h))
}

fn is_ghost(hwnd: HWND) -> bool {
    unsafe {
        let mut alpha = 255u8;
        let mut flags = Default::default();
        GetLayeredWindowAttributes(hwnd, None, Some(&mut alpha), Some(&mut flags)).is_ok() && alpha == 0 && GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & GHOST == GHOST
    }
}

/// Hides the taskbar on every screen. Idempotent: called again after
/// Explorer restarts or Windows shows it again. False when Explorer has no
/// taskbar yet (just signed in) or it did not take: retry later.
pub fn take_over() -> bool {
    take_over_bars(&taskbars(), &state_file())
}

fn take_over_bars(bars: &[HWND], file: &Path) -> bool {
    // No taskbar yet: saving the state of an absent shell would lose the user's own.
    if bars.is_empty() {
        return false;
    }
    if !file.exists() {
        let original = if autohide_enabled() { "1" } else { "0" };
        let saved = file.parent().map_or(Ok(()), fs::create_dir_all).and_then(|()| fs::write(file, original));
        if let Err(err) = saved {
            // Never hide it without the way back.
            crate::log::line(format!("barra di Windows: stato non salvato, resta com'è: {err}"));
            return false;
        }
    }
    set_autohide(true);
    let mut hidden = true;
    for &hwnd in bars {
        hidden &= set_ghost(hwnd, true);
    }
    hidden
}

/// When the app or its guard ends: given back, except while Windows shuts
/// down, restarts or signs out with EasyIsland starting with Windows (then
/// it stays auto-hidden: given back, it showed in full at every sign-in until
/// the Dock took it again).
pub fn give_back_on_exit() {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_SHUTTINGDOWN};
    let ending = unsafe { GetSystemMetrics(SM_SHUTTINGDOWN) } != 0;
    if ending && starts_with_windows() {
        return;
    }
    give_back();
}

/// The taskbar as it was before `take_over`; visible anyway when there is no saved state.
pub fn give_back() {
    let file = state_file();
    for hwnd in taskbars() {
        set_ghost(hwnd, false);
    }
    let Ok(original) = fs::read_to_string(&file) else { return };
    set_autohide(original.trim() == "1");
    let _ = fs::remove_file(file);
}

/// EasyIsland in the Run key (tauri-plugin-autostart writes it there).
fn starts_with_windows() -> bool {
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
    unsafe { RegGetValueW(HKEY_CURRENT_USER, w!(r"Software\Microsoft\Windows\CurrentVersion\Run"), w!("EasyIsland"), RRF_RT_REG_SZ, None, None, None).is_ok() }
}

fn taskbars() -> Vec<HWND> {
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    let mut found = Vec::new();
    let me = std::process::id();
    unsafe {
        // Explorer's own: never a Shell_TrayWnd of this process (the
        // notification area's host has that class too).
        let mut previous = None;
        while let Ok(hwnd) = FindWindowExW(None, previous, PRIMARY, None) {
            previous = Some(hwnd);
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid != me {
                found.push(hwnd);
                break;
            }
        }
        let mut previous = None;
        while let Ok(hwnd) = FindWindowExW(None, previous, SECONDARY, None) {
            found.push(hwnd);
            previous = Some(hwnd);
        }
    }
    found
}

fn appbar_data() -> APPBARDATA {
    APPBARDATA { cbSize: size_of::<APPBARDATA>() as u32, hWnd: taskbars().first().copied().unwrap_or_default(), ..Default::default() }
}

fn autohide_enabled() -> bool {
    let mut data = appbar_data();
    let state = unsafe { SHAppBarMessage(ABM_GETSTATE, &mut data) };
    state as u32 & ABS_AUTOHIDE != 0
}

fn set_autohide(on: bool) {
    let mut data = appbar_data();
    data.lParam = LPARAM(if on { ABS_AUTOHIDE as isize } else { 0 });
    unsafe { SHAppBarMessage(ABM_SETSTATE, &mut data) };
}

/// Invisible and click-through (or back); true when that is really so.
fn set_ghost(hwnd: HWND, ghost: bool) -> bool {
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if ghost {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | GHOST);
            if SetLayeredWindowAttributes(hwnd, COLORREF(0), 0, LWA_ALPHA).is_err() {
                return false;
            }
        } else if style & GHOST != 0 {
            let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style & !GHOST);
        }
        if !ghost {
            return true;
        }
        let mut alpha = 255u8;
        let mut flags = Default::default();
        GetLayeredWindowAttributes(hwnd, None, Some(&mut alpha), Some(&mut flags)).is_ok() && alpha == 0 && flags == LWA_ALPHA && GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & GHOST == GHOST
    }
}

// ---- The guard: a second, windowless easyisland.exe ----

const DETACHED_PROCESS: u32 = 0x0000_0008;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
const HEALTH_MS: u32 = 5_000;
const PING_MS: u32 = 250;
/// 20 s without an answer: hung, the taskbar comes back (and goes again if it answers).
const MISSES: u8 = 4;

#[derive(Default)]
struct Health {
    missed: u8,
    restored: bool,
}

impl Health {
    /// True when the taskbar must come back now.
    fn observe(&mut self, answers: bool) -> bool {
        if answers {
            self.missed = 0;
            self.restored = false;
            return false;
        }
        self.missed = self.missed.saturating_add(1);
        if self.missed >= MISSES && !self.restored {
            self.restored = true;
            return true;
        }
        false
    }
}

/// The guard of this run, while it lives.
static GUARD: std::sync::Mutex<Option<std::process::Child>> = std::sync::Mutex::new(None);

/// Started by the app when it takes the taskbar, again if it died (killed
/// with the app's other processes); on its own process group so closing the
/// app's console (development) does not end it too.
pub fn ensure_guard() {
    use std::os::windows::process::CommandExt;
    let mut guard = GUARD.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(child) = guard.as_mut() {
        if matches!(child.try_wait(), Ok(None)) {
            return;
        }
    }
    let Ok(exe) = env::current_exe() else { return };
    match std::process::Command::new(exe).args([GUARD_FLAG, &std::process::id().to_string()]).creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP).spawn() {
        Ok(child) => *guard = Some(child),
        Err(err) => crate::log::line(format!("barra di Windows: guardiano non avviato: {err}")),
    }
}

/// The guard's whole life: waits for the app; gives the taskbar back when it
/// ends, or after 20 s without answering (then takes it again if the app
/// comes back while still holding it).
pub fn run_guard(pid: u32) {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};
    background_priority();
    let process = match unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) } {
        Ok(p) => p,
        Err(_) => {
            // Already gone (a fast failure at start): the taskbar back now.
            give_back_on_exit();
            return;
        }
    };
    let mut health = Health::default();
    loop {
        let wait = unsafe { WaitForSingleObject(process, HEALTH_MS) };
        if wait == WAIT_OBJECT_0 {
            break;
        }
        if wait != WAIT_TIMEOUT {
            break;
        }
        let answers = answers(pid);
        if health.observe(answers) && taken() {
            crate::log::line("barra di Windows: EasyIsland non risponde da 20 s, rimessa dal guardiano");
            give_back();
        }
    }
    unsafe {
        let _ = CloseHandle(process);
    }
    if taken() {
        give_back_on_exit();
    }
}

/// The app's UI thread answers a no-op message within 250 ms (the event
/// loop's own window: if it hangs, everything hangs).
fn answers(pid: u32) -> bool {
    use windows::Win32::Foundation::WPARAM;
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, SendMessageTimeoutW, SMTO_ABORTIFHUNG, SMTO_ERRORONEXIT, WM_NULL};
    unsafe {
        let mut previous = None;
        while let Ok(hwnd) = FindWindowExW(None, previous, w!("Tao Thread Event Target"), None) {
            previous = Some(hwnd);
            let mut owner = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut owner));
            if owner != pid {
                continue;
            }
            return SendMessageTimeoutW(hwnd, WM_NULL, WPARAM(0), LPARAM(0), SMTO_ABORTIFHUNG | SMTO_ERRORONEXIT, PING_MS, None).0 != 0;
        }
        false
    }
}

/// The guard waits for weeks: lowest priority, no competition for the CPU.
fn background_priority() {
    use windows::Win32::System::Threading::{GetCurrentProcess, SetPriorityClass, IDLE_PRIORITY_CLASS};
    unsafe {
        let _ = SetPriorityClass(GetCurrentProcess(), IDLE_PRIORITY_CLASS);
    }
}

/// Handles `--guardia-barra <pid>` and `--ripristina-barra` before the app
/// starts; true when it did (the process then ends).
pub fn handle_args() -> bool {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some(GUARD_FLAG) => {
            if let Some(pid) = args.next().and_then(|p| p.parse().ok()) {
                run_guard(pid);
            }
            true
        }
        Some(RESTORE_FLAG) => {
            give_back();
            true
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_taskbar_yet_saves_no_false_state() {
        let file = env::temp_dir().join(format!("ei-taskbar-absent-{}", std::process::id()));
        assert!(!take_over_bars(&[], &file));
        assert!(!file.exists());
    }

    #[test]
    fn a_gone_taskbar_is_not_reported_hidden() {
        assert!(!set_ghost(HWND::default(), true));
    }

    #[test]
    fn ghost_is_verified_and_undone_on_a_test_window() {
        use windows::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, WS_POPUP};
        unsafe {
            let window = CreateWindowExW(Default::default(), w!("STATIC"), w!("EasyIsland taskbar test"), WS_POPUP, 0, 0, 1, 1, None, None, None, None).expect("test window");
            let hidden = set_ghost(window, true);
            let restored = set_ghost(window, false);
            let styles = GetWindowLongPtrW(window, GWL_EXSTYLE);
            let _ = DestroyWindow(window);
            assert!(hidden);
            assert!(restored);
            assert_eq!(styles & GHOST, 0);
        }
    }

    #[test]
    fn a_short_delay_does_not_give_the_taskbar_back() {
        let mut h = Health::default();
        for _ in 0..3 {
            assert!(!h.observe(false));
        }
        assert!(!h.observe(true));
        for _ in 0..3 {
            assert!(!h.observe(false));
        }
    }

    #[test]
    fn a_long_hang_gives_it_back_once_until_it_answers() {
        let mut h = Health::default();
        for _ in 0..3 {
            assert!(!h.observe(false));
        }
        assert!(h.observe(false));
        assert!(!h.observe(false));
        assert!(!h.observe(true));
        for _ in 0..3 {
            assert!(!h.observe(false));
        }
        assert!(h.observe(false));
    }
}
