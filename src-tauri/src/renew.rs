// Renewing Claude Code's login, for the plan limits (usage.rs).
//
// The login in %USERPROFILE%\.claude\.credentials.json lasts about 8 hours and
// only an interactive Claude Code renews it: the Claude desktop app does not,
// nor `claude auth status`; `claude -p` does, but goes through the model and
// costs plan. A `/usage` typed in a terminal did (12 October 2026). So, with
// the login expired, EasyIsland starts `claude` as a terminal would, in a
// pseudo console (ConPTY) nobody sees, in a folder Claude Code already trusts,
// types `/usage`, and closes it as soon as the file is renewed, or after the
// timeout. No prompt is sent, so nothing goes through the model. EasyIsland
// still only reads the file; Claude Code is the one that writes it.
//
// The process tree runs in a job object that kills it when closed, so neither
// `cmd` (npm's claude.cmd) nor node outlives the attempt. Hooks are off for it
// (`disableAllHooks`, and EASYISLAND_INTERNAL for our relay): it never shows
// up in the island as a session.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::Value;

/// A folder where Claude Code's "Do you trust the files in this folder?" was
/// already answered (~/.claude.json, read only): elsewhere the dialog would
/// take the keys typed below. `None` when there is none.
pub fn trusted_folder() -> Option<PathBuf> {
    let home = PathBuf::from(std::env::var_os("USERPROFILE")?);
    let bytes = std::fs::read(home.join(".claude.json")).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    let mut found: Vec<PathBuf> = trusted_in(&v).into_iter().filter(|p| p.is_dir()).collect();
    // A local folder of the user's first: a synced or network drive may be slow.
    found.sort_by_key(|p| !is_local_home(p, &home));
    found.into_iter().next()
}

fn is_local_home(p: &Path, home: &Path) -> bool {
    let norm = |p: &Path| p.to_string_lossy().replace('/', "\\").to_lowercase();
    let (p, home) = (norm(p), norm(home));
    p.starts_with(&home) && !p.contains("\\appdata\\")
}

fn trusted_in(config: &Value) -> Vec<PathBuf> {
    config
        .get("projects")
        .and_then(Value::as_object)
        .map(|projects| {
            projects
                .iter()
                .filter(|(_, p)| p.get("hasTrustDialogAccepted").and_then(Value::as_bool) == Some(true))
                .map(|(dir, _)| PathBuf::from(dir))
                .collect()
        })
        .unwrap_or_default()
}

