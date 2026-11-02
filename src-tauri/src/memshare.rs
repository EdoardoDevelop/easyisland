//! The memory shared between PCs through Agent Chat (2 November 2026, Edoardo:
//! home and work are two PCs; at home the work memory stays separate, but
//! readable, «prima controlla nella sua memoria e se non trova nulla verifica
//! che sia online», and home may change it while work is off).
//!
//! - The PC that shares (`agentchat_share_memory`, the work one) uploads its
//!   memory (MEMORIA.md, archivio.md, the pages) to the server when it
//!   changes (`PUT /api/memory`), answers live questions on it with
//!   memory::search, no model (`GET /api/memory/requests`, long poll), and
//!   keeps the notes the other PCs left for it, even those left while it was off.
//! - The PC that reads (`agentchat_memory_from`, home) keeps a copy in
//!   `memoria-condivise/<agent>`, never mixed with its own memory.
//!   memory_search looks into its own memory, then into the copy, and only
//!   when both have nothing asks the other PC live, if it is on. memory_note
//!   with `shared` sends the note there; with the other PC off it goes into
//!   the copy at once and reaches the other PC when it comes back.
//!
//! Everything goes only to the user's own Agent Chat server, with the PC's token.

use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::agentchat::{self as ac, Server};
use crate::i18n::{t, tf};

/// The copy is read again this often, the own memory checked for changes as often.
const SYNC_SECS: u64 = 30;
/// One long poll for the questions and the notes of the other PCs.
const REQUESTS_WAIT: u64 = 25;
/// Lines of the copy memory_search gives back.
const MAX_FOUND: usize = 20;

/// Hash of the memory last uploaded.
static SENT: Mutex<Option<u64>> = Mutex::new(None);
/// (agent, rev) of the copy on disk.
static COPY_REV: Mutex<Option<(String, i64)>> = Mutex::new(None);

fn settings(app: &AppHandle) -> (bool, String) {
    app.try_state::<crate::Shared>()
        .map(|s| {
            let s = s.settings.lock().unwrap();
            let c = &s.integration_config;
            (c.agentchat_share_memory, c.agentchat_memory_from.trim().to_lowercase())
        })
        .unwrap_or_default()
}

/// The PC whose memory this one reads, when set and not itself.
pub fn source(app: &AppHandle) -> Option<String> {
    let (_, from) = settings(app);
    (!from.is_empty() && Some(&from) != ac::me().as_ref()).then_some(from)
}

/// Where the copy of `agent`'s memory lives.
pub fn copy_dir(agent: &str) -> PathBuf {
    crate::settings::config_dir().join("memoria-condivise").join(agent)
}

/// The notes left for `agent` while it was off, until its copy has them:
/// next to the copy, so a new copy does not wipe them.
pub fn waiting_file(agent: &str) -> PathBuf {
    crate::settings::config_dir().join("memoria-condivise").join(format!("{agent}.in-attesa.md"))
}

/// The waiting notes that the copy now has go away.
pub(crate) fn drop_arrived(waiting: &Path, copy: &Path) {
    let Ok(text) = std::fs::read_to_string(waiting) else { return };
    let have = std::fs::read_to_string(copy.join("MEMORIA.md")).unwrap_or_default().to_lowercase();
    // «- 2026-11-02: (da casa) testo»: arrived when the copy has «(da casa) testo».
    let left: Vec<&str> = text.lines().filter(|l| l.split_once(": ").is_none_or(|(_, note)| !have.contains(&note.trim().to_lowercase()))).filter(|l| !l.trim().is_empty()).collect();
    if left.is_empty() {
        let _ = std::fs::remove_file(waiting);
    } else if left.len() != text.lines().filter(|l| !l.trim().is_empty()).count() {
        let _ = std::fs::write(waiting, format!("{}\n", left.join("\n")));
    }
}

