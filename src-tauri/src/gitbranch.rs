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

#[cfg(test)]
mod tests {
    use super::*;

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
