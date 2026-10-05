//! What a test run really said, read from its output (not from what the agent
//! claims afterwards). Built here for the same reason as diff.rs: only the relay
//! sees `tool_response` (and a failure's `error`) whole.
//!
//! Only for commands that run tests (`npm test`, `cargo test`, `pytest`…). The
//! result travels as `easyisland_tests`:
//! `{ status: "passed" | "failed", passed, failed, skipped, known, unit, reason }`.
//! `known` is false when the summary could not be read and only the exit status
//! is known (a failed command); a run with no readable summary that did not fail
//! sends nothing — an unclear result never shows up as "passed".

use serde_json::{json, Map, Value};

#[derive(Default, Debug, PartialEq)]
struct Counts {
    passed: u64,
    failed: u64,
    skipped: u64,
    /// "test", or "pacchetti" for `go test` without -v (it only lists packages).
    unit: &'static str,
}

/// The verdict for a PostToolUse / PostToolUseFailure payload, or None.
pub fn verdict(event: &str, map: &Map<String, Value>) -> Option<Value> {
    let command = map.get("tool_input")?.get("command")?.as_str()?;
    if !is_test_command(command) {
        return None;
    }
    let mut out = String::new();
    collect(map.get("tool_response"), &mut out);
    collect(map.get("error"), &mut out);
    let text = strip_ansi(&out);
    let failed_run = event == "PostToolUseFailure";

    let counts = summary(&text);
    let (status, known) = match &counts {
        Some(c) if c.failed > 0 => ("failed", true),
        Some(c) if c.passed > 0 => ("passed", true),
        _ if failed_run => ("failed", false),
        _ => return None,
    };
    let c = counts.unwrap_or_default();
    let reason = if status == "failed" { first_failure(&text).unwrap_or_default() } else { String::new() };
    Some(json!({
        "status": status,
        "passed": c.passed,
        "failed": c.failed,
        "skipped": c.skipped,
        "known": known,
        "unit": if c.unit.is_empty() { "test" } else { c.unit },
        "reason": reason,
    }))
}

/// Every string in the response (stdout, stderr, output…), one after the other.
fn collect(v: Option<&Value>, out: &mut String) {
    match v {
        Some(Value::String(s)) => {
            out.push_str(s);
            out.push('\n');
        }
        Some(Value::Object(o)) => {
            for k in ["stdout", "stderr", "output", "content", "error"] {
                collect(o.get(k), out);
            }
        }
        Some(Value::Array(a)) => {
            for x in a {
                collect(Some(x), out);
            }
        }
        _ => {}
    }
}

/// "\x1b[31m✕\x1b[0m" → "✕": colours would split the words the parsers look for.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for d in chars.by_ref() {
                    if d.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        if c != '\r' {
            out.push(c);
        }
    }
    out
}

// ── Which commands run tests ─────────────────────────────────────────────────

fn is_test_command(cmd: &str) -> bool {
    let tokens: Vec<String> = cmd
        .split(|c: char| c.is_whitespace() || matches!(c, ';' | '&' | '|' | '(' | ')'))
        .filter(|t| !t.is_empty())
        .map(|t| {
            let t = t.trim_matches(|c| c == '"' || c == '\'').to_lowercase();
            let base = t.rsplit(['/', '\\']).next().unwrap_or(&t).to_string();
            base.trim_end_matches(".cmd").trim_end_matches(".exe").trim_end_matches(".bat").to_string()
        })
        .collect();
    let at = |i: usize| tokens.get(i).map(String::as_str).unwrap_or("");
    for i in 0..tokens.len() {
        let (a, b) = (at(i), at(i + 1));
        let single = matches!(a, "jest" | "vitest" | "mocha" | "pytest" | "py.test" | "phpunit" | "rspec" | "ctest" | "tox" | "invoke-pester" | "nextest");
        let runner_test = matches!(a, "npm" | "pnpm" | "yarn" | "bun" | "deno") && matches!(b, "test" | "t");
        let run_script = matches!(a, "npm" | "pnpm" | "yarn" | "bun") && b == "run" && at(i + 2).starts_with("test");
        let tool_test = matches!(a, "go" | "cargo" | "dotnet" | "mvn" | "gradle" | "gradlew" | "make" | "mix") && b == "test";
        let node_test = a == "node" && b == "--test";
        let py_module = matches!(a, "python" | "python3" | "py") && b == "-m" && matches!(at(i + 2), "pytest" | "unittest");
        let mvn_verify = a == "mvn" && b == "verify";
        if single || runner_test || run_script || tool_test || node_test || py_module || mvn_verify {
            return true;
        }
    }
    false
}

