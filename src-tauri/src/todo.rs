// Microsoft To Do through classic Outlook (asked by Edoardo on 20 October
// 2026: read, add and change, he uses classic Outlook). To Do has no local
// way in; its tasks are Outlook's tasks of the same account, synced both ways
// by Microsoft. So, like outlook.rs: Outlook's COM model, in a short
// PowerShell call, only when Outlook is already open (GetActiveObject, never
// started from here). No key, no network from EasyIsland.
//
// To Do's lists are Outlook's task folders. The script is fixed; what the
// model asks for goes in as JSON in an environment variable, never inside the
// command. Tasks get a short id (a hash of the EntryID, 140 characters) kept
// in memory: todo_update needs a todo_list of this run first. Nothing here
// deletes: done is "completed", like the tick in To Do.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Single quotes only inside: double quotes do not survive the command line.
const SCRIPT: &str = r#"$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
try { $o=[Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') } catch { 'NOT_RUNNING'; exit 0 }
$ns=$o.GetNamespace('MAPI')
$a=$env:EI_TODO | ConvertFrom-Json
$def=$ns.GetDefaultFolder(13)
function Lists {
  $out=New-Object System.Collections.ArrayList
  [void]$out.Add($def)
  function Walk($f,$d){ if($d -gt 4){return}; foreach($c in $f.Folders){ if($c.DefaultItemType -eq 3 -and $c.EntryID -ne $def.EntryID){ [void]$out.Add($c) }; Walk $c ($d+1) } }
  Walk $def.Store.GetRootFolder() 0
  return ,$out
}
function Pick($name){
  if(-not $name){ return $def }
  $all=Lists
  foreach($f in $all){ if($f.Name -ieq $name){ return $f } }
  foreach($f in $all){ if($f.Name -like ('*'+$name+'*')){ return $f } }
  throw ('LIST:'+(($all | ForEach-Object { $_.Name }) -join ' | '))
}
function Day($s){ return [datetime]::ParseExact($s,'yyyy-MM-dd',$null) }
function When($s){ return [datetime]::ParseExact($s,'yyyy-MM-dd HH:mm',$null) }
function Row($t,$list){
  $due=''; if($t.DueDate.Year -lt 4000){ $due=$t.DueDate.ToString('yyyy-MM-dd') }
  $rem=''; if($t.ReminderSet){ $rem=$t.ReminderTime.ToString('yyyy-MM-dd HH:mm') }
  $body=[string]$t.Body; if($body.Length -gt 200){ $body=$body.Substring(0,200)+'...' }
  [pscustomobject]@{id=[string]$t.EntryID;s=[string]$t.Subject;due=$due;done=[bool]$t.Complete;imp=[int]$t.Importance;rem=$rem;note=$body.Trim();list=$list}
}
function Fill($t){
  if($a.title){ $t.Subject=[string]$a.title }
  if($a.PSObject.Properties.Name -contains 'due'){ if($a.due){ $t.DueDate=(Day $a.due) } else { $t.DueDate=[datetime]'4501-01-01' } }
  if($a.PSObject.Properties.Name -contains 'note'){ $t.Body=[string]$a.note }
  if($a.importance -eq 'low'){ $t.Importance=0 } elseif($a.importance -eq 'normal'){ $t.Importance=1 } elseif($a.importance -eq 'high'){ $t.Importance=2 }
  if($a.PSObject.Properties.Name -contains 'reminder'){ if($a.reminder){ $t.ReminderSet=$true; $t.ReminderTime=(When $a.reminder) } else { $t.ReminderSet=$false } }
}
switch($a.op){
  'list' {
    $rows=New-Object System.Collections.ArrayList
    $folders=@(); if($a.list){ $folders=@(Pick $a.list) } else { $folders=Lists }
    foreach($f in $folders){
      $items=$f.Items
      if(-not $a.done){ $items=$items.Restrict('[Complete] = False') }
      foreach($t in $items){ if($t.Class -ne 48){continue}; if($rows.Count -ge [int]$a.limit){break}; [void]$rows.Add((Row $t $f.Name)) }
    }
    [pscustomobject]@{lists=@((Lists) | ForEach-Object { $_.Name });tasks=$rows} | ConvertTo-Json -Compress -Depth 4
  }
  'add' {
    $f=Pick $a.list
    $t=$f.Items.Add(3)
    Fill $t
    $t.Save()
    [pscustomobject]@{task=(Row $t $f.Name)} | ConvertTo-Json -Compress -Depth 4
  }
  'update' {
    $t=$ns.GetItemFromID([string]$a.entry)
    if($t.Class -ne 48){ throw 'NOT_TASK' }
    $prev=Row $t $t.Parent.Name; $prev.note=[string]$t.Body
    Fill $t
    if($a.PSObject.Properties.Name -contains 'done'){ if($a.done){ $t.MarkComplete() } else { $t.Complete=$false; $t.Status=0; $t.PercentComplete=0 } }
    $t.Save()
    [pscustomobject]@{task=(Row $t $t.Parent.Name);before=$prev} | ConvertTo-Json -Compress -Depth 4
  }
  'remove' {
    $t=$ns.GetItemFromID([string]$a.entry)
    if($t.Class -ne 48){ throw 'NOT_TASK' }
    $t.Delete()
    '{}'
  }
}"#;

/// Short id → EntryID, for this run of the app.
static IDS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn short_id(entry: &str) -> String {
    // FNV-1a, 32 bits: enough for a few hundred tasks, and the same every time.
    let mut h: u32 = 0x811c_9dc5;
    for b in entry.bytes() {
        h ^= u32::from(b);
        h = h.wrapping_mul(0x0100_0193);
    }
    let id = format!("t{h:08x}");
    IDS.lock().unwrap().get_or_insert_with(HashMap::new).insert(id.clone(), entry.to_string());
    id
}

fn entry_of(id: &str) -> Option<String> {
    IDS.lock().unwrap().as_ref()?.get(id.trim()).cloned()
}

async fn run(args: Value) -> Result<Value, String> {
    let running = tokio::task::spawn_blocking(|| !crate::apps::pids_of(&["outlook.exe"]).is_empty()).await.unwrap_or(true);
    if !running {
        return Err(not_open());
    }
    let mut cmd = tokio::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT])
        .env("EI_TODO", args.to_string())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = match tokio::time::timeout(Duration::from_secs(30), cmd.output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(format!("PowerShell: {e}")),
        Err(_) => return Err("Outlook non risponde (30 s).".into()),
    };
    let text = String::from_utf8_lossy(&out.stdout).trim().trim_start_matches('\u{feff}').to_string();
    if text == "NOT_RUNNING" {
        return Err(not_open());
    }
    if !out.status.success() || text.is_empty() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(error_text(&err));
    }
    serde_json::from_str(&text).map_err(|_| "Risposta di Outlook non leggibile.".to_string())
}

