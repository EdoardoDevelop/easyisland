//! The little bit of Win32 the relay needs: who we are, and who is on the other
//! end of the pipe.
//!
//! Named pipes live in a machine-wide namespace, so `\\.\pipe\easyisland-<name>` can
//! be created by *any* account that gets there first. Two defences, both cheap:
//! the pipe name carries our SID, and once connected we check the server process
//! really belongs to us before sending anything.

use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, LocalFree, HLOCAL};
use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
use windows::Win32::System::Pipes::GetNamedPipeServerProcessId;
use windows::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
};

/// Shells and launchers between an agent and its hook: skipped on the way up.
const SHELLS: &[&str] = &[
    "bash.exe", "sh.exe", "dash.exe", "zsh.exe", "cmd.exe", "powershell.exe", "pwsh.exe", "conhost.exe",
    "easyisland-hook.exe", "env.exe", "winpty-agent.exe",
];

/// The agent that runs this hook (Claude Code, Codex…): the first ancestor that
/// is not a shell, as (pid, "claude.exe"). The island checks now and then that
/// it is still running, so a session closed without SessionEnd does not stay
/// "at work" for ever.
pub fn agent_process() -> Option<(u32, String)> {
    use std::collections::HashMap;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    let mut parents: HashMap<u32, (u32, String)> = HashMap::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snap, &mut e).is_ok();
        while ok {
            let len = e.szExeFile.iter().position(|c| *c == 0).unwrap_or(e.szExeFile.len());
            let exe = String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase();
            parents.insert(e.th32ProcessID, (e.th32ParentProcessID, exe));
            ok = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    ancestor(std::process::id(), &parents)
}

/// The walk of `agent_process`, apart so it can be tested.
fn ancestor(me: u32, parents: &std::collections::HashMap<u32, (u32, String)>) -> Option<(u32, String)> {
    let mut pid = parents.get(&me)?.0;
    for _ in 0..8 {
        let (parent, exe) = parents.get(&pid)?;
        if !SHELLS.contains(&exe.as_str()) {
            return Some((pid, exe.clone()));
        }
        if *parent == pid || *parent == 0 {
            return None;
        }
        pid = *parent;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_agent_is_the_first_ancestor_that_is_not_a_shell() {
        let p: std::collections::HashMap<u32, (u32, String)> = [
            (10, (9, "easyisland-hook.exe".to_string())),
            (9, (8, "bash.exe".to_string())),
            (8, (7, "claude.exe".to_string())),
            (7, (1, "windowsterminal.exe".to_string())),
        ]
        .into_iter()
        .collect();
        assert_eq!(ancestor(10, &p), Some((8, "claude.exe".to_string())));
        let orphan: std::collections::HashMap<u32, (u32, String)> =
            [(10, (9, "easyisland-hook.exe".to_string())), (9, (5, "bash.exe".to_string()))].into_iter().collect();
        assert_eq!(ancestor(10, &orphan), None);
    }
}

/// The SID of the account this process runs as, as `S-1-5-21-…`.
pub fn current_user_sid() -> Option<String> {
    unsafe { token_sid(GetCurrentProcess()) }
}

/// True when the process serving `handle` runs as the same user we do.
///
/// A failure to answer is treated as "not ours": refusing to talk to a pipe we
/// cannot vouch for costs one hook event, while trusting it could hand another
/// account on this machine the contents of every tool call.
pub fn pipe_server_is_same_user(handle: HANDLE) -> bool {
    let Some(mine) = current_user_sid() else { return false };
    unsafe {
        let mut pid = 0u32;
        if GetNamedPipeServerProcessId(handle, &mut pid).is_err() || pid == 0 {
            return false;
        }
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return false;
        };
        let theirs = token_sid(process);
        let _ = CloseHandle(process);
        theirs.as_deref() == Some(mine.as_str())
    }
}

/// The user SID behind a process handle. `process` is borrowed, never closed.
unsafe fn token_sid(process: HANDLE) -> Option<String> {
    let mut token = HANDLE::default();
    OpenProcessToken(process, TOKEN_QUERY, &mut token).ok()?;

    // First call sizes the buffer, second fills it.
    let mut needed = 0u32;
    let _ = GetTokenInformation(token, TokenUser, None, 0, &mut needed);
    if needed == 0 {
        let _ = CloseHandle(token);
        return None;
    }
    let mut buf = vec![0u8; needed as usize];
    let ok = GetTokenInformation(
        token,
        TokenUser,
        Some(buf.as_mut_ptr().cast()),
        needed,
        &mut needed,
    )
    .is_ok();
    let _ = CloseHandle(token);
    if !ok {
        return None;
    }

    let user = &*(buf.as_ptr() as *const TOKEN_USER);
    let mut text = PWSTR::null();
    ConvertSidToStringSidW(user.User.Sid, &mut text).ok()?;
    let sid = text.to_string().ok();
    let _ = LocalFree(Some(HLOCAL(text.0 as *mut _)));
    sid
}
