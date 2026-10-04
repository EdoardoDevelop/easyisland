//! What a file edit changed, for the island's live diff (HANDOFF 6.6, point 1).
//!
//! Built here, in the relay, because only the relay sees the hook payload whole:
//! everything forwarded to the island is cut to `MAX_FIELD_LEN` per string, and
//! `tool_response` is not forwarded at all. Nothing is ever read from disk — the
//! diff comes from the payload alone:
//! * Claude Code's own `tool_response.structuredPatch` when it is there (real
//!   line numbers, three lines of context, exactly what was applied);
//! * otherwise `old_string` / `new_string` (Edit, each of MultiEdit's `edits`)
//!   or `content` (Write, every line added).
//!
//! The result travels as `easyisland_diff`:
//! `{ file, added, removed, too_big, hunks: [{ old, new, lines: ["+…", "-…", " …"] }] }`.
//! `old` / `new` are first line numbers, 0 when unknown (the fallback).

use serde_json::{json, Value};

/// Past either limit only the line counts travel ("Diff troppo grande").
const MAX_BYTES: usize = 200_000;
const MAX_LINES: usize = 4_000;
/// Fallback diff of two snippets: beyond this many cells, every old line is
/// shown removed and every new one added instead of computing the alignment.
const MAX_LCS_CELLS: usize = 1_000_000;

struct Hunk {
    old: u64,
    new: u64,
    lines: Vec<String>,
}

/// The diff of one Edit / MultiEdit / Write, or None for any other tool.
pub fn file_diff(tool: &str, input: &Value, response: Option<&Value>) -> Option<Value> {
    if !matches!(tool, "Edit" | "MultiEdit" | "Write") {
        return None;
    }
    let file = input.get("file_path").and_then(Value::as_str).filter(|f| !f.is_empty())?;
    let hunks = from_patch(response).unwrap_or_else(|| from_input(tool, input, response));

    let (mut added, mut removed, mut bytes, mut count) = (0u64, 0u64, 0usize, 0usize);
    for line in hunks.iter().flat_map(|h| &h.lines) {
        match line.as_bytes().first() {
            Some(b'+') => added += 1,
            Some(b'-') => removed += 1,
            _ => {}
        }
        bytes += line.len();
        count += 1;
    }
    let too_big = bytes > MAX_BYTES || count > MAX_LINES;
    let hunks: Vec<Value> = if too_big {
        Vec::new()
    } else {
        hunks.into_iter().map(|h| json!({ "old": h.old, "new": h.new, "lines": h.lines })).collect()
    };
    Some(json!({ "file": file, "added": added, "removed": removed, "too_big": too_big, "hunks": hunks }))
}

/// Claude Code's `structuredPatch`, when present and non-empty.
fn from_patch(response: Option<&Value>) -> Option<Vec<Hunk>> {
    let patch = response?.get("structuredPatch")?.as_array()?;
    if patch.is_empty() {
        return None;
    }
    let hunks: Vec<Hunk> = patch
        .iter()
        .filter_map(|h| {
            let lines = h.get("lines")?.as_array()?;
            Some(Hunk {
                old: h.get("oldStart").and_then(Value::as_u64).unwrap_or(0),
                new: h.get("newStart").and_then(Value::as_u64).unwrap_or(0),
                lines: lines.iter().filter_map(|l| l.as_str().map(str::to_string)).collect(),
            })
        })
        .collect();
    (!hunks.is_empty()).then_some(hunks)
}

fn from_input(tool: &str, input: &Value, response: Option<&Value>) -> Vec<Hunk> {
    let s = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    match tool {
        "Edit" => vec![snippet(&s(input, "old_string"), &s(input, "new_string"))],
        "MultiEdit" => input
            .get("edits")
            .and_then(Value::as_array)
            .map(|edits| edits.iter().map(|e| snippet(&s(e, "old_string"), &s(e, "new_string"))).collect())
            .unwrap_or_default(),
        _ => {
            // Write with no patch: a new file (or an untouched one, then nothing changed).
            let created = response
                .and_then(|r| r.get("type"))
                .and_then(Value::as_str)
                .map_or(true, |t| t == "create");
            if !created {
                return Vec::new();
            }
            let content = s(input, "content");
            vec![Hunk { old: 0, new: 1, lines: split(&content).map(|l| format!("+{l}")).collect() }]
        }
    }
}