fn not_open() -> String {
    "Outlook classico non è aperto: le attività di To Do passano da lì. Aprilo e riprova.".into()
}

/// PowerShell's error, in a line the model can act on.
fn error_text(err: &str) -> String {
    if let Some(i) = err.find("LIST:") {
        let names = err.get(i + 5..).unwrap_or_default().lines().next().unwrap_or_default().trim().trim_end_matches(['"', '\'', '.']);
        return format!("Lista non trovata. Liste di To Do: {names}");
    }
    if err.contains("NOT_TASK") {
        return "Quell'id non è un'attività.".into();
    }
    if err.contains("ParseExact") || err.contains("DateTime") {
        return "Data non valida: usa AAAA-MM-GG per la scadenza e AAAA-MM-GG HH:MM per il promemoria.".into();
    }
    let line = err.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("errore");
    format!("Outlook: {line}")
}

fn one_or_many(v: Option<&Value>) -> Vec<Value> {
    match v {
        Some(Value::Array(a)) => a.clone(),
        Some(Value::Null) | None => Vec::new(),
        Some(o) => vec![o.clone()],
    }
}

fn importance(n: i64) -> &'static str {
    match n {
        0 => "bassa",
        2 => "alta",
        _ => "",
    }
}

/// A task in one line: short id, title, due date, the rest only when set.
fn task_line(t: &Value) -> String {
    let s = |k: &str| t.get(k).and_then(Value::as_str).unwrap_or_default();
    let id = short_id(s("id"));
    let mut parts = vec![format!("{id} | {}", s("s").replace('|', "/"))];
    if !s("due").is_empty() {
        parts.push(format!("scade {}", s("due")));
    }
    let imp = importance(t.get("imp").and_then(Value::as_i64).unwrap_or(1));
    if !imp.is_empty() {
        parts.push(format!("importanza {imp}"));
    }
    if !s("rem").is_empty() {
        parts.push(format!("promemoria {}", s("rem")));
    }
    if t.get("done").and_then(Value::as_bool) == Some(true) {
        parts.push("fatta".into());
    }
    if !s("list").is_empty() {
        parts.push(format!("lista {}", s("list")));
    }
    if !s("note").is_empty() {
        parts.push(format!("nota: {}", s("note").replace(['\r', '\n'], " ")));
    }
    parts.join(" · ")
}

