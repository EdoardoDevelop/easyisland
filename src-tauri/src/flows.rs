// Flows: an automation whose steps are linked (docs/flussi.md, asked by
// Edoardo on 25 Oct 2026 to make EasyIsland programmable like the other AI
// agents). There is no separate format: an automation is a flow, each step has
// a `node` name and may say where to go next (`next`) or pick among branches
// (`decide`); without links the next step follows, so every automation made
// before is a straight flow and nothing had to be converted.
//
// Kinds on top of automations.rs: `agent` (a task of tasks.rs, waited for
// until it is over; its result goes in the data), `decide` (branches on a
// value), `ask` (a card with the user's choices). Every step writes its
// outcome in the run's data as `{node}` and `{risultato}`, for the steps after.
//
// A run is saved after every step in %APPDATA%\EasyIsland\flussi\<run>.json
// and removed when it ends; when EasyIsland starts again a run left halfway
// goes on from the step it was at (a wait with the time left, an agent with
// its own task). Steps per run are capped, so a loop cannot run forever.
// Nothing new runs code: steps are the same fixed list, agents have the
// chat's tools and permissions.

use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::automations::{fill, Automation, Ctx, LogEntry, Step};
use crate::i18n::{t, tf};

/// Steps one run may take, loops included.
pub const MAX_STEPS_PER_RUN: u32 = 60;
/// An "ask" card waits this long; without an answer the flow stops.
const ASK_WAIT: Duration = Duration::from_secs(600);
/// How often an agent step looks at its task.
const AGENT_POLL: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Run {
    pub id: String,
    pub flow: Automation,
    pub cause: String,
    pub ctx: Ctx,
    /// Index of the step to do now.
    pub at: usize,
    pub done: Vec<String>,
    pub ok: bool,
    pub taken: u32,
    /// wait: until when (ms since 1970), so a restart keeps only the time left.
    pub wait_until: u64,
    /// agent: the task it is waiting for.
    pub task: String,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn dir() -> PathBuf {
    crate::settings::config_dir().join("flussi")
}

fn file(id: &str) -> PathBuf {
    dir().join(format!("{id}.json"))
}

fn save(run: &Run) {
    let _ = std::fs::create_dir_all(dir());
    if let Ok(bytes) = serde_json::to_vec_pretty(run) {
        let _ = crate::settings::write_atomic(&file(&run.id), &bytes);
    }
}

// ── Links ─────────────────────────────────────────────────────────────────────

/// Every step with a name: the ones left empty get "s1", "s2"… by position.
pub fn name_steps(steps: &mut [Step]) {
    for (i, st) in steps.iter_mut().enumerate() {
        st.node = st.node.trim().to_string();
        if st.node.is_empty() {
            st.node = format!("s{}", i + 1);
        }
    }
}

/// Where a link leads: "" = the step after `i`, "end" = nowhere, else the named step.
pub fn target(steps: &[Step], i: usize, link: &str) -> Option<usize> {
    match link.trim() {
        "" => (i + 1 < steps.len()).then_some(i + 1),
        "end" => None,
        name => steps.iter().position(|s| s.node == name),
    }
}

/// The first branch that holds; `else` always does.
pub fn pick<'a>(branches: &'a [crate::automations::Branch], ctx: &Ctx) -> Option<&'a str> {
    let plain = |v: &str, _: bool| v.to_string();
    branches
        .iter()
        .find(|b| {
            let v = fill(&b.value, ctx, &plain).trim().to_lowercase();
            let m = fill(&b.to_match, ctx, &plain).trim().to_lowercase();
            match b.op.as_str() {
                "contains" => !m.is_empty() && v.contains(&m),
                "equals" => v == m,
                "empty" => v.is_empty(),
                "filled" => !v.is_empty(),
                "else" => true,
                _ => false,
            }
        })
        .map(|b| b.to.as_str())
}