/// A path of the snapshot, when it is one of ours: «MEMORIA.md»,
/// «archivio.md», «pagine/Rossi.md». Nothing else lands on disk.
pub(crate) fn safe_path(rel: &str) -> Option<PathBuf> {
    let parts: Vec<&str> = rel.split('/').collect();
    let ok_part = |p: &str| !p.is_empty() && p != "." && p != ".." && !p.contains(['\\', ':', '\0']) && !p.starts_with('.');
    match parts.as_slice() {
        [f] if *f == "MEMORIA.md" || *f == "archivio.md" => Some(PathBuf::from(f)),
        ["pagine", f] if ok_part(f) && f.ends_with(".md") => Some(PathBuf::from("pagine").join(f)),
        _ => None,
    }
}

/// This PC's memory as it is shared: notes, archive and pages.
fn snapshot() -> BTreeMap<String, String> {
    let dir = crate::memory::dir();
    let mut out = BTreeMap::new();
    for f in ["MEMORIA.md", "archivio.md"] {
        if let Ok(text) = std::fs::read_to_string(dir.join(f)) {
            out.insert(f.to_string(), text);
        }
    }
    if let Ok(list) = std::fs::read_dir(dir.join("pagine")) {
        for e in list.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.ends_with(".md") {
                if let Ok(text) = std::fs::read_to_string(e.path()) {
                    out.insert(format!("pagine/{name}"), text);
                }
            }
        }
    }
    out
}

fn hash_of(files: &BTreeMap<String, String>) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    files.hash(&mut h);
    h.finish()
}

/// Uploads this PC's memory when it changed since the last time.
async fn upload(srv: &Server) {
    let files = tauri::async_runtime::spawn_blocking(snapshot).await.unwrap_or_default();
    let h = hash_of(&files);
    if *SENT.lock().unwrap() == Some(h) {
        return;
    }
    let sent = match ac::client(60) {
        Ok(c) => c.put(format!("{}/api/memory", srv.url)).bearer_auth(&srv.token).json(&json!({ "files": files })).send().await.map_err(|e| ac::net_error(&e)),
        Err(e) => Err(e),
    };
    match sent {
        Ok(resp) => match ac::answer(resp).await {
            Ok(_) => *SENT.lock().unwrap() = Some(h),
            Err(e) => crate::log::line(format!("memshare: {e}")),
        },
        Err(e) => crate::log::line(format!("memshare: {e}")),
    }
}

/// The copy on disk, replaced by the server's when that is newer.
async fn refresh_copy(srv: &Server, agent: &str) {
    let known = COPY_REV.lock().unwrap().clone().filter(|(a, _)| a == agent).map(|(_, r)| r);
    let path = match known {
        Some(r) if copy_dir(agent).exists() => format!("/api/memory/{}?rev={r}", ac::query(agent)),
        _ => format!("/api/memory/{}", ac::query(agent)),
    };
    let Ok(v) = ac::get(srv, &path, 60).await else { return };
    let rev = v.get("rev").and_then(Value::as_i64).unwrap_or(0);
    let Some(files) = v.get("files").and_then(Value::as_object).cloned() else {
        *COPY_REV.lock().unwrap() = Some((agent.to_string(), rev));
        return;
    };
    let dir = copy_dir(agent);
    let written = tauri::async_runtime::spawn_blocking(move || write_copy(&dir, &files)).await.unwrap_or(false);
    if written {
        *COPY_REV.lock().unwrap() = Some((agent.to_string(), rev));
        drop_arrived(&waiting_file(agent), &copy_dir(agent));
    }
}