/// todo_list: the tasks not done yet (or all), of a list or of every list.
pub async fn list(args: &Value) -> Result<String, String> {
    let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(50).clamp(1, 200);
    let req = json!({
        "op": "list",
        "list": args.get("list").and_then(Value::as_str).unwrap_or_default(),
        "done": args.get("done").and_then(Value::as_bool).unwrap_or(false),
        "limit": limit,
    });
    let v = run(req).await?;
    let lists: Vec<String> = one_or_many(v.get("lists")).iter().filter_map(|x| x.as_str().map(str::to_string)).collect();
    let tasks = one_or_many(v.get("tasks"));
    let mut out = format!("Liste di To Do: {}.", lists.join(" · "));
    if tasks.is_empty() {
        out.push_str("\nNessuna attività da fare.");
    } else {
        out.push_str(&format!("\n{} attività{}:", tasks.len(), if tasks.len() as u64 >= limit { " (ce ne sono altre: alza limit)" } else { "" }));
        for t in &tasks {
            out.push('\n');
            out.push_str(&task_line(t));
        }
    }
    Ok(out)
}

/// The fields todo_add and todo_update accept, as the script wants them.
fn fields(args: &Value, req: &mut Value) -> Result<(), String> {
    for k in ["title", "due", "note", "reminder"] {
        if let Some(v) = args.get(k) {
            let text = v.as_str().map(str::trim).unwrap_or_default();
            if k == "due" && !text.is_empty() && !is_day(text) {
                return Err("Scadenza non valida: usa AAAA-MM-GG (vuota per toglierla).".into());
            }
            if k == "reminder" && !text.is_empty() && !is_moment(text) {
                return Err("Promemoria non valido: usa AAAA-MM-GG HH:MM (vuoto per toglierlo).".into());
            }
            req[k] = json!(text);
        }
    }
    if let Some(i) = args.get("importance").and_then(Value::as_str) {
        let i = match i.trim().to_lowercase().as_str() {
            "low" | "bassa" => "low",
            "high" | "alta" => "high",
            "normal" | "normale" => "normal",
            _ => return Err("Importanza: low, normal o high.".into()),
        };
        req["importance"] = json!(i);
    }
    Ok(())
}

