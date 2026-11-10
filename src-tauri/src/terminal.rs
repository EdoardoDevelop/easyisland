// «Terminale» in the chat (8 Nov 2026, as Claude Desktop's terminal beside
// the conversation): a PowerShell of the user's, in the chat's project folder.
// What runs there is what the user types, as in any terminal: never a command
// of an engine (those stay on Consenti / Nega).
//
// A real console since 9 Nov 2026 (asked by Edoardo): Windows' pseudo
// console (ConPTY) runs the shell, its raw output (VT sequences: colours,
// cursor, full-screen programs) goes to the chat as `terminal-out` events and
// is drawn there by xterm.js; the keys come back raw (`write`), and the size
// follows the panel (`resize`). Editors, Ctrl+C, Tab, arrows, passwords work.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter};

use crate::i18n::{t, tf};

#[cfg(windows)]
use windows::Win32::{
    Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
    Storage::FileSystem::{ReadFile, WriteFile},
    System::Console::{ClosePseudoConsole, CreatePseudoConsole, ResizePseudoConsole, COORD, HPCON},
    System::Pipes::CreatePipe,
    System::Threading::{
        CreateProcessW, DeleteProcThreadAttributeList, InitializeProcThreadAttributeList, UpdateProcThreadAttribute, WaitForSingleObject,
        EXTENDED_STARTUPINFO_PRESENT, INFINITE, LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
        STARTF_USESTDHANDLES, STARTUPINFOEXW,
    },
};

/// One shell: its pseudo console, the pipe its keys go into, its process id.
#[cfg(windows)]
struct Shell {
    hpc: HPCON,
    input: HANDLE,
    pid: u32,
}

// The handles are plain kernel handles, used under SHELLS' lock only.
#[cfg(windows)]
unsafe impl Send for Shell {}

#[cfg(windows)]
struct Sendable(HANDLE);
#[cfg(windows)]
unsafe impl Send for Sendable {}

#[cfg(windows)]
static SHELLS: Mutex<Option<HashMap<u32, Shell>>> = Mutex::new(None);
static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

#[cfg(windows)]
fn with<R>(f: impl FnOnce(&mut HashMap<u32, Shell>) -> R) -> R {
    let mut g = SHELLS.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(HashMap::new))
}

fn size(cols: u16, rows: u16) -> (i16, i16) {
    (cols.clamp(10, 500) as i16, rows.clamp(3, 300) as i16)
}

/// The shell: PowerShell 7 when it is installed, else Windows PowerShell.
#[cfg(windows)]
fn shell_exe() -> String {
    let found = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join("pwsh.exe").is_file()))
        .unwrap_or(false);
    if found { "pwsh.exe".into() } else { "powershell.exe".into() }
}

/// Where a shell's output goes: `(id, text, closed)`.
type Sink = std::sync::Arc<dyn Fn(u32, String, bool) + Send + Sync>;

/// A new shell in `folder` (the user's folder when it is not there), `cols`×`rows`; its id.
/// Its output goes to the chat as `terminal-out` events.
#[cfg(windows)]
pub fn open(app: &AppHandle, folder: Option<&str>, cols: u16, rows: u16) -> Result<u32, String> {
    let app = app.clone();
    spawn(
        folder,
        cols,
        rows,
        std::sync::Arc::new(move |id, data, closed| {
            let _ = app.emit_to(crate::island::WINDOW_LABEL, "terminal-out", serde_json::json!({ "id": id, "data": data, "closed": closed }));
        }),
    )
}

