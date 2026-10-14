// The morning and end-of-day recap (src/island/daily.ts shows it): the
// repositories with changes not committed yet, the pull requests waiting, and
// the agents' time (counted by recap.rs, summed up in the island).
//
// Which repositories: the git roots of the folders where the coding agents
// worked (every hook event's cwd, see `note`). Only their paths are kept, in
// repos.json in %LOCALAPPDATA%\EasyIsland, at most MAX_REPOS, forgotten after
// FORGET_DAYS without an agent there; nothing in it leaves the PC.
// The state is asked of git when the card opens (`git status`), the pull
// requests of GitHub through the user's own `gh`, else the GitHub token of the
// integration. Off with Impostazioni → Agenti → Riepilogo del giorno.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_REPOS: usize = 40;
const FORGET_DAYS: i64 = 30;
const GIT_TIMEOUT: Duration = Duration::from_secs(8);
const GH_TIMEOUT: Duration = Duration::from_secs(15);
/// Repositories shown at most (the busiest first).
const SHOW_REPOS: usize = 8;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Known {
    path: String,
    /// Unix seconds of the last agent event there.
    seen: i64,
}

#[derive(Default)]
struct Store {
    repos: Vec<Known>,
    loaded: bool,
    /// cwd → git root (None = not in a repository), so an event costs no disk access.
    roots: Option<HashMap<String, Option<String>>>,
}

static STORE: Mutex<Store> = Mutex::new(Store { repos: Vec::new(), loaded: false, roots: None });

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn file() -> PathBuf {
    crate::settings::local_dir().join("repos.json")
}