fn is_day(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && s.chars().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

fn is_moment(s: &str) -> bool {
    s.len() == 16 && is_day(s.get(..10).unwrap_or_default()) && s.as_bytes()[10] == b' ' && s.get(11..).is_some_and(|t| t.len() == 5 && t.as_bytes()[2] == b':' && t.chars().enumerate().all(|(i, c)| i == 2 || c.is_ascii_digit()))
}

/// todo_add: a new task, in the default list or the one named.
pub async fn add(args: &Value) -> Result<String, String> {
    add_undoable(args).await.map(|(text, _)| text)
}

/// todo_update: title, due date, note, importance, reminder, done or not.
pub async fn update(args: &Value) -> Result<String, String> {
    update_undoable(args).await.map(|(text, _, _)| text)
}

/// «Annulla» of todo_add (permits.rs): the task goes to Outlook's Deleted Items.
pub async fn remove(entry: &str) -> Result<(), String> {
    run(json!({ "op": "remove", "entry": entry })).await.map(|_| ())
}

/// «Annulla» of todo_update (permits.rs): the fields changed, back as they were.
pub async fn restore(entry: &str, before: &Value) -> Result<(), String> {
    let mut req = json!({ "op": "update", "entry": entry });
    fields(before, &mut req)?;
    if let Some(d) = before.get("done").and_then(Value::as_bool) {
        req["done"] = json!(d);
    }
    run(req).await.map(|_| ())
}

/// `add`, with the Outlook EntryID of the new task.
pub async fn add_undoable(args: &Value) -> Result<(String, String), String> {
    let title = args.get("title").and_then(Value::as_str).map(str::trim).unwrap_or_default();
    if title.is_empty() {
        return Err("Manca il titolo dell'attività.".into());
    }
    let mut req = json!({ "op": "add", "list": args.get("list").and_then(Value::as_str).unwrap_or_default() });
    fields(args, &mut req)?;
    let v = run(req).await?;
    let task = v.get("task").ok_or("Risposta di Outlook non leggibile.")?;
    crate::log::line("todo: attività aggiunta");
    let entry = task.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
    Ok((format!("Aggiunta in To Do (arriva in To Do con la sincronizzazione di Outlook):\n{}", task_line(task)), entry))
}

/// `update`, with the EntryID and the fields it changed as they were before,
/// in todo_update's own words (title, due, note, importance, reminder, done).
pub async fn update_undoable(args: &Value) -> Result<(String, String, Value), String> {
    let id = args.get("id").and_then(Value::as_str).unwrap_or_default();
    let entry = entry_of(id).ok_or("Id sconosciuto: rileggi le attività con todo_list e usa l'id che dà.")?;
    let mut req = json!({ "op": "update", "entry": entry });
    fields(args, &mut req)?;
    if let Some(d) = args.get("done").and_then(Value::as_bool) {
        req["done"] = json!(d);
    }
    if req.as_object().is_some_and(|o| o.len() <= 2) {
        return Err("Niente da cambiare: title, due, note, importance, reminder o done.".into());
    }
    let changed: Vec<String> = req.as_object().map(|o| o.keys().filter(|k| *k != "op" && *k != "entry").cloned().collect()).unwrap_or_default();
    let v = run(req).await?;
    let task = v.get("task").ok_or("Risposta di Outlook non leggibile.")?;
    crate::log::line("todo: attività cambiata");
    let was = v.get("before").cloned().unwrap_or(Value::Null);
    let s = |k: &str| json!(was.get(k).and_then(Value::as_str).unwrap_or_default());
    let mut before = serde_json::Map::new();
    for k in changed {
        let old = match k.as_str() {
            "title" => s("s"),
            "due" => s("due"),
            "note" => s("note"),
            "reminder" => s("rem"),
            "importance" => json!(match was.get("imp").and_then(Value::as_i64) { Some(0) => "low", Some(2) => "high", _ => "normal" }),
            "done" => json!(was.get("done").and_then(Value::as_bool).unwrap_or(false)),
            _ => continue,
        };
        before.insert(k, old);
    }
    Ok((format!("Attività aggiornata:\n{}", task_line(task)), entry, Value::Object(before)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_ids_are_stable_and_known() {
        let a = short_id("00000000ABCDEF");
        assert_eq!(a, short_id("00000000ABCDEF"));
        assert_ne!(a, short_id("00000000ABCDEG"));
        assert_eq!(entry_of(&a).as_deref(), Some("00000000ABCDEF"));
        assert!(entry_of("t00000000").is_none());
    }

    #[test]
    fn a_task_in_one_line() {
        let t = json!({ "id": "E1", "s": "Pagare | bollo", "due": "2026-10-25", "done": false, "imp": 2, "rem": "", "note": "auto\r\nmoto", "list": "Casa" });
        let line = task_line(&t);
        assert!(line.ends_with("| Pagare / bollo · scade 2026-10-25 · importanza alta · lista Casa · nota: auto  moto"), "{line}");
        assert!(!task_line(&json!({ "id": "E2", "s": "x", "imp": 1 })).contains("importanza"));
    }

    #[test]
    fn values_are_checked_before_outlook() {
        let mut r = json!({});
        assert!(fields(&json!({ "due": "25/10/2026" }), &mut r).is_err());
        assert!(fields(&json!({ "reminder": "2026-10-25 9:00" }), &mut r).is_err());
        assert!(fields(&json!({ "importance": "urgente" }), &mut r).is_err());
        let mut r = json!({});
        fields(&json!({ "title": " Bollo ", "due": "2026-10-25", "reminder": "2026-10-24 09:30", "importance": "alta", "note": "" }), &mut r).unwrap();
        assert_eq!(r, json!({ "title": "Bollo", "due": "2026-10-25", "reminder": "2026-10-24 09:30", "importance": "high", "note": "" }));
        // An empty due date takes it away.
        let mut r = json!({});
        fields(&json!({ "due": "" }), &mut r).unwrap();
        assert_eq!(r["due"], "");
    }

    #[test]
    fn errors_say_what_to_do() {
        assert_eq!(error_text("Exception: LIST:Attività | Casa | Lavoro\r\nAt line:1"), "Lista non trovata. Liste di To Do: Attività | Casa | Lavoro");
        assert!(error_text("x NOT_TASK y").contains("non è un'attività"));
    }

    #[test]
    fn powershell_gets_one_object_or_a_list() {
        assert_eq!(one_or_many(Some(&json!({ "s": "a" }))).len(), 1);
        assert_eq!(one_or_many(Some(&json!([1, 2]))).len(), 2);
        assert!(one_or_many(None).is_empty());
    }

    /// With classic Outlook open: `cargo test --lib todo::tests::live -- --ignored --nocapture`.
    /// Adds a task "Prova EasyIsland", changes it and marks it done (nothing is deleted).
    #[test]
    #[ignore]
    fn live() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        println!("{}", rt.block_on(list(&json!({ "limit": 5 }))).unwrap());
        let added = rt.block_on(add(&json!({ "title": "Prova EasyIsland (si può cancellare)", "due": "2026-10-30", "importance": "high", "note": "creata dal test" }))).unwrap();
        println!("{added}");
        let id = added.lines().nth(1).unwrap().split(' ').next().unwrap().to_string();
        println!("{}", rt.block_on(update(&json!({ "id": id, "title": "Prova EasyIsland cambiata (si può cancellare)", "due": "", "reminder": "2026-10-29 09:00" }))).unwrap());
        println!("{}", rt.block_on(update(&json!({ "id": id, "done": true }))).unwrap());
        assert!(rt.block_on(list(&json!({ "list": "lista che non esiste" }))).unwrap_err().starts_with("Lista non trovata"));
    }
}