// ── Summaries ────────────────────────────────────────────────────────────────

/// Words of a line: numbers and lower-case words, punctuation dropped.
fn words(line: &str) -> Vec<String> {
    line.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// "1 failed, 12 passed": the number in front of each word starting with a key.
fn number_word(line: &str, c: &mut Counts) -> bool {
    let w = words(line);
    let mut any = false;
    for pair in w.windows(2) {
        let Ok(n) = pair[0].parse::<u64>() else { continue };
        let word = pair[1].as_str();
        if word.starts_with("pass") {
            c.passed += n;
        } else if word.starts_with("fail") || word.starts_with("error") {
            c.failed += n;
        } else if word.starts_with("skip") || word.starts_with("pending") || word.starts_with("ignored") || word == "todo" {
            c.skipped += n;
        } else {
            continue;
        }
        any = true;
    }
    any
}

/// "Failed: 1, Passed: 12": the number after each word.
fn word_number(line: &str, c: &mut Counts) -> bool {
    let w = words(line);
    let mut any = false;
    for pair in w.windows(2) {
        let Ok(n) = pair[1].parse::<u64>() else { continue };
        match pair[0].as_str() {
            "passed" => c.passed = n,
            "failed" | "failures" | "errors" => c.failed += n,
            "skipped" | "ignored" => c.skipped = n,
            _ => continue,
        }
        any = true;
    }
    any
}

fn summary(text: &str) -> Option<Counts> {
    let lines: Vec<&str> = text.lines().map(str::trim).collect();
    let mut c = Counts::default();

    // cargo: one "test result:" line per test binary, summed.
    let cargo: Vec<&&str> = lines.iter().filter(|l| l.starts_with("test result:")).collect();
    if !cargo.is_empty() {
        for l in cargo {
            number_word(l, &mut c);
        }
        return Some(c);
    }
    // jest ("Tests:       1 failed, 12 passed, 13 total") and vitest ("Tests  1 failed | 12 passed (13)").
    // The count comes right after "Tests" (not Pester's "Tests Passed: 12").
    if let Some(l) = lines.iter().rev().find(|l| {
        (l.starts_with("Tests:") || l.starts_with("Tests ")) && words(l).get(1).is_some_and(|n| n.parse::<u64>().is_ok())
    }) {
        if !l.contains("Assertions") && number_word(l, &mut c) {
            return Some(c);
        }
        c = Counts::default();
    }
    // maven / gradle: "Tests run: 13, Failures: 1, Errors: 0, Skipped: 0" (the last one is the total).
    if let Some(l) = lines.iter().rev().find(|l| l.contains("Tests run:")) {
        let w = words(l);
        let get = |k: &str| w.windows(2).find(|p| p[0] == k).and_then(|p| p[1].parse::<u64>().ok()).unwrap_or(0);
        let (run, fails, errors, skipped) = (get("run"), get("failures"), get("errors"), get("skipped"));
        c.failed = fails + errors;
        c.skipped = skipped;
        c.passed = run.saturating_sub(c.failed + skipped);
        return Some(c);
    }
    // phpunit: "OK (12 tests, 30 assertions)" or "Tests: 13, Assertions: 30, Failures: 1."
    if let Some(l) = lines.iter().rev().find(|l| l.starts_with("OK (") && l.contains(" test")) {
        // ["ok", "12", "tests", …]
        c.passed = words(l).get(1).and_then(|n| n.parse().ok()).unwrap_or(0);
        return Some(c);
    }
    if let Some(l) = lines.iter().rev().find(|l| l.starts_with("Tests:") && l.contains("Assertions")) {
        let w = words(l);
        let total = w.get(1).and_then(|n| n.parse::<u64>().ok()).unwrap_or(0);
        word_number(l, &mut c);
        c.passed = total.saturating_sub(c.failed + c.skipped);
        return Some(c);
    }
    // rspec: "13 examples, 1 failure, 2 pending".
    if let Some(l) = lines.iter().rev().find(|l| l.contains(" example") && (l.contains(" failure") || l.contains("examples, 0"))) {
        let w = words(l);
        let total = w.first().and_then(|n| n.parse::<u64>().ok()).unwrap_or(0);
        number_word(l, &mut c);
        c.passed = total.saturating_sub(c.failed + c.skipped);
        return Some(c);
    }
    // dotnet ("Passed!  - Failed: 0, Passed: 12, Skipped: 0") and Pester ("Tests Passed: 12, Failed: 1").
    if let Some(l) = lines.iter().rev().find(|l| l.contains("Passed:") && l.contains("Failed:")) {
        if word_number(l, &mut c) {
            return Some(c);
        }
        c = Counts::default();
    }
    // pytest: "===== 1 failed, 12 passed in 0.52s =====" or, with -q, "12 passed in 0.52s".
    if let Some(l) = lines.iter().rev().find(|l| {
        (l.contains(" passed") || l.contains(" failed") || l.contains(" error")) && l.contains(" in ") && l.trim_end_matches('=').trim_end().ends_with('s')
    }) {
        if number_word(l, &mut c) {
            return Some(c);
        }
        c = Counts::default();
    }
    // mocha: "12 passing (30ms)", "1 failing".
    let mocha: Vec<&&str> = lines.iter().filter(|l| l.contains(" passing") || l.contains(" failing") || l.contains(" pending")).collect();
    if !mocha.is_empty() && mocha.iter().any(|l| words(l).first().is_some_and(|w| w.parse::<u64>().is_ok())) {
        for l in mocha {
            number_word(l, &mut c);
        }
        return Some(c);
    }
    // node --test: "# pass 12" / "ℹ pass 12".
    let node: Vec<&&str> = lines.iter().filter(|l| l.starts_with("# ") || l.starts_with("ℹ ")).collect();
    for l in &node {
        let w = words(l);
        if let [k, n] = w.as_slice() {
            if let Ok(n) = n.parse::<u64>() {
                match k.as_str() {
                    "pass" => c.passed = n,
                    "fail" => c.failed = n,
                    "skipped" | "todo" => c.skipped += n,
                    _ => {}
                }
            }
        }
    }
    if c.passed + c.failed > 0 {
        return Some(c);
    }
    // go: "--- PASS: TestX" / "--- FAIL: TestX" with -v, otherwise one line per package.
    let fails = lines.iter().filter(|l| l.starts_with("--- FAIL:")).count() as u64;
    let passes = lines.iter().filter(|l| l.starts_with("--- PASS:")).count() as u64;
    if fails + passes > 0 {
        return Some(Counts { passed: passes, failed: fails, skipped: 0, unit: "test" });
    }
    let ok_pkgs = lines.iter().filter(|l| l.starts_with("ok ") || l.starts_with("ok\t")).count() as u64;
    let bad_pkgs = lines.iter().filter(|l| l.starts_with("FAIL\t") || l.starts_with("FAIL ")).count() as u64;
    if ok_pkgs + bad_pkgs > 0 {
        return Some(Counts { passed: ok_pkgs, failed: bad_pkgs, skipped: 0, unit: "pacchetti" });
    }
    None
}

// ── Why it failed ────────────────────────────────────────────────────────────

const MAX_REASON: usize = 140;

fn cut(s: &str) -> String {
    let s = s.trim();
    if s.chars().count() <= MAX_REASON {
        return s.to_string();
    }
    let mut out: String = s.chars().take(MAX_REASON - 1).collect();
    out.push('…');
    out
}

/// The first failure: which test, and the assertion when it is close by.
fn first_failure(text: &str) -> Option<String> {
    let lines: Vec<&str> = text.lines().collect();
    let near = |from: usize, keys: &[&str]| -> Option<String> {
        lines.iter().skip(from + 1).take(20).map(|l| l.trim()).find(|l| keys.iter().any(|k| l.starts_with(k))).map(str::to_string)
    };
    for (i, raw) in lines.iter().enumerate() {
        let l = raw.trim();
        // pytest's short summary: "FAILED tests/test_x.py::test_y - AssertionError: …"
        if let Some(rest) = l.strip_prefix("FAILED ") {
            return Some(cut(rest));
        }
        // jest: "● Suite › name", then "Expected: 3" / "Received: -1".
        if let Some(name) = l.strip_prefix("● ") {
            if name.starts_with("Test suite failed to run") {
                return Some(cut(near(i, &["Cannot", "Error", "SyntaxError", "TypeError"]).as_deref().unwrap_or(name)));
            }
            let exp = near(i, &["Expected:"]);
            let rec = near(i, &["Received:"]);
            return Some(match (exp, rec) {
                (Some(e), Some(r)) => cut(&format!("{name} — {e}, {r}")),
                _ => cut(name),
            });
        }
        // cargo: "---- tests::x stdout ----", then the panic message.
        if let Some(name) = l.strip_prefix("---- ").and_then(|r| r.strip_suffix(" stdout ----")) {
            let msg = lines.iter().skip(i + 1).take(10).position(|x| x.contains("panicked at")).and_then(|p| lines.get(i + 2 + p)).map(|x| x.trim());
            return Some(match msg {
                Some(m) if !m.is_empty() => cut(&format!("{name}: {m}")),
                _ => cut(name),
            });
        }
        // go: "--- FAIL: TestX (0.00s)", then "    x_test.go:12: got 1, want 2".
        if let Some(name) = l.strip_prefix("--- FAIL: ") {
            let name = name.split(" (").next().unwrap_or(name);
            let detail = lines.get(i + 1).map(|x| x.trim()).filter(|x| x.contains(".go:"));
            return Some(match detail {
                Some(d) => cut(&format!("{name}: {d}")),
                None => cut(name),
            });
        }
    }
    // Anything else: the first assertion-looking line.
    lines
        .iter()
        .map(|l| l.trim())
        .find(|l| l.starts_with("AssertionError") || l.starts_with("Error:") || l.starts_with("assert") || l.contains("Expected") && l.contains("but"))
        .map(cut)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(event: &str, command: &str, response: Value) -> Option<Value> {
        let v = json!({ "tool_input": { "command": command }, "tool_response": response });
        verdict(event, v.as_object().unwrap())
    }

    #[test]
    fn only_test_commands() {
        for cmd in ["npm test", "npm run test:unit", "pnpm t", "npx jest src", "cargo test --workspace", "go test ./...", "python -m pytest -q", "cd app && dotnet test", "node --test", "Invoke-Pester", "./node_modules/.bin/vitest run"] {
            assert!(is_test_command(cmd), "{cmd}");
        }
        for cmd in ["npm install", "git status", "cargo build", "echo test", "npm run build", "cat tests.txt"] {
            assert!(!is_test_command(cmd), "{cmd}");
        }
        assert!(run("PostToolUse", "npm install", json!({ "stdout": "Tests: 1 failed" })).is_none());
    }

    #[test]
    fn cargo_sums_every_binary() {
        let out = "running 3 tests\ntest result: ok. 91 passed; 0 failed; 4 ignored; 0 measured\n\
                   test result: ok. 19 passed; 0 failed; 0 ignored\n";
        let v = run("PostToolUse", "cargo test", json!({ "stdout": out, "stderr": "" })).unwrap();
        assert_eq!((v["status"].as_str(), v["passed"].as_u64(), v["skipped"].as_u64()), (Some("passed"), Some(110), Some(4)));
    }

    #[test]
    fn cargo_failure_with_reason() {
        let out = "---- tests::sum stdout ----\n\nthread 'tests::sum' panicked at src/lib.rs:5:9:\nassertion `left == right` failed\n  left: 1\n right: 2\n\n\
                   test result: FAILED. 4 passed; 1 failed; 0 ignored\n";
        assert!(run("PostToolUseFailure", "cargo test", json!(null)).is_some(), "a failed run with no output still says it failed");
        let p = json!({ "tool_input": { "command": "cargo test" }, "error": format!("Exit code 101\n{out}") });
        let v = verdict("PostToolUseFailure", p.as_object().unwrap()).unwrap();
        assert_eq!(v["status"], "failed");
        assert_eq!((v["passed"].as_u64(), v["failed"].as_u64()), (Some(4), Some(1)));
        assert_eq!(v["reason"], "tests::sum: assertion `left == right` failed");
    }

    #[test]
    fn jest_with_colours_and_expected() {
        let out = "\u{1b}[31m  ● math › adds\u{1b}[39m\n\n    expect(received).toBe(expected)\n\n    Expected: 3\n    Received: -1\n\n\
                   Tests:       \u{1b}[31m1 failed\u{1b}[39m, 12 passed, 13 total\n";
        let v = run("PostToolUseFailure", "npx jest", json!({ "stdout": out })).unwrap();
        assert_eq!((v["passed"].as_u64(), v["failed"].as_u64()), (Some(12), Some(1)));
        assert_eq!(v["reason"], "math › adds — Expected: 3, Received: -1");
    }

    #[test]
    fn other_runners() {
        let cases: &[(&str, &str, u64, u64)] = &[
            ("vitest run", " Test Files  1 failed | 3 passed (4)\n      Tests  2 failed | 30 passed (32)\n", 30, 2),
            ("pytest", "FAILED tests/test_a.py::test_x - AssertionError: 1 != 2\n===== 1 failed, 12 passed in 0.52s =====\n", 12, 1),
            ("pytest -q", "............\n12 passed in 0.31s\n", 12, 0),
            ("npx mocha", "  12 passing (30ms)\n  1 failing\n", 12, 1),
            ("node --test", "# tests 13\n# pass 12\n# fail 1\n", 12, 1),
            ("dotnet test", "Failed!  - Failed:     1, Passed:    12, Skipped:     0, Total:    13\n", 12, 1),
            ("mvn test", "Tests run: 5, Failures: 0, Errors: 0, Skipped: 0\nTests run: 13, Failures: 1, Errors: 0, Skipped: 2\n", 10, 1),
            ("phpunit", "OK (12 tests, 30 assertions)\n", 12, 0),
            ("rspec", "13 examples, 1 failure, 2 pending\n", 10, 1),
            ("go test -v ./...", "--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.00s)\n    b_test.go:12: got 1, want 2\nFAIL\n", 1, 1),
            ("Invoke-Pester", "Tests completed in 1.2s\nTests Passed: 12, Failed: 1, Skipped: 0 NotRun: 0\n", 12, 1),
        ];
        for (cmd, out, passed, failed) in cases {
            let v = run("PostToolUse", cmd, json!({ "stdout": out })).unwrap_or_else(|| panic!("{cmd}"));
            assert_eq!((v["passed"].as_u64(), v["failed"].as_u64()), (Some(*passed), Some(*failed)), "{cmd}");
        }
        let go = run("PostToolUseFailure", "go test -v", json!({ "stdout": cases[9].1 })).unwrap();
        assert_eq!(go["reason"], "TestB: b_test.go:12: got 1, want 2");
        let py = run("PostToolUseFailure", "pytest", json!({ "stdout": cases[1].1 })).unwrap();
        assert_eq!(py["reason"], "tests/test_a.py::test_x - AssertionError: 1 != 2");
    }

    #[test]
    fn go_packages_only() {
        let v = run("PostToolUse", "go test ./...", json!({ "stdout": "ok  \texample.com/a\t0.01s\nok  \texample.com/b\t0.02s\n" })).unwrap();
        assert_eq!((v["passed"].as_u64(), v["unit"].as_str()), (Some(2), Some("pacchetti")));
    }

    #[test]
    fn unclear_is_never_passed() {
        assert!(run("PostToolUse", "npm test", json!({ "stdout": "done\n" })).is_none());
        let v = run("PostToolUseFailure", "npm test", json!({ "stdout": "something broke\n" })).unwrap();
        assert_eq!((v["status"].as_str(), v["known"].as_bool()), (Some("failed"), Some(false)));
    }
}