fn load(store: &mut Store) {
    if store.loaded {
        return;
    }
    store.loaded = true;
    store.repos = std::fs::read(file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
}

fn save(repos: &[Known]) {
    if let Ok(bytes) = serde_json::to_vec_pretty(repos) {
        if let Err(e) = crate::settings::write_atomic(&file(), &bytes) {
            crate::log::line(format!("repos.json: {e}"));
        }
    }
}

/// The folder holding `.git` (a folder, or a file for a worktree) at or above `cwd`.
fn git_root(cwd: &Path) -> Option<PathBuf> {
    let mut dir = Some(cwd);
    for _ in 0..12 {
        let d = dir?;
        if d.join(".git").exists() {
            return Some(d.to_path_buf());
        }
        dir = d.parent();
    }
    None
}

/// Adds or refreshes `root`, keeps the list short. True when it changed enough to save.
fn remember(repos: &mut Vec<Known>, root: &str, at: i64) -> bool {
    let key = root.to_lowercase();
    let changed = match repos.iter_mut().find(|k| k.path.to_lowercase() == key) {
        // Refreshed at most once an hour: an event is not a disk write.
        Some(k) if at - k.seen < 3600 => false,
        Some(k) => {
            k.seen = at;
            true
        }
        None => {
            repos.push(Known { path: root.to_string(), seen: at });
            true
        }
    };
    let before = repos.len();
    repos.retain(|k| at - k.seen < FORGET_DAYS * 86_400);
    repos.sort_by(|a, b| b.seen.cmp(&a.seen));
    repos.truncate(MAX_REPOS);
    changed || repos.len() != before
}

/// One agent event (recap.rs passes them all): remember the repository it ran in.
pub fn note(payload: &Value) {
    let Some(cwd) = payload.get("cwd").and_then(Value::as_str).filter(|c| !c.is_empty() && c.len() < 1024) else { return };
    let mut store = STORE.lock().unwrap_or_else(|e| e.into_inner());
    load(&mut store);
    let roots = store.roots.get_or_insert_with(HashMap::new);
    let root = match roots.get(cwd) {
        Some(r) => r.clone(),
        None => {
            let r = git_root(Path::new(cwd)).map(|p| p.to_string_lossy().into_owned());
            if roots.len() > 500 {
                roots.clear();
            }
            roots.insert(cwd.to_string(), r.clone());
            r
        }
    };
    let Some(root) = root else { return };
    if remember(&mut store.repos, &root, now()) {
        let list = store.repos.clone();
        drop(store);
        save(&list);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoState {
    pub name: String,
    pub path: String,
    pub branch: String,
    /// Files changed, added or not tracked yet.
    pub changed: u32,
    /// Commits not pushed.
    pub ahead: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub title: String,
    pub repo: String,
    pub url: String,
    pub number: u64,
    /// Waiting for the user's review (else: the user's own, waiting for others).
    pub review: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Digest {
    pub repos: Vec<RepoState>,
    /// None when neither `gh` nor a GitHub token is there.
    pub prs: Option<Vec<PullRequest>>,
}

/// `git status --porcelain --branch`: branch, files changed, commits ahead.
fn parse_status(out: &str) -> (String, u32, u32) {
    let mut branch = String::new();
    let mut ahead = 0;
    let mut changed = 0;
    for line in out.lines() {
        if let Some(head) = line.strip_prefix("## ") {
            let name = head.split("...").next().unwrap_or(head);
            branch = name.strip_prefix("No commits yet on ").unwrap_or(name).split(' ').next().unwrap_or_default().to_string();
            if let Some(i) = head.find("[ahead ") {
                ahead = head.get(i + 7..).unwrap_or_default().chars().take_while(char::is_ascii_digit).collect::<String>().parse().unwrap_or(0);
            }
        } else if !line.trim().is_empty() {
            changed += 1;
        }
    }
    (branch, changed, ahead)
}

async fn run(program: &str, args: &[&str], dir: Option<&Path>, timeout: Duration) -> Option<String> {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).kill_on_drop(true);
    if let Some(d) = dir {
        cmd.current_dir(d);
    }
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = tokio::time::timeout(timeout, cmd.output()).await.ok()?.ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

async fn repo_state(path: String) -> Option<RepoState> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return None;
    }
    let out = run("git", &["status", "--porcelain=v1", "--branch"], Some(&dir), GIT_TIMEOUT).await?;
    let (branch, changed, ahead) = parse_status(&out);
    let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone());
    Some(RepoState { name, path, branch, changed, ahead })
}

/// `gh search prs … --json` → pull requests.
fn parse_prs(json: &str, review: bool) -> Vec<PullRequest> {
    let Ok(Value::Array(list)) = serde_json::from_str::<Value>(json) else { return Vec::new() };
    list.iter()
        .filter_map(|p| {
            Some(PullRequest {
                title: p.get("title")?.as_str()?.chars().take(160).collect(),
                repo: p.pointer("/repository/nameWithOwner").or_else(|| p.pointer("/repository/name")).and_then(Value::as_str).unwrap_or_default().to_string(),
                url: p.get("url").and_then(Value::as_str).filter(|u| u.starts_with("https://")).map(str::to_string)?,
                number: p.get("number").and_then(Value::as_u64).unwrap_or(0),
                review,
            })
        })
        .collect()
}

/// The search API's answer (the token way) → pull requests.
fn parse_search(v: &Value, review: bool) -> Vec<PullRequest> {
    let Some(items) = v.get("items").and_then(Value::as_array) else { return Vec::new() };
    items
        .iter()
        .filter_map(|p| {
            let url = p.get("html_url")?.as_str()?.to_string();
            // https://github.com/owner/repo/pull/12 → owner/repo
            let repo = url.strip_prefix("https://github.com/")?.split("/pull/").next()?.to_string();
            Some(PullRequest { title: p.get("title")?.as_str()?.chars().take(160).collect(), repo, url, number: p.get("number").and_then(Value::as_u64).unwrap_or(0), review })
        })
        .collect()
}

async fn prs_with_gh() -> Option<Vec<PullRequest>> {
    let fields = "number,title,url,repository";
    let review = run("gh", &["search", "prs", "--state=open", "--review-requested=@me", "--json", fields, "--limit", "10"], None, GH_TIMEOUT).await?;
    let mine = run("gh", &["search", "prs", "--state=open", "--author=@me", "--json", fields, "--limit", "10"], None, GH_TIMEOUT).await.unwrap_or_default();
    let mut all = parse_prs(&review, true);
    all.extend(parse_prs(&mine, false));
    Some(all)
}

async fn prs_with_token() -> Option<Vec<PullRequest>> {
    let token = crate::secrets::get("github-token")?;
    let http = reqwest::Client::builder().timeout(GH_TIMEOUT).build().ok()?;
    let mut all = Vec::new();
    for (q, review) in [("is:open is:pr review-requested:@me archived:false", true), ("is:open is:pr author:@me archived:false", false)] {
        let r = http
            .get(format!("https://api.github.com/search/issues?per_page=10&q={}", q.replace(' ', "+")))
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "EasyIsland")
            .send()
            .await
            .ok()?;
        if !r.status().is_success() {
            return None;
        }
        all.extend(parse_search(&r.json::<Value>().await.ok()?, review));
    }
    Some(all)
}