fn split(text: &str) -> impl Iterator<Item = &str> {
    // "a\nb\n" is two lines, not three; "" is none.
    text.strip_suffix('\n').unwrap_or(text).split('\n').filter(move |_| !text.is_empty()).map(|l| l.strip_suffix('\r').unwrap_or(l))
}

/// Line diff of an Edit's two snippets (no line numbers: the snippet's place in
/// the file is unknown without reading it, and we don't).
fn snippet(old: &str, new: &str) -> Hunk {
    let a: Vec<&str> = split(old).collect();
    let b: Vec<&str> = split(new).collect();
    let mut lines = Vec::new();
    if a.len().saturating_mul(b.len()) > MAX_LCS_CELLS {
        lines.extend(a.iter().map(|l| format!("-{l}")));
        lines.extend(b.iter().map(|l| format!("+{l}")));
        return Hunk { old: 0, new: 0, lines };
    }
    // Classic LCS table, then walk it front to back.
    let (n, m) = (a.len(), b.len());
    let mut lcs = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[i][j] = if a[i] == b[j] { lcs[i + 1][j + 1] + 1 } else { lcs[i + 1][j].max(lcs[i][j + 1]) };
        }
    }
    let (mut i, mut j) = (0, 0);
    while i < n || j < m {
        if i < n && j < m && a[i] == b[j] {
            lines.push(format!(" {}", a[i]));
            i += 1;
            j += 1;
        } else if j < m && (i == n || lcs[i][j + 1] >= lcs[i + 1][j]) {
            lines.push(format!("+{}", b[j]));
            j += 1;
        } else {
            lines.push(format!("-{}", a[i]));
            i += 1;
        }
    }
    Hunk { old: 0, new: 0, lines }
}

/// Claude's last words in a finished session: `last_assistant_message` when
/// Claude Code sends it, otherwise the last text of the transcript's tail.
pub fn last_message(payload: &serde_json::Map<String, Value>) -> Option<String> {
    if let Some(m) = payload.get("last_assistant_message").and_then(Value::as_str) {
        let m = m.trim();
        if !m.is_empty() {
            return Some(m.to_string());
        }
    }
    let path = payload.get("transcript_path").and_then(Value::as_str)?;
    last_text_in(&tail(std::path::Path::new(path), 512 * 1024)?)
}

/// The last `max` bytes of a file, from the start of a line.
fn tail(path: &std::path::Path, max: u64) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let start = len.saturating_sub(max);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    Some(if start > 0 { text.split_once('\n').map(|(_, rest)| rest.to_string()).unwrap_or_default() } else { text })
}

