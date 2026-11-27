// A mail drafted in classic Outlook, never sent (Edoardo, 27 Nov 2026: «sistema
// tutto compreso il 6»; on the laptop the engines drafted mails with their own
// PowerShell 7, where GetActiveObject does not exist, and tried three times).
// Like todo.rs: Outlook's COM model in a short Windows PowerShell call, only
// when Outlook is already open; what the engine gives goes in as JSON in an
// environment variable, never inside the script. The mail is shown in its
// window with the user's signature: Invia is always the user's click, and
// nothing here can send (the script has no Send).

use std::time::Duration;

use serde_json::{json, Value};

use crate::i18n::{t, tf};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MAX_ATTACH: usize = 20;
const MAX_BODY: usize = 100_000;
const MAX_ADDRESSES: usize = 50;

/// Single quotes only inside: double quotes do not survive the command line.
/// `Display()` first: Outlook puts the signature in the HTML body, and the text
/// goes before it.
const SCRIPT: &str = r#"$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
try { $o=[Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') } catch { 'NOT_RUNNING'; exit 0 }
$a=$env:EI_MAIL | ConvertFrom-Json
$m=$o.CreateItem(0)
$m.To=[string]$a.to
if($a.cc){ $m.CC=[string]$a.cc }
if($a.bcc){ $m.BCC=[string]$a.bcc }
$m.Subject=[string]$a.subject
foreach($p in $a.files){ [void]$m.Attachments.Add([string]$p) }
$m.Display()
$sig=[string]$m.HTMLBody
$at=$sig.IndexOf('<body')
if($at -ge 0){ $end=$sig.IndexOf('>',$at); $m.HTMLBody=$sig.Substring(0,$end+1)+[string]$a.html+$sig.Substring($end+1) } else { $m.HTMLBody=[string]$a.html+$sig }
[pscustomobject]@{ok=$true;attachments=[int]$m.Attachments.Count} | ConvertTo-Json -Compress
"#;

/// Addresses from a string ("a@x.it; b@y.it") or a list; each checked loosely.
fn addresses(v: Option<&Value>) -> Result<Vec<String>, String> {
    let raw: Vec<String> = match v {
        Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).map(str::to_string).collect(),
        Some(Value::String(s)) => s.split([';', ',']).map(str::to_string).collect(),
        _ => Vec::new(),
    };
    let list: Vec<String> = raw.into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    if list.len() > MAX_ADDRESSES {
        return Err(tf("Troppi indirizzi: al massimo {n}.", &[("n", &MAX_ADDRESSES)]));
    }
    for a in &list {
        let ok = a.len() <= 254 && a.matches('@').count() == 1 && !a.chars().any(|c| c.is_whitespace() || matches!(c, '<' | '>' | '"' | '\'' | '`'))
            && a.split('@').nth(1).is_some_and(|d| d.contains('.') && !d.starts_with('.') && !d.ends_with('.'));
        if !ok {
            return Err(tf("Indirizzo non valido: «{a}».", &[("a", a)]));
        }
    }
    Ok(list)
}

/// The text as HTML: escaped, paragraphs and line breaks kept, **bold** kept.
fn html_of(text: &str) -> String {
    let esc = text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let mut out = String::new();
    for para in esc.split("\n\n").map(str::trim).filter(|p| !p.is_empty()) {
        let mut p = String::new();
        let mut bold = false;
        for (i, piece) in para.split("**").enumerate() {
            if i > 0 {
                bold = !bold;
                p.push_str(if bold { "<b>" } else { "</b>" });
            }
            p.push_str(piece);
        }
        if bold {
            p.push_str("</b>");
        }
        out.push_str(&format!("<p style=\"margin:0 0 10px\">{}</p>", p.replace('\n', "<br>")));
    }
    format!("<div style=\"font-family:Calibri,Arial,sans-serif;font-size:11pt\">{out}</div>")
}

/// The files to attach: existing files, full paths or names in the Tray / work folder.
fn files_of(app: &tauri::AppHandle, v: Option<&Value>) -> Result<Vec<String>, String> {
    let list: Vec<String> = match v {
        Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        Some(Value::String(s)) if !s.trim().is_empty() => vec![s.trim().to_string()],
        _ => Vec::new(),
    };
    if list.len() > MAX_ATTACH {
        return Err(tf("Troppi allegati: al massimo {n}.", &[("n", &MAX_ATTACH)]));
    }
    let mut out = Vec::new();
    for f in list {
        let path = crate::documents::locate(app, &f).map_err(|_| tf("Allegato non trovato: «{f}».", &[("f", &f)]))?;
        if !path.is_file() {
            return Err(tf("Allegato non trovato: «{f}».", &[("f", &f)]));
        }
        // Never the places of keys and passwords (as the reads of the chat).
        if crate::opencode::secret_place(&path.display().to_string()) {
            return Err(tf("«{f}» sta tra le chiavi e le password: non lo allego.", &[("f", &f)]));
        }
        out.push(path.display().to_string());
    }
    Ok(out)
}

/// mail_draft: a new mail in Outlook, shown and left for the user to send.
pub async fn draft(app: &tauri::AppHandle, args: &Value) -> Result<String, String> {
    let to = addresses(args.get("to"))?;
    let cc = addresses(args.get("cc"))?;
    let bcc = addresses(args.get("bcc"))?;
    let subject: String = args.get("subject").and_then(Value::as_str).unwrap_or_default().trim().chars().take(400).collect();
    let body: String = args.get("body").and_then(Value::as_str).unwrap_or_default().chars().take(MAX_BODY).collect();
    if subject.is_empty() && body.trim().is_empty() {
        return Err(t("Servono almeno l'oggetto o il testo della mail.").into());
    }
    let files = files_of(app, args.get("attachments"))?;
    let running = tokio::task::spawn_blocking(|| !crate::apps::pids_of(&["outlook.exe"]).is_empty()).await.unwrap_or(true);
    if !running {
        return Err(not_open());
    }
    let payload = json!({
        "to": to.join("; "), "cc": cc.join("; "), "bcc": bcc.join("; "),
        "subject": subject, "html": html_of(&body), "files": files,
    });
    let mut cmd = tokio::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT])
        .env("EI_MAIL", payload.to_string())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = match tokio::time::timeout(Duration::from_secs(45), cmd.output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(format!("PowerShell: {e}")),
        Err(_) => return Err(t("Outlook non risponde (45 s).").into()),
    };
    let text = String::from_utf8_lossy(&out.stdout).trim().trim_start_matches('\u{feff}').to_string();
    if text == "NOT_RUNNING" {
        return Err(not_open());
    }
    if !out.status.success() || !text.contains("\"ok\":true") {
        let err = String::from_utf8_lossy(&out.stderr);
        let line = err.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("errore");
        return Err(format!("Outlook: {line}"));
    }
    crate::log::line(format!("mail: bozza aperta in Outlook ({} destinatari, {} allegati)", to.len() + cc.len() + bcc.len(), files.len()));
    let mut reply = tf("Mail aperta in Outlook, non inviata: la controlla e la invia l'utente. A: {to}", &[("to", &if to.is_empty() { "—".to_string() } else { to.join("; ") })]);
    if !cc.is_empty() {
        reply.push_str(&format!(" · Cc: {}", cc.join("; ")));
    }
    if !files.is_empty() {
        reply.push_str(&format!("\n{}", tf("Allegati: {list}", &[("list", &files.iter().map(|f| f.rsplit(['\\', '/']).next().unwrap_or(f)).collect::<Vec<_>>().join(", "))])));
    }
    Ok(reply)
}

fn not_open() -> String {
    t("Outlook classico non è aperto: la mail si prepara lì. Aprilo e riprova.").into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_are_split_and_checked() {
        assert_eq!(addresses(Some(&json!("a@x.it; b@y.com"))).unwrap(), ["a@x.it", "b@y.com"]);
        assert_eq!(addresses(Some(&json!(["a@x.it"]))).unwrap(), ["a@x.it"]);
        assert!(addresses(Some(&json!("non un indirizzo"))).is_err());
        assert!(addresses(Some(&json!("a@x.it' ; $(calc)@x.it"))).is_err());
        assert!(addresses(None).unwrap().is_empty());
    }

    #[test]
    fn the_text_becomes_safe_html() {
        let h = html_of("Ciao **Mario**,\nriga due\n\n<script>x</script>");
        assert!(h.contains("Ciao <b>Mario</b>,<br>riga due"));
        assert!(h.contains("&lt;script&gt;x&lt;/script&gt;"));
        assert!(!h.contains("<script>"));
    }
}
