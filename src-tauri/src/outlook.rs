// The Outlook integration, a check run by widgets.rs: unread mail and the next
// appointments from classic Outlook (the desktop app), through its COM object model. No account, no key, no
// network: Outlook already has everything.
//
// It only attaches to an Outlook that is already open (GetActiveObject); it
// never starts one. The new Outlook (olk.exe) has no COM model, so it is not
// supported. The read runs in a short PowerShell call, the same way the TLS
// widget reads certificates, once a minute by default, and only while
// OUTLOOK.EXE runs: closed (evenings, weekends) it costs one process list.
//
// The appointments go through calendar::describe, so the text and the
// "about to start" warning are the same as the ICS calendar widget's.

use std::time::Duration;

use serde::Deserialize;

use crate::calendar::{describe, now_local, Occurrence};
use crate::widgets::{days_from_civil, FieldValue, Widget, WidgetResult};
use crate::i18n::{t, tf};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Inbox unread count and the appointments from now to the end of tomorrow,
/// cancelled meetings left out. Dates in the local sortable form ("s").
/// Single quotes only: double quotes do not survive the trip through the
/// command line to powershell.exe.
const SCRIPT: &str = r#"$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
try { $o=[Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') } catch { 'NOT_RUNNING'; exit 0 }
$ns=$o.GetNamespace('MAPI')
$unread=$ns.GetDefaultFolder(6).UnReadItemCount
$items=$ns.GetDefaultFolder(9).Items
$items.IncludeRecurrences=$true
$items.Sort('[Start]')
$now=Get-Date
$to=$now.Date.AddDays(2)
$r=$items.Restrict(('[End] > ''{0}'' AND [Start] < ''{1}''' -f $now.ToString('g'),$to.ToString('g')))
$list=@()
foreach($a in $r){
  if($list.Count -ge 8){break}
  if($a.MeetingStatus -eq 5 -or $a.MeetingStatus -eq 7){continue}
  $list+=[pscustomobject]@{s=[string]$a.Subject;b=$a.Start.ToString('s');e=$a.End.ToString('s');d=[bool]$a.AllDayEvent}
}
[pscustomobject]@{unread=[int]$unread;items=$list} | ConvertTo-Json -Compress -Depth 3"#;

#[derive(Deserialize)]
struct Snapshot {
    unread: i64,
    /// ConvertTo-Json turns a one-element array into an object: both are accepted.
    #[serde(default, deserialize_with = "one_or_many")]
    items: Vec<Item>,
}

#[derive(Deserialize)]
struct Item {
    s: String,
    b: String,
    e: String,
    d: bool,
}

fn one_or_many<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<Item>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrMany {
        Many(Vec<Item>),
        One(Item),
        None(()),
    }
    Ok(match OneOrMany::deserialize(d)? {
        OneOrMany::Many(v) => v,
        OneOrMany::One(i) => vec![i],
        OneOrMany::None(()) => Vec::new(),
    })
}

/// "2026-10-03T14:30:00" (local) → local wall-clock seconds since 1970.
fn local_secs(s: &str) -> Option<i64> {
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-').map(|p| p.parse::<i64>());
    let (y, m, day) = (d.next()?.ok()?, d.next()?.ok()?, d.next()?.ok()?);
    let mut t = time.split(':').map(|p| p.parse::<i64>());
    let (hh, mm, ss) = (t.next()?.ok()?, t.next()?.ok()?, t.next().and_then(|r| r.ok()).unwrap_or(0));
    Some(days_from_civil(y, m, day) * 86_400 + hh * 3600 + mm * 60 + ss)
}

fn occurrences(items: &[Item]) -> Vec<Occurrence> {
    items
        .iter()
        .filter_map(|i| {
            Some(Occurrence {
                summary: if i.s.trim().is_empty() { t("(senza oggetto)").into() } else {
 i.s.trim().to_string() },
                start: local_secs(&i.b)?,
                end: local_secs(&i.e)?,
                all_day: i.d,
            })
        })
        .collect()
}

/// What the widget shows for a snapshot taken at `now`.
fn result_for(id: &str, snap: &Snapshot, now: i64, warn_min: i64) -> WidgetResult {
    let list = occurrences(&snap.items);
    let mail = match snap.unread {
        0 => t("nessuna mail da leggere").to_string(),
        1 => t("1 mail da leggere").to_string(),
        n => tf("{n} mail da leggere", &[("n", &n)]),
    };
    let (level, summary, mut fields) = describe(&list, now, warn_min);
    let summary = if list.is_empty() {
        tf("Nessun appuntamento fino a domani · {mail}", &[("mail", &mail)])
    } else {
        format!("{summary} · {mail}")
    };
    fields.insert(0, FieldValue { label: t("Posta in arrivo").into(), value: mail });
    let mut r = WidgetResult::new(id, level, summary);
    r.fields = fields;
    r
}

pub async fn probe(w: &Widget) -> WidgetResult {
    // No PowerShell at all while Outlook is closed.
    let running = tokio::task::spawn_blocking(|| !crate::apps::pids_of(&["outlook.exe"]).is_empty()).await.unwrap_or(true);
    if !running {
        return WidgetResult::new(&w.id, "ok", t("Outlook non è aperto"));
    }
    let out = tokio::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT])
        .creation_flags(CREATE_NO_WINDOW)
        .kill_on_drop(true)
        .output();
    let out = match tokio::time::timeout(Duration::from_secs(25), out).await {
        Ok(Ok(o)) if o.status.success() => o,
        Ok(Ok(o)) => {
            let err = String::from_utf8_lossy(&o.stderr);
            let line = err.lines().find(|l| !l.trim().is_empty()).unwrap_or(t("errore")).trim().to_string();
            return WidgetResult::new(&w.id, "error", format!("Outlook: {line}"));
        }
        _ => return WidgetResult::new(&w.id, "error", t("Outlook non risponde")),
    };
    let text = String::from_utf8_lossy(&out.stdout).trim().trim_start_matches('\u{feff}').to_string();
    if text == "NOT_RUNNING" {
        // Closed Outlook is normal (evening, weekend): not a problem to flag.
        return WidgetResult::new(&w.id, "ok", t("Outlook non è aperto"));
    }
    let snap: Snapshot = match serde_json::from_str(&text) {
        Ok(s) => s,
        Err(_) => return WidgetResult::new(&w.id, "error", t("Risposta di Outlook non leggibile")),
    };
    let warn_min = if w.warn_days > 0 { w.warn_days } else { 10 };
    result_for(&w.id, &snap, now_local(), warn_min)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(json: &str) -> Snapshot {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn reads_powershell_shapes() {
        // One appointment: ConvertTo-Json gives an object, not an array.
        let one = snap(r#"{"unread":3,"items":{"s":"Call","b":"2026-10-03T10:00:00","e":"2026-10-03T10:30:00","d":false}}"#);
        assert_eq!(one.items.len(), 1);
        let none = snap(r#"{"unread":0,"items":[]}"#);
        assert!(none.items.is_empty());
        let null = snap(r#"{"unread":0,"items":null}"#);
        assert!(null.items.is_empty());
    }

    #[test]
    fn local_times() {
        assert_eq!(local_secs("1970-01-02T01:02:03"), Some(86_400 + 3723));
        assert_eq!(local_secs("nonsense"), None);
    }

    #[test]
    fn meeting_soon_warns_and_counts_mail() {
        let s = snap(r#"{"unread":2,"items":[{"s":"Cliente Rossi","b":"2026-10-03T10:00:00","e":"2026-10-03T11:00:00","d":false}]}"#);
        let now = local_secs("2026-10-03T09:55:00").unwrap();
        let r = result_for("w", &s, now, 10);
        assert_eq!(r.level, "warn");
        assert!(r.summary.starts_with("Tra 5 min: Cliente Rossi"), "{}", r.summary);
        assert!(r.summary.ends_with("2 mail da leggere"));
        assert_eq!(r.fields[0].value, "2 mail da leggere");
    }

    #[test]
    fn empty_day() {
        let s = snap(r#"{"unread":1,"items":[]}"#);
        let r = result_for("w", &s, 0, 10);
        assert_eq!(r.level, "ok");
        assert_eq!(r.summary, "Nessun appuntamento fino a domani · 1 mail da leggere");
    }
}