/// Sets `{key}` in the data, replacing an older value.
pub fn put(ctx: &mut Ctx, key: &str, value: &str) {
    let value: String = value.chars().take(8000).collect();
    match ctx.iter_mut().find(|(k, _)| k == key) {
        Some(slot) => slot.1 = value,
        None => ctx.push((key.to_string(), value)),
    }
}

/// Checks a flow's links: names unique, every link to a step that exists.
pub fn check_links(steps: &[Step]) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    for st in steps {
        if st.node == "end" || st.node.contains(['{', '}', ' ']) {
            return Err(tf("Nome di passo non valido: «{n}» (niente spazi né graffe, «end» è riservato).", &[("n", &st.node)]));
        }
        if !seen.insert(st.node.as_str()) {
            return Err(tf("Due passi si chiamano «{n}».", &[("n", &st.node)]));
        }
    }
    let known = |l: &str| matches!(l.trim(), "" | "end") || seen.contains(l.trim());
    for st in steps {
        if !known(&st.next) {
            return Err(tf("Il passo «{n}» va a «{to}», che non esiste.", &[("n", &st.node), ("to", &st.next)]));
        }
        for b in &st.branches {
            if !known(&b.to) {
                return Err(tf("Un ramo di «{n}» va a «{to}», che non esiste.", &[("n", &st.node), ("to", &b.to)]));
            }
            if !["contains", "equals", "empty", "filled", "else"].contains(&b.op.as_str()) {
                return Err("branches[].op deve essere uno di: contains, equals, empty, filled, else.".into());
            }
        }
    }
    Ok(())
}

// ── Running ───────────────────────────────────────────────────────────────────

/// A new run of `flow` (automations.rs, when its trigger fires or from "Prova ora").
pub async fn start(app: AppHandle, mut flow: Automation, cause: String, actions: Vec<Value>, mut ctx: Ctx) {
    crate::log::line(format!("automation {} ({cause})", flow.name));
    if cause != t("Prova") {
        crate::habits::note("auto", &flow.id);
    }
    let (_, key) = crate::automations::minute_key();
    let part = |a: usize, b: usize| key.get(a..b).unwrap_or("");
    put(&mut ctx, "data", &format!("{}/{}/{}", part(8, 10), part(5, 7), part(0, 4)));
    put(&mut ctx, "ora", key.get(11..).unwrap_or(""));
    name_steps(&mut flow.steps);
    let run = Run { id: format!("r{}", now_ms()), flow, cause, ctx, ok: true, ..Default::default() };
    go(app, run, actions).await;
}

/// The runs left halfway by the last session, going on from where they were.
pub fn resume(app: &AppHandle, actions: Vec<Value>) {
    let Ok(entries) = std::fs::read_dir(dir()) else { return };
    for e in entries.flatten() {
        let path = e.path();
        if path.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        let Some(run) = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Run>(&b).ok()) else {
            let _ = std::fs::remove_file(&path);
            continue;
        };
        crate::log::line(format!("flusso ripreso: {} al passo {}", run.flow.name, run.at + 1));
        tauri::async_runtime::spawn(go(app.clone(), run, actions.clone()));
    }
}