#[cfg(windows)]
fn spawn(folder: Option<&str>, cols: u16, rows: u16, sink: Sink) -> Result<u32, String> {
    use windows::core::{PCWSTR, PWSTR};

    let dir = folder.map(std::path::PathBuf::from).filter(|d| d.is_dir()).or_else(|| std::env::var_os("USERPROFILE").map(std::path::PathBuf::from));
    let fail = |e: windows::core::Error| tf("Il terminale non si avvia: {e}", &[("e", &e.message())]);
    let (c, r) = size(cols, rows);
    unsafe {
        // Two pipes: keys into the console, its output out of it.
        let (mut in_read, mut in_write, mut out_read, mut out_write) = (HANDLE::default(), HANDLE::default(), HANDLE::default(), HANDLE::default());
        CreatePipe(&mut in_read, &mut in_write, None, 0).map_err(fail)?;
        if let Err(e) = CreatePipe(&mut out_read, &mut out_write, None, 0) {
            let _ = CloseHandle(in_read);
            let _ = CloseHandle(in_write);
            return Err(fail(e));
        }
        let hpc = match CreatePseudoConsole(COORD { X: c, Y: r }, in_read, out_write, 0) {
            Ok(h) => h,
            Err(e) => {
                for h in [in_read, in_write, out_read, out_write] {
                    let _ = CloseHandle(h);
                }
                return Err(fail(e));
            }
        };
        // The console holds its own copies of these ends.
        let _ = CloseHandle(in_read);
        let _ = CloseHandle(out_write);

        // The process attached to the pseudo console.
        let mut bytes = 0usize;
        let _ = InitializeProcThreadAttributeList(None, 1, None, &mut bytes);
        let mut list = vec![0u8; bytes.max(64)];
        let attrs = LPPROC_THREAD_ATTRIBUTE_LIST(list.as_mut_ptr().cast());
        let started = (|| -> windows::core::Result<PROCESS_INFORMATION> {
            InitializeProcThreadAttributeList(Some(attrs), 1, None, &mut bytes)?;
            UpdateProcThreadAttribute(
                attrs,
                0,
                PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
                Some(hpc.0 as *const core::ffi::c_void),
                std::mem::size_of::<HPCON>(),
                None,
                None,
            )?;
            let mut si = STARTUPINFOEXW::default();
            si.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
            si.lpAttributeList = attrs;
            // Never the app's own standard handles (redirected in a GUI app or a test):
            // with them the shell read and wrote there instead of the console and ended at once.
            si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            si.StartupInfo.hStdInput = INVALID_HANDLE_VALUE;
            si.StartupInfo.hStdOutput = INVALID_HANDLE_VALUE;
            si.StartupInfo.hStdError = INVALID_HANDLE_VALUE;
            let mut cmd: Vec<u16> = format!("{} -NoLogo", shell_exe()).encode_utf16().chain(std::iter::once(0)).collect();
            let cwd: Option<Vec<u16>> = dir.as_ref().map(|d| d.as_os_str().to_string_lossy().encode_utf16().chain(std::iter::once(0)).collect());
            let mut pi = PROCESS_INFORMATION::default();
            CreateProcessW(
                PCWSTR::null(),
                Some(PWSTR(cmd.as_mut_ptr())),
                None,
                None,
                false,
                EXTENDED_STARTUPINFO_PRESENT,
                None,
                cwd.as_ref().map(|w| PCWSTR(w.as_ptr())).unwrap_or(PCWSTR::null()),
                &si.StartupInfo,
                &mut pi,
            )?;
            Ok(pi)
        })();
        DeleteProcThreadAttributeList(attrs);
        let pi = match started {
            Ok(pi) => pi,
            Err(e) => {
                ClosePseudoConsole(hpc);
                let _ = CloseHandle(in_write);
                let _ = CloseHandle(out_read);
                return Err(fail(e));
            }
        };
        let _ = CloseHandle(pi.hThread);

        let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        // Its output, as it comes; a UTF-8 character cut between two reads waits for its end.
        let out = Sendable(out_read);
        let reader_sink = sink.clone();
        std::thread::spawn(move || {
            let out = out;
            let mut buf = vec![0u8; 16 * 1024];
            let mut carry: Vec<u8> = Vec::new();
            loop {
                let mut n = 0u32;
                if ReadFile(out.0, Some(&mut buf), Some(&mut n), None).is_err() || n == 0 {
                    break;
                }
                carry.extend_from_slice(buf.get(..n as usize).unwrap_or(&[]));
                let cut = match std::str::from_utf8(&carry) {
                    Ok(_) => carry.len(),
                    Err(e) if e.error_len().is_none() => e.valid_up_to(),
                    Err(_) => carry.len(),
                };
                let text = String::from_utf8_lossy(carry.get(..cut).unwrap_or(&[])).into_owned();
                carry.drain(..cut);
                if !text.is_empty() {
                    reader_sink(id, text, false);
                }
            }
            let _ = CloseHandle(out.0);
        });
        // The shell ended (exit, or closed from here): the panel says so, the console goes.
        let proc_wait = Sendable(pi.hProcess);
        let exit_sink = sink;
        std::thread::spawn(move || {
            let p = proc_wait;
            // This thread owns the process handle: closed here, after the wait.
            WaitForSingleObject(p.0, INFINITE);
            let _ = CloseHandle(p.0);
            let was_open = with(|all| all.contains_key(&id));
            close(Some(id));
            if was_open {
                exit_sink(id, format!("\r\n\x1b[2m{}\x1b[0m\r\n", t("[PowerShell si è chiuso]")), true);
            }
        });
        with(|all| all.insert(id, Shell { hpc, input: in_write, pid: pi.dwProcessId }));
        crate::log::line(format!("terminale {id} aperto in {}", dir.map(|d| d.display().to_string()).unwrap_or_default()));
        Ok(id)
    }
}

