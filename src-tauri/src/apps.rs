// "Apri": brings back the app a Claude Code session runs in — the Claude
// desktop app, VS Code, Windows Terminal or a console — instead of always
// opening the folder. The relay tells us where the session runs
// (CLAUDE_CODE_ENTRYPOINT, TERM_PROGRAM, WT_SESSION…); the island passes it here.

use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;

use windows::core::BOOL;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_MENU,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    SetForegroundWindow, ShowWindow, GW_OWNER, SW_RESTORE,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Process ids whose executable is one of `names` (lower case, e.g. "claude.exe").
pub fn pids_of(names: &[&str]) -> Vec<u32> {
    let mut out = Vec::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snap, &mut e).is_ok();
        while ok {
            let len = e.szExeFile.iter().position(|c| *c == 0).unwrap_or(e.szExeFile.len());
            let exe = String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase();
            if names.contains(&exe.as_str()) {
                out.push(e.th32ProcessID);
            }
            ok = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    out
}

struct Search {
    pids: Vec<u32>,
    found: Option<HWND>,
}

unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let search = &mut *(lparam.0 as *mut Search);
    // A real app window: visible, titled, not owned by another (no dialogs, no tool windows).
    if !IsWindowVisible(hwnd).as_bool() || GetWindowTextLengthW(hwnd) == 0 {
        return BOOL(1);
    }
    if GetWindow(hwnd, GW_OWNER).is_ok_and(|o| !o.is_invalid()) {
        return BOOL(1);
    }
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if search.pids.contains(&pid) {
        search.found = Some(hwnd);
        return BOOL(0);
    }
    BOOL(1)
}

/// The first main window of any of `names`.
fn find_window(names: &[&str]) -> Option<HWND> {
    let pids = pids_of(names);
    if pids.is_empty() {
        return None;
    }
    let mut search = Search { pids, found: None };
    unsafe {
        let _ = EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize));
    }
    search.found
}

/// Brings the first main window of any of `names` to the front. False if none is open.
pub fn focus_app(names: &[&str]) -> bool {
    let Some(hwnd) = find_window(names) else { return false };
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        // Windows only lets the app with the last input take the foreground. The
        // click on the island is ours, but the island never activates; a tapped
        // Alt is the documented-enough way to let SetForegroundWindow through.
        let key = |flags| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_MENU, dwFlags: flags, ..Default::default() } },
        };
        let _ = SendInput(&[key(Default::default()), key(KEYEVENTF_KEYUP)], std::mem::size_of::<INPUT>() as i32);
        SetForegroundWindow(hwnd).as_bool()
    }
}

/// VS Code's `code` launcher: on PATH, or where the installers put it.
pub fn find_vscode() -> Option<PathBuf> {
    if let Some(p) = crate::find_on_path("code") {
        return Some(p);
    }
    let mut candidates = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local).join(r"Programs\Microsoft VS Code\bin\code.cmd"));
    }
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(pf) = std::env::var_os(var) {
            candidates.push(PathBuf::from(pf).join(r"Microsoft VS Code\bin\code.cmd"));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// Opens `path` in VS Code (or just VS Code). The path goes in as one argument,
/// never through a shell.
pub fn open_vscode(path: Option<&str>) -> bool {
    let Some(code) = find_vscode() else { return false };
    let mut cmd = Command::new(code);
    if let Some(p) = path.filter(|p| !p.is_empty()) {
        cmd.arg(p);
    }
    cmd.creation_flags(CREATE_NO_WINDOW).spawn().is_ok()
}

/// `code -g <file>:<line>`: the diff view's ↗. Only an existing file given by
/// its full path; the argument goes over as one, no shell involved.
pub fn open_vscode_at(file: &str, line: u32) -> bool {
    let path = std::path::Path::new(file);
    if !path.is_absolute() || !path.is_file() {
        return false;
    }
    let Some(code) = find_vscode() else { return false };
    Command::new(code)
        .arg("-g")
        .arg(format!("{file}:{}", line.max(1)))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .is_ok()
}

fn open_folder(path: Option<&str>) -> bool {
    match path.filter(|p| !p.is_empty()) {
        Some(p) => Command::new("explorer").arg(p).spawn().is_ok(),
        None => false,
    }
}

/// Where a session runs, as the island knows it: "desktop" (Claude app),
/// "vscode", "wt" (Windows Terminal) or "terminal" (anything else).
/// Returns what was opened: "claude", "vscode", "terminal", "folder" or "".
pub fn open_session(host: &str, path: Option<&str>) -> &'static str {
    match host {
        "desktop" => {
            if focus_app(&["claude.exe"]) {
                return "claude";
            }
        }
        "vscode" => {
            if open_vscode(path) || focus_app(&["code.exe"]) {
                return "vscode";
            }
        }
        "wt" => {
            if focus_app(&["windowsterminal.exe"]) {
                return "terminal";
            }
        }
        // Claude Code in Cursor's terminal: Cursor's window, or Cursor on the folder.
        "cursor" => {
            if focus_app(&["cursor.exe"]) {
                return "cursor";
            }
            let launcher = crate::find_on_path("cursor").or_else(|| {
                std::env::var_os("LOCALAPPDATA")
                    .map(|l| PathBuf::from(l).join(r"Programs\cursor\resources\app\bin\cursor.cmd"))
                    .filter(|p| p.is_file())
            });
            if let Some(cursor) = launcher {
                let mut cmd = Command::new(cursor);
                if let Some(p) = path.filter(|p| !p.is_empty()) {
                    cmd.arg(p);
                }
                if cmd.creation_flags(CREATE_NO_WINDOW).spawn().is_ok() {
                    return "cursor";
                }
            }
        }
        _ => {
            // A plain console: its window belongs to the terminal host.
            if focus_app(&["windowsterminal.exe", "openconsole.exe", "conhost.exe"]) {
                return "terminal";
            }
        }
    }
    if open_vscode(path) {
        return "vscode";
    }
    if open_folder(path) {
        return "folder";
    }
    ""
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Finds this PC's Claude desktop window and VS Code, without focusing anything:
    /// `cargo test -p easyisland --lib live_apps -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_apps_are_found() {
        println!("Claude: {:?}", find_window(&["claude.exe"]));
        println!("VS Code launcher: {:?}", find_vscode());
        println!("Windows Terminal: {:?}", find_window(&["windowsterminal.exe"]));
    }
}