/// The command line for `exe`: a .cmd or .bat goes through cmd.exe.
fn command_line(exe: &Path, settings: &Path) -> String {
    let s = format!("\"{}\" --settings \"{}\"", exe.display(), settings.display());
    let script = exe
        .extension()
        .map(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
        .unwrap_or(false);
    if script { format!("cmd.exe /d /c \"{s}\"") } else { s }
}

/// Starts Claude Code hidden in a trusted folder (`/usage` typed) or, without
/// one, in the home folder (nothing typed: the trust dialog would take it), and
/// waits until `done()` (the login is valid again) or `timeout`. True when
/// `done()` came true. Blocking: call from a blocking thread.
pub fn renew(exe: &Path, timeout: Duration, done: impl Fn() -> bool) -> bool {
    let trusted = trusted_folder();
    let Some(cwd) = trusted.clone().or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from)) else {
        return false;
    };
    let type_usage = trusted.is_some();
    let settings = crate::settings::local_dir().join("renew-settings.json");
    if std::fs::write(&settings, br#"{"disableAllHooks":true}"#).is_err() {
        return false;
    }
    #[cfg(windows)]
    {
        win::run(&command_line(exe, &settings), &cwd, type_usage, timeout, done)
    }
    #[cfg(not(windows))]
    {
        let _ = (cwd, type_usage, timeout, done);
        false
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::ffi::c_void;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
    use windows::Win32::Storage::FileSystem::{ReadFile, WriteFile};
    use windows::Win32::System::Console::{ClosePseudoConsole, CreatePseudoConsole, COORD, HPCON};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Pipes::CreatePipe;
    use windows::Win32::System::Threading::{
        CreateProcessW, DeleteProcThreadAttributeList, InitializeProcThreadAttributeList, ResumeThread,
        UpdateProcThreadAttribute, WaitForSingleObject, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT,
        EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION,
        PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, STARTF_USESTDHANDLES, STARTUPINFOEXW,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// This process's environment, without the variables that would tie the
    /// copy to a Claude Code session EasyIsland was started from, plus
    /// EASYISLAND_INTERNAL. A double-NUL-terminated UTF-16 block.
    fn environment() -> Vec<u16> {
        let mut block = Vec::new();
        for (k, v) in std::env::vars_os() {
            let k = k.to_string_lossy();
            if k == "EASYISLAND_INTERNAL" || crate::claude_cli::INHERITED_SESSION_VARS.iter().any(|x| x.eq_ignore_ascii_case(&k)) {
                continue;
            }
            block.extend(format!("{k}={}", v.to_string_lossy()).encode_utf16());
            block.push(0);
        }
        block.extend("EASYISLAND_INTERNAL=1".encode_utf16());
        block.extend([0, 0]);
        block
    }

    /// Handles closed on drop, in reverse order of creation.
    struct Owned(Vec<HANDLE>);
    impl Drop for Owned {
        fn drop(&mut self) {
            for h in self.0.drain(..).rev() {
                if !h.is_invalid() {
                    let _ = unsafe { CloseHandle(h) };
                }
            }
        }
    }

    pub fn run(cmdline: &str, cwd: &Path, type_usage: bool, timeout: Duration, done: impl Fn() -> bool) -> bool {
        unsafe {
            // in: we write → the console reads; out: the console writes → we read.
            let (mut in_read, mut in_write, mut out_read, mut out_write) =
                (HANDLE::default(), HANDLE::default(), HANDLE::default(), HANDLE::default());
            if CreatePipe(&mut in_read, &mut in_write, None, 0).is_err() {
                return false;
            }
            if CreatePipe(&mut out_read, &mut out_write, None, 0).is_err() {
                let _ = CloseHandle(in_read);
                let _ = CloseHandle(in_write);
                return false;
            }
            let pc: HPCON = match CreatePseudoConsole(COORD { X: 120, Y: 30 }, in_read, out_write, 0) {
                Ok(pc) => pc,
                Err(_) => {
                    for h in [in_read, in_write, out_read, out_write] {
                        let _ = CloseHandle(h);
                    }
                    return false;
                }
            };
            // The console holds its own copies.
            let _ = CloseHandle(in_read);
            let _ = CloseHandle(out_write);
            let pipes = Owned(vec![in_write]);

            // Whatever Claude Code draws is read and thrown away: a full pipe
            // would stop it. The thread ends when the console closes.
            let out = out_read.0 as isize;
            std::thread::spawn(move || {
                let h = HANDLE(out as *mut c_void);
                let mut buf = [0u8; 4096];
                loop {
                    let mut n = 0u32;
                    if ReadFile(h, Some(&mut buf), Some(&mut n), None).is_err() || n == 0 {
                        break;
                    }
                }
                let _ = CloseHandle(h);
            });

            let renewed = spawn_and_wait(pc, &pipes, cmdline, cwd, type_usage, timeout, &done);
            ClosePseudoConsole(pc);
            drop(pipes);
            renewed
        }
    }

    unsafe fn spawn_and_wait(
        pc: HPCON,
        pipes: &Owned,
        cmdline: &str,
        cwd: &Path,
        type_usage: bool,
        timeout: Duration,
        done: &dyn Fn() -> bool,
    ) -> bool {
        let mut size = 0usize;
        let _ = InitializeProcThreadAttributeList(None, 1, None, &mut size);
        let mut list_buf = vec![0u8; size.max(64)];
        let list = LPPROC_THREAD_ATTRIBUTE_LIST(list_buf.as_mut_ptr() as *mut c_void);
        if InitializeProcThreadAttributeList(Some(list), 1, None, &mut size).is_err() {
            return false;
        }
        let ok = UpdateProcThreadAttribute(
            list,
            0,
            PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
            Some(pc.0 as *const c_void),
            std::mem::size_of::<HPCON>(),
            None,
            None,
        );
        if ok.is_err() {
            DeleteProcThreadAttributeList(list);
            return false;
        }
        let mut si = STARTUPINFOEXW::default();
        si.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
        si.lpAttributeList = list;
        // No standard handles of ours: with redirected ones (a parent's pipes)
        // Claude Code would write there and see no terminal.
        si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;

        let job = match CreateJobObjectW(None, PCWSTR::null()) {
            Ok(j) => j,
            Err(_) => {
                DeleteProcThreadAttributeList(list);
                return false;
            }
        };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let _ = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        let job = Owned(vec![job]);

        let mut cmd = wide(cmdline);
        let dir = wide(&cwd.to_string_lossy());
        let env = environment();
        let mut pi = PROCESS_INFORMATION::default();
        let started = CreateProcessW(
            PCWSTR::null(),
            Some(PWSTR(cmd.as_mut_ptr())),
            None,
            None,
            false,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED,
            Some(env.as_ptr() as *const c_void),
            PCWSTR(dir.as_ptr()),
            &si.StartupInfo,
            &mut pi,
        );
        DeleteProcThreadAttributeList(list);
        if started.is_err() {
            return false;
        }
        let process = Owned(vec![pi.hProcess, pi.hThread]);
        if AssignProcessToJobObject(job.0[0], pi.hProcess).is_err() {
            let _ = windows::Win32::System::Threading::TerminateProcess(pi.hProcess, 1);
            return false;
        }
        ResumeThread(pi.hThread);

        let write = |text: &[u8]| {
            let mut n = 0u32;
            let _ = WriteFile(pipes.0[0], Some(text), Some(&mut n), None);
        };
        let start = Instant::now();
        let (mut typed, mut entered) = (false, false);
        let renewed = loop {
            if done() {
                break true;
            }
            if WaitForSingleObject(pi.hProcess, 0) == WAIT_OBJECT_0 || start.elapsed() >= timeout {
                break done();
            }
            // Claude Code starts in a few seconds; Enter goes apart from the
            // text, or it would be taken as part of a paste.
            let t = start.elapsed();
            if type_usage && !typed && t >= Duration::from_secs(6) {
                write(b"/usage");
                typed = true;
            } else if typed && !entered && t >= Duration::from_secs(7) {
                write(b"\r");
                entered = true;
            }
            std::thread::sleep(Duration::from_millis(500));
        };
        // Closing the job ends cmd, node and anything they started.
        let _ = TerminateJobObject(job.0[0], 0);
        drop(process);
        drop(job);
        renewed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_trusted_folders() {
        let v: Value = serde_json::from_str(
            r#"{"projects":{"C:/a":{"hasTrustDialogAccepted":true},"C:/b":{"hasTrustDialogAccepted":false},"C:/c":{}}}"#,
        )
        .unwrap();
        assert_eq!(trusted_in(&v), vec![PathBuf::from("C:/a")]);
        assert!(trusted_in(&serde_json::json!({})).is_empty());
        assert!(trusted_in(&serde_json::json!({"projects": 3})).is_empty());
    }

    /// Starts the real Claude Code hidden for a few seconds and closes it:
    /// `cargo test -- --ignored starts_and_closes_claude`.
    #[test]
    #[ignore]
    fn starts_and_closes_claude() {
        let exe = crate::claude_cli::find_claude().expect("claude");
        let start = Instant::now();
        let renewed = renew(&exe, Duration::from_secs(12), || false);
        // Still running when the timeout came: it started and was closed.
        assert!(!renewed);
        assert!(start.elapsed() >= Duration::from_secs(12), "Claude Code exited at once");
    }

    #[test]
    fn local_folders_first() {
        let home = Path::new("C:\\Users\\E");
        assert!(is_local_home(Path::new("C:/Users/E/WORK/x"), home));
        assert!(!is_local_home(Path::new("G:/Drive/x"), home));
        assert!(!is_local_home(Path::new("C:/Users/E/AppData/Roaming/x"), home));
    }

    #[test]
    fn scripts_go_through_cmd() {
        let s = Path::new("C:/x/s.json");
        assert_eq!(command_line(Path::new("C:/n/claude.cmd"), s), "cmd.exe /d /c \"\"C:/n/claude.cmd\" --settings \"C:/x/s.json\"\"");
        assert_eq!(command_line(Path::new("C:/n/claude.exe"), s), "\"C:/n/claude.exe\" --settings \"C:/x/s.json\"");
    }
}