/// The snapshot into `dir`, whole: what it no longer has goes away.
pub(crate) fn write_copy(dir: &Path, files: &serde_json::Map<String, Value>) -> bool {
    let temp = dir.with_extension(format!("tmp-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    if std::fs::create_dir_all(temp.join("pagine")).is_err() {
        return false;
    }
    for (rel, text) in files {
        let (Some(p), Some(text)) = (safe_path(rel), text.as_str()) else { continue };
        if std::fs::write(temp.join(p), text).is_err() {
            let _ = std::fs::remove_dir_all(&temp);
            return false;
        }
    }
    let _ = std::fs::remove_dir_all(dir);
    std::fs::rename(&temp, dir).is_ok()
}

/// The two loops, while Agent Chat is connected: the sharing PC uploads and
/// answers, the reading PC keeps its copy fresh.
pub fn spawn(app: AppHandle) {
    let a = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let (share, _) = settings(&a);
            match ac::connected().filter(|_| share) {
                Some(srv) => {
                    upload(&srv).await;
                    if let Some(from) = source(&a) {
                        refresh_copy(&srv, &from).await;
                    }
                }
                None => {
                    if let (Some(srv), Some(from)) = (ac::connected(), source(&a)) {
                        refresh_copy(&srv, &from).await;
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(SYNC_SECS)).await;
        }
    });
    tauri::async_runtime::spawn(async move {
        loop {
            let (share, _) = settings(&app);
            let Some(srv) = ac::connected().filter(|_| share) else {
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            };
            let path = format!("/api/memory/requests?wait={REQUESTS_WAIT}");
            match ac::get(&srv, &path, REQUESTS_WAIT + 20).await {
                Ok(Value::Array(list)) => {
                    let mut noted = false;
                    for r in list {
                        noted |= handle(&app, &srv, &r).await;
                    }
                    if noted {
                        upload(&srv).await;
                    }
                }
                // An older server without shared memory, or the network: later.
                _ => tokio::time::sleep(Duration::from_secs(30)).await,
            }
        }
    });
}

/// A question or a note from another PC; true when the memory changed.
async fn handle(app: &AppHandle, srv: &Server, r: &Value) -> bool {
    let id = r.get("id").and_then(Value::as_i64).unwrap_or(0);
    let body = r.get("body").and_then(Value::as_str).unwrap_or_default().to_string();
    let from = r.get("sender").and_then(Value::as_str).unwrap_or_default().to_string();
    let (answer, noted) = match r.get("kind").and_then(Value::as_str) {
        Some("ask") => {
            let q = body.clone();
            let found = tauri::async_runtime::spawn_blocking(move || crate::memory::search(&q, "")).await.ok().and_then(Result::ok).unwrap_or_default();
            crate::log::line(format!("memshare: {from} ha cercato nella memoria"));
            (found, false)
        }
        Some("note") => {
            let res = crate::memory::note(&tf("(da {pc}) {text}", &[("pc", &from), ("text", &body)]));
            let ok = res.is_ok();
            let _ = crate::brain::changed(app, res);
            (String::new(), ok)
        }
        _ => (String::new(), false),
    };
    if let Ok(c) = ac::client(20) {
        let _ = c.post(format!("{}/api/memory/requests/{id}", srv.url)).bearer_auth(&srv.token).json(&json!({ "answer": answer })).send().await;
    }
    noted
}

/// The lines of the copy with every word of the query, pages first.
pub(crate) fn search_copy(dir: &Path, query: &str) -> Vec<String> {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).filter(|w| w.chars().count() > 1).collect();
    if words.is_empty() {
        return Vec::new();
    }
    let mut files: Vec<(String, PathBuf)> = std::fs::read_dir(dir.join("pagine"))
        .map(|r| r.flatten().map(|e| (e.path().file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(), e.path())).collect())
        .unwrap_or_default();
    files.sort();
    files.push((String::new(), dir.join("MEMORIA.md")));
    files.push((String::new(), dir.join("archivio.md")));
    if let Some(agent) = dir.file_name() {
        files.push((String::new(), waiting_file(&agent.to_string_lossy())));
    }
    let mut found = Vec::new();
    for (title, path) in files {
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        let in_title = !title.is_empty() && words.iter().all(|w| title.to_lowercase().contains(w.as_str()));
        let mut lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty() && !l.starts_with('#')).collect();
        if title.is_empty() {
            lines.reverse();
        }
        for l in lines {
            let low = l.to_lowercase();
            if in_title || words.iter().all(|w| low.contains(w.as_str())) {
                found.push(if title.is_empty() { l.trim().to_string() } else { format!("[{title}] {}", l.trim()) });
                if found.len() >= MAX_FOUND {
                    return found;
                }
            }
        }
    }
    found
}

/// Is `agent` connected to the chat now (as the server sees it)?
async fn online(srv: &Server, agent: &str) -> bool {
    ac::get(srv, "/api/presence", 8).await.ok().and_then(|v| v.get(agent).and_then(|p| p.get("online")).and_then(Value::as_bool)).unwrap_or(false)
}