/// The newest assistant entry of a transcript (JSON lines) that has text.
fn last_text_in(jsonl: &str) -> Option<String> {
    for line in jsonl.lines().rev() {
        let Ok(entry) = serde_json::from_str::<Value>(line) else { continue };
        // Claude Code: {"type":"assistant","message":{"content":[{"type":"text"…}]}};
        // Codex: {"type":"response_item","payload":{"role":"assistant","content":[{"type":"output_text"…}]}}.
        let content = match entry.get("type").and_then(Value::as_str) {
            Some("assistant") => entry.pointer("/message/content"),
            Some("response_item") if entry.pointer("/payload/role").and_then(Value::as_str) == Some("assistant") => {
                entry.pointer("/payload/content")
            }
            _ => None,
        };
        let Some(content) = content.and_then(Value::as_array) else { continue };
        let text: Vec<&str> = content
            .iter()
            .filter(|c| matches!(c.get("type").and_then(Value::as_str), Some("text" | "output_text")))
            .filter_map(|c| c.get("text").and_then(Value::as_str))
            .collect();
        let text = text.join("\n").trim().to_string();
        if !text.is_empty() {
            return Some(text);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structured_patch_wins() {
        let input = json!({ "file_path": "C:\\p\\a.ts", "old_string": "x", "new_string": "y" });
        let response = json!({ "structuredPatch": [
            { "oldStart": 10, "oldLines": 3, "newStart": 10, "newLines": 4, "lines": [" a", "-b", "+c", "+d", " e"] }
        ]});
        let d = file_diff("Edit", &input, Some(&response)).unwrap();
        assert_eq!(d["file"], "C:\\p\\a.ts");
        assert_eq!((d["added"].as_u64(), d["removed"].as_u64()), (Some(2), Some(1)));
        assert_eq!(d["hunks"][0]["old"], 10);
        assert_eq!(d["hunks"][0]["lines"][1], "-b");
        assert_eq!(d["too_big"], false);
    }

    #[test]
    fn edit_without_patch_is_diffed_from_the_snippets() {
        let input = json!({ "file_path": "a.rs", "old_string": "one\ntwo\nthree", "new_string": "one\n2\nthree\nfour" });
        let d = file_diff("Edit", &input, None).unwrap();
        let lines: Vec<&str> = d["hunks"][0]["lines"].as_array().unwrap().iter().map(|l| l.as_str().unwrap()).collect();
        assert_eq!(lines, [" one", "+2", "-two", " three", "+four"]);
        assert_eq!((d["added"].as_u64(), d["removed"].as_u64()), (Some(2), Some(1)));
        assert_eq!(d["hunks"][0]["old"], 0);
    }

    #[test]
    fn multiedit_gives_one_hunk_per_edit() {
        let input = json!({ "file_path": "a.rs", "edits": [
            { "old_string": "a", "new_string": "b" },
            { "old_string": "c\nd", "new_string": "c" },
        ]});
        let d = file_diff("MultiEdit", &input, None).unwrap();
        assert_eq!(d["hunks"].as_array().unwrap().len(), 2);
        assert_eq!((d["added"].as_u64(), d["removed"].as_u64()), (Some(1), Some(2)));
    }

    #[test]
    fn new_file_is_all_added() {
        let input = json!({ "file_path": "n.txt", "content": "a\r\nb\n" });
        let d = file_diff("Write", &input, Some(&json!({ "type": "create", "structuredPatch": [] }))).unwrap();
        assert_eq!(d["hunks"][0]["lines"], json!(["+a", "+b"]));
        assert_eq!(d["added"], 2);
        // An update with no patch changed nothing we can show.
        let same = file_diff("Write", &input, Some(&json!({ "type": "update", "structuredPatch": [] }))).unwrap();
        assert_eq!(same["added"], 0);
    }

    #[test]
    fn too_big_keeps_only_the_counts() {
        let content = "x\n".repeat(MAX_LINES + 1);
        let d = file_diff("Write", &json!({ "file_path": "big", "content": content }), None).unwrap();
        assert_eq!(d["too_big"], true);
        assert_eq!(d["added"], (MAX_LINES + 1) as u64);
        assert!(d["hunks"].as_array().unwrap().is_empty());
    }

    #[test]
    fn other_tools_and_missing_paths_give_nothing() {
        assert!(file_diff("Bash", &json!({ "command": "ls" }), None).is_none());
        assert!(file_diff("Edit", &json!({ "old_string": "a", "new_string": "b" }), None).is_none());
    }

    #[test]
    fn last_message_prefers_the_payload_then_the_transcript() {
        let mut p = serde_json::Map::new();
        p.insert("last_assistant_message".into(), json!("  Fatto.  "));
        assert_eq!(last_message(&p).as_deref(), Some("Fatto."));

        let jsonl = [
            json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "Prima" }] } }),
            json!({ "type": "user", "message": { "content": "ok" } }),
            json!({ "type": "assistant", "message": { "content": [
                { "type": "text", "text": "Ho finito" }, { "type": "text", "text": "tutto." }
            ] } }),
            json!({ "type": "assistant", "message": { "content": [{ "type": "tool_use", "name": "Bash" }] } }),
        ]
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n");
        assert_eq!(last_text_in(&jsonl).as_deref(), Some("Ho finito\ntutto."));
        assert_eq!(last_text_in("not json\n"), None);
        // Codex's rollout files.
        let codex = json!({ "type": "response_item", "payload": { "type": "message", "role": "assistant",
            "content": [{ "type": "output_text", "text": "Patch applicata." }] } });
        assert_eq!(last_text_in(&codex.to_string()).as_deref(), Some("Patch applicata."));
    }
}
