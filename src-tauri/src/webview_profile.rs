// The WebView2 profile (%LOCALAPPDATA%\it.edoardo.easyisland\EBWebView) must
// be free before the island's window is created.
//
// After an update (the installer closes EasyIsland and starts the new version
// at once) or a crash, the old instance's WebView2 processes can live on for
// minutes holding the profile: the new window then fails with 0x800700AA
// ("resource in use"), Tauri panics in setup and the app closes before
// showing anything. Seen on two PCs updating to 0.7.4 (12 October 2026).
//
// So, before Tauri starts and only when no other EasyIsland is running (a
// running one owns its WebView2 processes, and single-instance hands the
// launch over to it): wait a little for the leftovers to go, then end them.
// Ended processes can still hang in their teardown for minutes, so if the
// profile is still held this run uses a spare one (`spare\EBWebView`), and the
// next start goes back to the usual one. Only processes whose command line
// names one of our profiles are touched.

use std::ffi::c_void;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    OpenProcess, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
};

/// The usual profile and the spare one, as they appear (lower case) in a command line.
const USUAL: &str = r"it.edoardo.easyisland\ebwebview";
const SPARE: &str = r"it.edoardo.easyisland\spare\ebwebview";

/// Our WebView2 data, where Tauri puts it (WebView2 adds `EBWebView` inside).
fn data_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    base.join("it.edoardo.easyisland")
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtQueryInformationProcess(process: HANDLE, class: u32, info: *mut c_void, len: u32, ret: *mut u32) -> i32;
}

/// ProcessCommandLineInformation (Windows 8.1+).
const COMMAND_LINE: u32 = 60;

/// (pid, exe in lower case) of every process.
fn processes() -> Vec<(u32, String)> {
    let mut out = Vec::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snap, &mut e).is_ok();
        while ok {
            let len = e.szExeFile.iter().position(|c| *c == 0).unwrap_or(e.szExeFile.len());
            out.push((e.th32ProcessID, String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase()));
            ok = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    out
}

/// The command line of `pid`, if we may read it.
fn command_line(pid: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = vec![0u8; 64 * 1024];
        let mut ret = 0u32;
        let status = NtQueryInformationProcess(process, COMMAND_LINE, buf.as_mut_ptr().cast(), buf.len() as u32, &mut ret);
        let _ = CloseHandle(process);
        if status < 0 {
            return None;
        }
        // A UNICODE_STRING { Length, MaximumLength, Buffer } pointing into `buf`.
        let len = u16::from_le_bytes([buf[0], buf[1]]) as usize / 2;
        let ptr = *(buf.as_ptr().add(8) as *const *const u16);
        if ptr.is_null() || len == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len)))
    }
}

/// The WebView2 processes still running on `profile`.
fn leftovers(profile: &str) -> Vec<u32> {
    processes()
        .into_iter()
        .filter(|(_, exe)| exe == "msedgewebview2.exe")
        .filter(|(pid, _)| command_line(*pid).is_some_and(|c| c.to_lowercase().contains(profile)))
        .map(|(pid, _)| pid)
        .collect()
}

fn wait_gone(profile: &str, limit: Duration) -> Vec<u32> {
    let start = Instant::now();
    loop {
        let left = leftovers(profile);
        if left.is_empty() || start.elapsed() >= limit {
            return left;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// Waits for, then ends, what a previous instance left on `profile`. True when it is free.
fn release(profile: &str) -> bool {
    let left = leftovers(profile);
    if left.is_empty() {
        return true;
    }
    crate::log::line(format!("webview: {} WebView2 processes of a previous instance on {profile}, waiting", left.len()));
    let left = wait_gone(profile, Duration::from_secs(6));
    if left.is_empty() {
        return true;
    }
    for pid in &left {
        unsafe {
            if let Ok(p) = OpenProcess(PROCESS_TERMINATE, false, *pid) {
                let _ = TerminateProcess(p, 1);
                let _ = CloseHandle(p);
            }
        }
    }
    let still = wait_gone(profile, Duration::from_secs(3));
    crate::log::line(format!("webview: ended {} leftover processes, {} still closing", left.len(), still.len()));
    still.is_empty()
}

/// Before Tauri starts: the WebView2 data directory for this run, None for
/// Tauri's usual one. The spare one only while the usual one is still held.
pub fn free() -> Option<PathBuf> {
    let me = std::process::id();
    if processes().iter().any(|(pid, exe)| exe == "easyisland.exe" && *pid != me) {
        return None;
    }
    if release(USUAL) {
        return None;
    }
    // The spare one may be held as well, by a run that used it and crashed.
    release(SPARE);
    crate::log::line("webview: profile still in use, this run uses the spare one");
    Some(data_dir().join("spare"))
}