/// What the morning and end-of-day card shows.
#[tauri::command]
pub async fn daily_digest() -> Digest {
    let paths: Vec<String> = {
        let mut store = STORE.lock().unwrap_or_else(|e| e.into_inner());
        load(&mut store);
        store.repos.iter().map(|k| k.path.clone()).collect()
    };
    // A few git processes at a time, not forty at once.
    let mut repos = Vec::new();
    for chunk in paths.chunks(6) {
        let tasks: Vec<_> = chunk.iter().cloned().map(|p| tauri::async_runtime::spawn(repo_state(p))).collect();
        for t in tasks {
            if let Ok(Some(r)) = t.await {
                if r.changed > 0 || r.ahead > 0 {
                    repos.push(r);
                }
            }
        }
    }
    repos.sort_by(|a, b| (b.changed + b.ahead).cmp(&(a.changed + a.ahead)));
    repos.truncate(SHOW_REPOS);
    let prs = match prs_with_gh().await {
        Some(p) => Some(p),
        None => prs_with_token().await,
    };
    crate::log::line(format!("riepilogo del giorno: {} repository, {} PR", repos.len(), prs.as_ref().map_or(0, Vec::len)));
    Digest { repos, prs }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_git_status() {
        let out = "## main...origin/main [ahead 2, behind 1]\n M src/a.ts\n?? nuovo.txt\n";
        assert_eq!(parse_status(out), ("main".into(), 2, 2));
        assert_eq!(parse_status("## No commits yet on main\n"), ("main".into(), 0, 0));
        assert_eq!(parse_status("## feature/x\n D b.rs\n"), ("feature/x".into(), 1, 0));
        assert_eq!(parse_status("## main...origin/main [ahead à"), ("main".into(), 0, 0));
        assert_eq!(parse_status(""), (String::new(), 0, 0));
    }

    #[test]
    fn remembers_recent_repositories_only() {
        let mut repos = Vec::new();
        let day = 86_400;
        assert!(remember(&mut repos, "C:\\a", 100 * day));
        assert!(!remember(&mut repos, "c:\\A", 100 * day + 60), "same repository, within the hour");
        assert!(remember(&mut repos, "C:\\b", 100 * day + 2 * 3600));
        assert_eq!(repos[0].path, "C:\\b", "most recent first");
        assert!(remember(&mut repos, "C:\\c", 140 * day));
        assert_eq!(repos.iter().map(|k| k.path.as_str()).collect::<Vec<_>>(), vec!["C:\\c"], "a month without agents: forgotten");
        for i in 0..60 {
            remember(&mut repos, &format!("C:\\r{i}"), 140 * day + i);
        }
        assert_eq!(repos.len(), MAX_REPOS);
    }

    #[test]
    fn finds_the_git_root() {
        let base = std::env::temp_dir().join(format!("easyisland-daily-{}", std::process::id()));
        let deep = base.join("src").join("lib");
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::create_dir_all(base.join(".git")).unwrap();
        assert_eq!(git_root(&deep), Some(base.clone()));
        let _ = std::fs::remove_dir_all(&base);
        assert_eq!(git_root(Path::new("Z:\\non\\esiste\\davvero")), None);
    }

    #[test]
    fn reads_pull_requests() {
        let gh = r#"[{"number":12,"title":"Corregge il menu","url":"https://github.com/o/r/pull/12","repository":{"name":"r","nameWithOwner":"o/r"}},{"title":"senza url"}]"#;
        let prs = parse_prs(gh, true);
        assert_eq!(prs.len(), 1);
        assert_eq!((prs[0].repo.as_str(), prs[0].number, prs[0].review), ("o/r", 12, true));
        assert!(parse_prs("non json", false).is_empty());
        let api = json!({ "items": [{ "title": "Nuova card", "number": 3, "html_url": "https://github.com/a/b/pull/3" }, { "title": "x" }] });
        let prs = parse_search(&api, false);
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].repo, "a/b");
    }
}