async fn go(app: AppHandle, mut run: Run, actions: Vec<Value>) {
    let name = if run.flow.name.trim().is_empty() { t("Automazione").to_string() } else { run.flow.name.clone() };
    if run.flow.steps.is_empty() {
        run.done.push(t("nessun passo da eseguire").into());
    }
    while let Some(step) = run.flow.steps.get(run.at).cloned() {
        if run.taken >= MAX_STEPS_PER_RUN {
            run.ok = false;
            run.done.push(tf("fermato dopo {n} passi: forse un giro senza fine", &[("n", &MAX_STEPS_PER_RUN)]));
            break;
        }
        save(&run);
        let i = run.at;
        let mut link = step.next.clone();
        let outcome: Result<String, String> = match step.kind.as_str() {
            "wait" => {
                let minutes = step.minutes.clamp(1, 240);
                if run.wait_until == 0 {
                    run.wait_until = now_ms() + minutes * 60_000;
                    save(&run);
                }
                let left = run.wait_until.saturating_sub(now_ms());
                tokio::time::sleep(Duration::from_millis(left)).await;
                run.wait_until = 0;
                Ok(tf("atteso {n} minuti", &[("n", &minutes)]))
            }
            "confirm" => {
                let plain = |v: &str, _| v.to_string();
                let title = fill(step.title.trim(), &run.ctx, &plain);
                let title = if title.is_empty() { tf("Automazione «{name}»", &[("name", &name)]) } else { title };
                let rest: Vec<String> = run.flow.steps.iter().skip(i + 1).map(crate::automations::step_words).collect();
                let text = fill(step.text.trim(), &run.ctx, &plain);
                let text = if text.is_empty() { tf("Continuo? Poi: {rest}.", &[("rest", &rest.join(", "))]) } else { text };
                let go_on = t("Continua").to_string();
                let answer = crate::moments::ask_card(&app, &title, &text, "info", vec![go_on.clone(), t("Annulla").into()], crate::automations::CONFIRM_WAIT).await;
                if answer != Some(crate::moments::CardAnswer::Chose(go_on)) {
                    run.done.push(t("fermata: non confermata").into());
                    break;
                }
                Ok(t("confermata").into())
            }
            "ask" => ask(&app, &step, &run.ctx, &name).await,
            "decide" => match pick(&step.branches, &run.ctx) {
                Some(to) => {
                    link = to.to_string();
                    Ok(tf("scelto: {to}", &[("to", &if to.is_empty() { t("il passo seguente").to_string() } else { to.to_string() })]))
                }
                None => Ok(t("nessun ramo: si va avanti").into()),
            },
            "agent" => agent(&app, &step, &mut run).await,
            _ => crate::automations::run_step(&app, &step, &actions, &run.ctx).await,
        };
        run.taken += 1;
        match outcome {
            Ok(text) => {
                put(&mut run.ctx, &step.node, &text);
                put(&mut run.ctx, "risultato", &text);
                run.done.push(text);
            }
            Err(e) => {
                run.ok = false;
                run.done.push(tf("errore: {e}", &[("e", &e)]));
                if !run.flow.keep_going {
                    if i + 1 < run.flow.steps.len() {
                        run.done.push(t("passi seguenti saltati").into());
                    }
                    break;
                }
            }
        }
        match target(&run.flow.steps, i, &link) {
            Some(n) => run.at = n,
            None => break,
        }
    }
    let _ = std::fs::remove_file(file(&run.id));
    let detail = run.done.join(" · ");
    let ok = run.ok;
    if run.flow.notify || !ok {
        crate::automations::notice(&app, &tf("Automazione «{name}»", &[("name", &name)]), &detail, if ok { "ok" } else { "error" });
    }
    crate::automations::push_log(LogEntry { at: now_ms(), name, cause: run.cause, ok, detail });
    let _ = app.emit_to(crate::SETTINGS_LABEL, "automations-log", ());
}

/// "ask": a card with the user's choices; the one clicked is the result.
async fn ask(app: &AppHandle, step: &Step, ctx: &Ctx, name: &str) -> Result<String, String> {
    let plain = |v: &str, _| v.to_string();
    let mut options: Vec<String> = step.options.iter().map(|o| fill(o.trim(), ctx, &plain)).filter(|o| !o.is_empty()).take(3).collect();
    if options.is_empty() {
        options = vec![t("Sì").into(), t("No").into()];
    }
    let title = fill(step.title.trim(), ctx, &plain);
    let title = if title.is_empty() { tf("Automazione «{name}»", &[("name", &name)]) } else { title };
    let text = fill(step.text.trim(), ctx, &plain);
    match crate::moments::ask_card(app, &title, &text, "info", options, ASK_WAIT).await {
        Some(crate::moments::CardAnswer::Chose(c)) => Ok(c),
        _ => Err(t("nessuna risposta").into()),
    }
}