/// memory_search: this PC's memory; then the copy of the other PC's; only
/// when both have nothing, the other PC itself, when it is on.
pub async fn search(app: &AppHandle, query: &str, month: &str) -> Result<String, String> {
    let (q, m) = (query.to_string(), month.to_string());
    let own = tauri::async_runtime::spawn_blocking(move || crate::memory::search(&q, &m)).await.map_err(|e| e.to_string())??;
    let Some(from) = source(app) else { return Ok(own) };
    let nothing = own == t("Niente in memoria su questo.");
    let (dir, q) = (copy_dir(&from), query.to_string());
    let copy = tauri::async_runtime::spawn_blocking(move || search_copy(&dir, &q)).await.unwrap_or_default();
    if !copy.is_empty() {
        let head = tf("Dalla memoria di {pc} (copia):", &[("pc", &from)]);
        return Ok(if nothing { format!("{head}\n{}", copy.join("\n")) } else { format!("{own}\n\n{head}\n{}", copy.join("\n")) });
    }
    if !nothing {
        return Ok(own);
    }
    let Some(srv) = ac::connected() else { return Ok(own) };
    if !online(&srv, &from).await {
        return Ok(tf("Niente in memoria su questo, nemmeno nella copia della memoria di {pc} ({pc} è spento).", &[("pc", &from)]));
    }
    let asked = match ac::client(20) {
        Ok(c) => c.post(format!("{}/api/memory/{}/ask", srv.url, ac::query(&from))).bearer_auth(&srv.token).json(&json!({ "query": query })).send().await.map_err(|e| ac::net_error(&e)),
        Err(e) => Err(e),
    };
    let reply = match asked {
        Ok(resp) => ac::answer(resp).await.ok().and_then(|v| v.get("answer").and_then(Value::as_str).map(str::to_string)),
        Err(_) => None,
    };
    Ok(match reply {
        Some(a) if !a.trim().is_empty() && a != t("Niente in memoria su questo.") => format!("{}\n{a}", tf("Dalla memoria di {pc}, chiesta adesso:", &[("pc", &from)])),
        Some(_) => tf("Niente in memoria su questo, nemmeno in quella di {pc}.", &[("pc", &from)]),
        None => tf("Niente in memoria su questo; {pc} non ha risposto.", &[("pc", &from)]),
    })
}

/// memory_note with `shared`: into the other PC's memory. It saves it itself
/// when on; when off the note goes into the copy now and reaches it later.
pub async fn note(app: &AppHandle, text: &str) -> Result<String, String> {
    let Some(from) = source(app) else {
        return Err(t("Nessuna memoria condivisa: in Impostazioni → Integrazioni → Agent Chat scegli di quale PC leggere la memoria.").into());
    };
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(t("Nota vuota.").into());
    }
    let srv = ac::connected().ok_or_else(|| t("Agent Chat non è collegato: la nota non può arrivare all'altro PC.").to_string())?;
    let resp = ac::client(20)?.post(format!("{}/api/memory/{}/note", srv.url, ac::query(&from))).bearer_auth(&srv.token).json(&json!({ "text": text })).send().await.map_err(|e| ac::net_error(&e))?;
    let v = ac::answer(resp).await?;
    if v.get("online").and_then(Value::as_bool) == Some(true) {
        return Ok(tf("Mandata a {pc}, che la salva nella sua memoria.", &[("pc", &from)]));
    }
    // Off: waiting next to the copy, so this PC finds it now; it goes when the copy has it.
    let me = ac::me().unwrap_or_default();
    let line = format!("- {}: {}\n", crate::memory::stamp().chars().take(10).collect::<String>(), tf("(da {pc}) {text}", &[("pc", &me), ("text", &text)]));
    let path = waiting_file(&from);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let mut current = std::fs::read_to_string(&path).unwrap_or_default();
    current.push_str(&line);
    std::fs::write(&path, current).map_err(|e| e.to_string())?;
    Ok(tf("{pc} è spento: nota salvata nella copia, la riceve quando si riaccende.", &[("pc", &from)]))
}

