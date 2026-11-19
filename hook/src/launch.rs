// `easyisland-hook avvia`: opens an app, a file or a folder for the Dock in a
// throw-away process (docs/piano-dock.md). The shell can hang (slow
// extensions, DDE, progress windows): here it hangs this process, never the
// Dock. One JSON request on stdin, the outcome is the exit code: 0 done,
// 2 bad request, otherwise the HRESULT of ShellExecuteExW.
//
// {"op":"open","id":"<.exe/.lnk/file or shell:AppsFolder\AUMID>","args":"<optional, already quoted>"}
// {"op":"open_admin","id":"…"}                  (verb runas)
// {"op":"open_with","app":"<.exe>","files":["…"]} (each quoted, never a shell)
// {"op":"reveal","path":"…"}                    (explorer /select)
// {"op":"unpin","id":"…"}                       (Windows' own taskbarunpin verb)
//
// No window owner (an owner shell progress window would disable the Dock's
// input) and stderr inherited, never piped (the app opened inherits it).

use serde_json::Value;

const BAD: i32 = 2;
const MAX: usize = 64 * 1024;

/// What to hand to ShellExecuteExW.
#[derive(Debug, PartialEq)]
struct Shell {
    verb: Option<&'static str>,
    file: String,
    params: Option<String>,
}

pub fn run() -> i32 {
    use std::io::Read;
    let mut raw = String::new();
    if std::io::stdin().take(MAX as u64 + 1).read_to_string(&mut raw).is_err() || raw.len() > MAX {
        return BAD;
    }
    match parse(&raw) {
        Some(s) => execute(&s),
        None => BAD,
    }
}

fn parse(raw: &str) -> Option<Shell> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let o = v.as_object()?;
    let text = |k: &str| o.get(k).and_then(Value::as_str).filter(|s| !s.trim().is_empty() && !s.contains('\0')).map(str::to_string);
    let allowed: &[&str] = match o.get("op")?.as_str()? {
        "open" => &["op", "id", "args"],
        "open_admin" | "unpin" => &["op", "id"],
        "open_with" => &["op", "app", "files"],
        "reveal" => &["op", "path"],
        _ => return None,
    };
    if o.keys().any(|k| !allowed.contains(&k.as_str())) {
        return None;
    }
    Some(match o.get("op")?.as_str()? {
        "open" => {
            let params = match o.get("args") {
                None => None,
                Some(a) => {
                    let a = a.as_str()?;
                    if a.contains('\0') {
                        return None;
                    }
                    Some(a.to_string()).filter(|a| !a.is_empty())
                }
            };
            Shell { verb: None, file: text("id")?, params }
        }
        "open_admin" => Shell { verb: Some("runas"), file: text("id")?, params: None },
        "unpin" => Shell { verb: Some("taskbarunpin"), file: text("id")?, params: None },
        "open_with" => {
            let files = o.get("files")?.as_array()?;
            let mut quoted = Vec::new();
            for f in files {
                let f = f.as_str()?;
                // A quote would end the argument: never passed on.
                if f.is_empty() || f.contains('"') || f.contains('\0') {
                    return None;
                }
                quoted.push(format!("\"{f}\""));
            }
            Shell { verb: None, file: text("app")?, params: Some(quoted.join(" ")).filter(|p| !p.is_empty()) }
        }
        "reveal" => {
            let path = text("path")?;
            if path.contains('"') {
                return None;
            }
            Shell { verb: None, file: "explorer.exe".into(), params: Some(format!("/select,\"{path}\"")) }
        }
        _ => return None,
    })
}

#[cfg(windows)]
fn execute(s: &Shell) -> i32 {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let verb = s.verb.map(HSTRING::from);
    let file = HSTRING::from(s.file.as_str());
    let params = s.params.as_deref().map(HSTRING::from);
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOASYNC,
            lpVerb: verb.as_ref().map_or(PCWSTR::null(), |v| PCWSTR(v.as_ptr())),
            lpFile: PCWSTR(file.as_ptr()),
            lpParameters: params.as_ref().map_or(PCWSTR::null(), |p| PCWSTR(p.as_ptr())),
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };
        match ShellExecuteExW(&mut info) {
            Ok(()) => 0,
            Err(e) => match e.code().0 {
                0 => 1,
                c => c,
            },
        }
    }
}

#[cfg(not(windows))]
fn execute(_: &Shell) -> i32 {
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_become_shell_calls() {
        assert_eq!(parse(r#"{"op":"open","id":"C:\\a.exe"}"#), Some(Shell { verb: None, file: "C:\\a.exe".into(), params: None }));
        assert_eq!(parse(r#"{"op":"open","id":"x.lnk","args":"--new-window"}"#).unwrap().params.as_deref(), Some("--new-window"));
        assert_eq!(parse(r#"{"op":"open_admin","id":"a.exe"}"#).unwrap().verb, Some("runas"));
        assert_eq!(parse(r#"{"op":"unpin","id":"a.lnk"}"#).unwrap().verb, Some("taskbarunpin"));
        assert_eq!(parse(r#"{"op":"open_with","app":"w.exe","files":["C:\\a b.txt","c.txt"]}"#).unwrap().params.as_deref(), Some("\"C:\\a b.txt\" \"c.txt\""));
        assert_eq!(parse(r#"{"op":"reveal","path":"C:\\a b"}"#).unwrap().params.as_deref(), Some("/select,\"C:\\a b\""));
    }

    #[test]
    fn bad_requests_are_refused() {
        for raw in [
            "",
            "[]",
            r#"{"op":"run","id":"a"}"#,
            r#"{"op":"open"}"#,
            r#"{"op":"open","id":"  "}"#,
            r#"{"op":"open","id":"a","extra":1}"#,
            r#"{"op":"open_admin","id":"a","args":"x"}"#,
            r#"{"op":"open_with","app":"w.exe","files":["a\" & calc"]}"#,
            r#"{"op":"reveal","path":"a\" /x"}"#,
        ] {
            assert_eq!(parse(raw), None, "{raw}");
        }
    }
}