#[cfg(not(windows))]
pub fn open(_app: &AppHandle, _folder: Option<&str>, _cols: u16, _rows: u16) -> Result<u32, String> {
    Err(t("Il terminale c'è solo su Windows.").to_string())
}

/// What the user typed (keys, pasted text), raw.
#[cfg(windows)]
pub fn write(id: u32, data: &str) -> Result<(), String> {
    with(|all| {
        let s = all.get(&id).ok_or_else(|| t("Il terminale si è chiuso: aprine un altro.").to_string())?;
        let mut left = data.as_bytes();
        while !left.is_empty() {
            let mut n = 0u32;
            unsafe { WriteFile(s.input, Some(left), Some(&mut n), None) }.map_err(|_| t("Il terminale si è chiuso: aprine un altro.").to_string())?;
            if n == 0 {
                break;
            }
            left = left.get(n as usize..).unwrap_or(&[]);
        }
        Ok(())
    })
}

#[cfg(not(windows))]
pub fn write(_id: u32, _data: &str) -> Result<(), String> {
    Err(t("Il terminale c'è solo su Windows.").to_string())
}

/// The panel changed size: the console follows (programs redraw to it).
#[cfg(windows)]
pub fn resize(id: u32, cols: u16, rows: u16) {
    let (c, r) = size(cols, rows);
    with(|all| {
        if let Some(s) = all.get(&id) {
            let _ = unsafe { ResizePseudoConsole(s.hpc, COORD { X: c, Y: r }) };
        }
    });
}

#[cfg(not(windows))]
pub fn resize(_id: u32, _cols: u16, _rows: u16) {}

/// «✕» on the panel, «Riavvia», the shell's own exit, the app's exit (None = all).
#[cfg(windows)]
pub fn close(id: Option<u32>) {
    let gone: Vec<Shell> = with(|all| {
        let ids: Vec<u32> = match id {
            Some(i) => vec![i],
            None => all.keys().copied().collect(),
        };
        ids.into_iter().filter_map(|i| all.remove(&i)).collect()
    });
    for s in gone {
        // The shell and what it started, then the console (its output pipe ends, the reader stops).
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill").args(["/PID", &s.pid.to_string(), "/T", "/F"]).creation_flags(0x0800_0000).output();
        }
        unsafe {
            let _ = CloseHandle(s.input);
            ClosePseudoConsole(s.hpc);
        }
    }
}

#[cfg(not(windows))]
pub fn close(_id: Option<u32>) {}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex as M};
    use std::time::{Duration, Instant};

    /// A real shell in the pseudo console: a command typed raw comes back
    /// through the console, the size can change, closing ends it.
    #[test]
    fn real_console_round_trip() {
        let seen = Arc::new(M::new(String::new()));
        let closed = Arc::new(M::new(false));
        let (s2, c2) = (seen.clone(), closed.clone());
        // A folder of its own: the hooks test points USERPROFILE elsewhere for a while.
        let folder = std::env::temp_dir().to_string_lossy().into_owned();
        let id = spawn(Some(&folder), 100, 30, Arc::new(move |_, text, done| {
            s2.lock().unwrap().push_str(&text);
            if done {
                *c2.lock().unwrap() = true;
            }
        }))
        .expect("shell starts");
        let wait = |what: &dyn Fn() -> bool| {
            let t0 = Instant::now();
            while !what() && t0.elapsed() < Duration::from_secs(30) {
                std::thread::sleep(Duration::from_millis(100));
            }
            what()
        };
        // The prompt shows up (PS ...>).
        assert!(wait(&|| seen.lock().unwrap().contains("PS ")), "no prompt: {:?}", seen.lock().unwrap());
        write(id, "Write-Output ('EASY'+'ISLAND')\r").expect("write");
        assert!(wait(&|| seen.lock().unwrap().contains("EASYISLAND")), "no output: {:?}", seen.lock().unwrap());
        resize(id, 60, 20);
        // `exit` typed in it: the shell ends and says so.
        write(id, "exit\r").ok();
        assert!(wait(&|| *closed.lock().unwrap()), "not closed");
        assert!(write(id, "x").is_err());
    }
}