/// memory_page for a page that is only in the copy.
pub fn page(app: &AppHandle, title: &str) -> Option<String> {
    let from = source(app)?;
    let want = title.trim().to_lowercase();
    let dir = copy_dir(&from).join("pagine");
    let hit = std::fs::read_dir(&dir).ok()?.flatten().find(|e| e.path().file_stem().is_some_and(|s| s.to_string_lossy().to_lowercase() == want))?;
    let text = std::fs::read_to_string(hit.path()).ok()?;
    Some(format!("{}\n\n{}", tf("(Pagina della memoria di {pc}, copia: si legge soltanto.)", &[("pc", &from)]), text.trim_end()))
}

/// In front of a new conversation, when there is another PC's memory.
pub fn preface(app: &AppHandle) -> Option<String> {
    let from = source(app)?;
    Some(tf("[C'è anche la memoria di {pc}, l'altro PC dell'utente, tenuta separata: memory_search la guarda da sola dopo questa. Una cosa di {pc} (lavoro, clienti, progetti di lì) si salva lì con memory_note e shared: true, non qui.]\n\n", &[("pc", &from)]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_memory_paths_land_on_disk() {
        assert!(safe_path("MEMORIA.md").is_some());
        assert!(safe_path("pagine/Studio Rossi.md").is_some());
        assert!(safe_path("../x.md").is_none());
        assert!(safe_path("pagine/../../x.md").is_none());
        assert!(safe_path("pagine/a\\b.md").is_none());
        assert!(safe_path("pagine/x.exe").is_none());
        assert!(safe_path("diario/2026-11.md").is_none());
        assert!(safe_path("C:/x.md").is_none());
    }

    #[test]
    fn the_copy_is_written_whole_and_searched() {
        let dir = std::env::temp_dir().join(format!("easyisland-memshare-{}", std::process::id())).join("lavoro");
        let mut files = serde_json::Map::new();
        files.insert("MEMORIA.md".into(), json!("# Memoria\n\n- 2026-11-01: Rossi paga a 60 giorni\n- 2026-11-02: backup NAS alle 3\n"));
        files.insert("pagine/Studio Bianchi.md".into(), json!("# Studio Bianchi\nriassunto: commercialisti a Torino\n- usa: [[NAS Synology]]\n"));
        files.insert("../fuori.md".into(), json!("no"));
        assert!(write_copy(&dir, &files));
        assert!(!dir.parent().unwrap().join("fuori.md").exists());
        assert_eq!(search_copy(&dir, "rossi"), vec!["- 2026-11-01: Rossi paga a 60 giorni"]);
        assert!(search_copy(&dir, "bianchi").iter().all(|l| l.starts_with("[Studio Bianchi]")));
        assert!(search_copy(&dir, "torino").iter().any(|l| l.contains("commercialisti")));
        assert!(search_copy(&dir, "nessuno qui").is_empty());
        // A newer snapshot without a page: the page goes away.
        files.remove("pagine/Studio Bianchi.md");
        assert!(write_copy(&dir, &files));
        assert!(search_copy(&dir, "bianchi").is_empty());
        // A note left from home while work was off goes when the copy has it.
        let waiting = dir.parent().unwrap().join("lavoro.in-attesa.md");
        std::fs::write(&waiting, "- 2026-11-02: (da casa) Verdi passa a fibra\n- 2026-11-02: (da casa) altro\n").unwrap();
        files.insert("MEMORIA.md".into(), json!("- 2026-11-03: (da casa) Verdi passa a fibra\n"));
        assert!(write_copy(&dir, &files));
        drop_arrived(&waiting, &dir);
        assert_eq!(std::fs::read_to_string(&waiting).unwrap(), "- 2026-11-02: (da casa) altro\n");
        files.insert("MEMORIA.md".into(), json!("- 2026-11-03: (da casa) Verdi passa a fibra\n- 2026-11-03: (da casa) altro\n"));
        assert!(write_copy(&dir, &files));
        drop_arrived(&waiting, &dir);
        assert!(!waiting.exists());
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }
}
