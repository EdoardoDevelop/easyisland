// The git branch of a chat's project, for the «Progetto…» button (views/chat.ts).
// Read from `.git/HEAD`: no git process, nothing to install, no window that flashes.

use std::fs;
use std::path::Path;

/// `ref: refs/heads/x/y` → `x/y`; a detached HEAD → its short hash.
fn head_of(text: &str) -> Option<String> {
    let text = text.trim();
    if let Some(reference) = text.strip_prefix("ref:") {
        let reference = reference.trim();
        let name = reference.strip_prefix("refs/heads/").unwrap_or(reference);
        return (!name.is_empty()).then(|| name.to_string());
    }
    text.get(..7).filter(|h| h.chars().all(|c| c.is_ascii_hexdigit())).map(str::to_string)
}

/// The branch of the repository holding `folder`, if there is one. In a worktree
/// or a submodule `.git` is a file that says where the real folder is.
pub fn of(folder: &Path) -> Option<String> {
    for dir in folder.ancestors() {
        let git = dir.join(".git");
        if git.is_dir() {
            return head_of(&fs::read_to_string(git.join("HEAD")).ok()?);
        }
        if git.is_file() {
            let text = fs::read_to_string(&git).ok()?;
            let real = dir.join(text.trim().strip_prefix("gitdir:")?.trim());
            return head_of(&fs::read_to_string(real.join("HEAD")).ok()?);
        }
    }
    None
}

/// The repository's own folder (with `.git` as a folder) holding `folder`.
fn repo_root(folder: &Path) -> Option<std::path::PathBuf> {
    folder.ancestors().find(|d| d.join(".git").is_dir()).map(Path::to_path_buf)
}

/// «Copia separata (worktree)» in «Progetto…», as Claude Desktop gives each
/// session one: a git worktree on a branch of its own under
/// `<repository>/.claude/worktrees/`, so two conversations never touch the same
/// files. Made by git itself (it has to be installed); `.claude/worktrees/`
/// goes in `.git/info/exclude`, so the repository does not list it. The
/// worktree is never deleted by EasyIsland: `git worktree remove` when done.
pub fn new_worktree(folder: &Path) -> Result<std::path::PathBuf, String> {
    use crate::i18n::{t, tf};
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;
    let root = repo_root(folder).ok_or_else(|| t("Questa cartella non è in un repository git.").to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let name = format!("easyisland-{}", radix36(stamp));
    let path = root.join(".claude").join("worktrees").join(&name);
    let mut cmd = std::process::Command::new("git");
    cmd.arg("-C").arg(&root).args(["worktree", "add", "-b", &format!("easyisland/{name}")]).arg(&path);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let out = cmd.output().map_err(|e| tf("git non si avvia (è installato?): {e}", &[("e", &e)]))?;
    if !out.status.success() {
        let why = String::from_utf8_lossy(&out.stderr).trim().chars().take(300).collect::<String>();
        return Err(tf("git non ha creato la copia separata: {e}", &[("e", &why)]));
    }
    let exclude = root.join(".git").join("info").join("exclude");
    let had = fs::read_to_string(&exclude).unwrap_or_default();
    if !had.lines().any(|l| l.trim() == ".claude/worktrees/") {
        let _ = fs::create_dir_all(root.join(".git").join("info"));
        let _ = fs::write(&exclude, format!("{}{}.claude/worktrees/\n", had, if had.is_empty() || had.ends_with('\n') { "" } else { "\n" }));
    }
    crate::log::line(format!("chat: copia separata {}", path.display()));
    Ok(path)
}

fn radix36(mut n: u64) -> String {
    const D: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    loop {
        out.push(D[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real git: `cargo test --lib gitbranch::tests::live_worktree -- --ignored`
    #[test]
    #[ignore]
    fn live_worktree() {
        let root = std::env::temp_dir().join(format!("ei-wt-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let git = |args: &[&str]| assert!(std::process::Command::new("git").arg("-C").arg(&root).args(args).output().unwrap().status.success(), "{args:?}");
        git(&["init", "-q"]);
        fs::write(root.join("a.txt"), "uno").unwrap();
        git(&["add", "."]);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "primo"]);
        let tree = new_worktree(&root).unwrap();
        assert!(tree.join("a.txt").is_file());
        assert!(of(&tree).unwrap().starts_with("easyisland/"));
        assert!(fs::read_to_string(root.join(".git/info/exclude")).unwrap().contains(".claude/worktrees/"));
        git(&["worktree", "remove", "--force", &tree.display().to_string()]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reads_branches_and_detached_heads() {
        assert_eq!(head_of("ref: refs/heads/claude/sviluppo\n").as_deref(), Some("claude/sviluppo"));
        assert_eq!(head_of("a81fbd4c0ffee\n").as_deref(), Some("a81fbd4"));
        assert_eq!(head_of("ref: "), None);
        assert_eq!(head_of("non è un hash"), None);
        assert_eq!(head_of(""), None);
    }

    #[test]
    fn finds_the_repository_from_a_subfolder_and_a_worktree() {
        let root = std::env::temp_dir().join(format!("easyisland-branch-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let sub = root.join("repo").join("src");
        fs::create_dir_all(&sub).unwrap();
        fs::create_dir_all(root.join("repo").join(".git")).unwrap();
        fs::write(root.join("repo").join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
        assert_eq!(of(&sub).as_deref(), Some("main"));

        let tree = root.join("tree");
        let real = root.join("real");
        fs::create_dir_all(&tree).unwrap();
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("HEAD"), "ref: refs/heads/prova\n").unwrap();
        fs::write(tree.join(".git"), format!("gitdir: {}\n", real.display())).unwrap();
        assert_eq!(of(&tree).as_deref(), Some("prova"));
        let _ = fs::remove_dir_all(&root);
    }
}