/// "agent": a task with the step's goal (and the data filled in), waited for
/// until it is over. Asking the user or a pause keep it waiting: the task's
/// own buttons in Impostazioni → Compiti take it on.
async fn agent(app: &AppHandle, step: &Step, run: &mut Run) -> Result<String, String> {
    let existing = (!run.task.is_empty()).then(|| crate::tasks::get(&run.task)).flatten();
    let id = match existing {
        Some(task) => {
            // Left paused by the restart: on again.
            if task.state == crate::tasks::TaskState::Paused {
                let _ = crate::tasks::control(app, &task.id, "resume");
            }
            task.id
        }
        None => {
            let plain = |v: &str, _| v.to_string();
            let goal = fill(step.text.trim(), &run.ctx, &plain);
            let title = fill(step.title.trim(), &run.ctx, &plain);
            let task = crate::tasks::create(app, &title, &goal, "", step.engine.trim())?;
            if !step.model.trim().is_empty() {
                let _ = crate::tasks::set_engines(app, &task.id, step.engine.trim(), step.model.trim(), &[]);
            }
            run.task = task.id.clone();
            save(run);
            task.id
        }
    };
    loop {
        let Some(task) = crate::tasks::get(&id) else {
            run.task.clear();
            return Err(t("il compito è stato eliminato").into());
        };
        match task.state {
            crate::tasks::TaskState::Done => {
                run.task.clear();
                return Ok(if task.result.trim().is_empty() { t("Fatto.").to_string() } else { task.result });
            }
            crate::tasks::TaskState::Failed | crate::tasks::TaskState::Stopped => {
                run.task.clear();
                return Err(tf("compito «{t}»: {last}", &[("t", &task.title), ("last", &task.last)]));
            }
            _ => tokio::time::sleep(AGENT_POLL).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automations::Branch;

    fn step(node: &str, next: &str) -> Step {
        Step { kind: "notice".into(), node: node.into(), next: next.into(), ..Default::default() }
    }

    #[test]
    fn names_and_links() {
        let mut steps = vec![step("", ""), step("b", "end"), step("", "b")];
        name_steps(&mut steps);
        assert_eq!(steps[0].node, "s1");
        assert_eq!(steps[2].node, "s3");
        assert_eq!(target(&steps, 0, ""), Some(1));
        assert_eq!(target(&steps, 1, "end"), None);
        assert_eq!(target(&steps, 2, "b"), Some(1));
        assert_eq!(target(&steps, 2, ""), None);
        assert!(check_links(&steps).is_ok());
    }

    #[test]
    fn bad_links_are_refused() {
        let mut steps = vec![step("a", "nowhere")];
        name_steps(&mut steps);
        assert!(check_links(&steps).is_err());
        let steps = vec![step("a", ""), step("a", "")];
        assert!(check_links(&steps).is_err());
        let steps = vec![step("end", "")];
        assert!(check_links(&steps).is_err());
    }

    #[test]
    fn branches_pick_the_first_that_holds() {
        let b = |op: &str, m: &str, to: &str| Branch { value: "{agente}".into(), op: op.into(), to_match: m.into(), to: to.into() };
        let branches = vec![b("contains", "URGENTE", "tg"), b("empty", "", "end"), b("else", "", "todo")];
        let mut ctx: Ctx = Vec::new();
        put(&mut ctx, "agente", "Ticket urgente da Rossi");
        assert_eq!(pick(&branches, &ctx), Some("tg"));
        put(&mut ctx, "agente", "");
        assert_eq!(pick(&branches, &ctx), Some("end"));
        put(&mut ctx, "agente", "niente");
        assert_eq!(pick(&branches, &ctx), Some("todo"));
        assert_eq!(ctx.iter().filter(|(k, _)| k == "agente").count(), 1);
    }
}
