// Flows: an automation whose steps are linked (docs/flussi.md, asked by
// Edoardo on 25 Oct 2026 to make EasyIsland programmable like the other AI
// agents). There is no separate format: an automation is a flow, each step has
// a `node` name and may say where to go next (`next`) or pick among branches
// (`decide`); without links the next step follows, so every automation made
// before is a straight flow and nothing had to be converted.
//
// Kinds on top of automations.rs: `agent` (a task of tasks.rs, waited for
// until it is over; its result goes in the data), `decide` (branches on a
// value, or "model" branches an engine picks by what they mean), `ask` (a card
// with the user's choices, and the same question on Telegram when linked: the
// first answer wins, there also a free one with /rispondi), `foreach` (one
// item per line of a value: each goes as `{elemento}` through the steps from
// `body`, which lead back to it; `next` after the last). Every step writes its
// outcome in the run's data as `{node}` and `{risultato}`, for the steps after.
//
// Reliability (docs/flussi.md, stage 5, from what durable-execution engines
// and node-based tools do): a step can try again (`retries`, waits 10 s, 30 s,
// 90 s) and can have a way out when it fails (`on_error`, reason in {errore});
// a step with effects left halfway by a restart is not done twice (`inflight`);
// an agent has a time limit and can be asked for fields (`fields`, JSON at the
// end of its answer → {node.field}); a run has at most MAX_ENGINE_STEPS steps
// that call an engine. When a run fails and Telegram is linked, it says so there.
//
// A run is saved after every step in %APPDATA%\EasyIsland\flussi\<run>.json
// with what each step did (`trace`), and kept when it ends (the last
// KEEP_RUNS) for Impostazioni → Flussi → Esecuzioni, where "Riprendi da
// qui" starts a new run from a step with the data the old one had. When
// EasyIsland starts again a run left halfway goes on from the step it was at
// (a wait with the time left, an agent with its own task). Steps per run are
// capped, so a loop cannot run forever.
// Nothing new runs code: steps are the same fixed list, agents have the
// chat's tools and permissions.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::automations::{fill, Automation, Ctx, LogEntry, Step};
use crate::i18n::{t, tf};

/// Steps one run may take, loops included.
pub const MAX_STEPS_PER_RUN: u32 = 200;
/// Items one foreach goes through.
const MAX_ITEMS: usize = 30;
/// Steps that call an engine (agents, the model's choices) in one run.
const MAX_ENGINE_STEPS: u32 = 20;
/// Steps that change something: never done again after a restart caught them halfway.
const EFFECTS: &[&str] = &["quick", "notice", "profile", "app", "url", "chat", "task"];
/// Steps that wait for the user or only look at the data: no point in trying again.
const NO_RETRY: &[&str] = &["wait", "confirm", "ask", "foreach"];
/// An "ask" card waits this long; without an answer the flow stops.
const ASK_WAIT: Duration = Duration::from_secs(600);
/// Finished runs kept on disk.
const KEEP_RUNS: usize = 50;
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
    /// running | done | failed | stopped
    pub status: String,
    pub started: u64,
    pub ended: u64,
    /// What each step did, in the order they ran.
    pub trace: Vec<Trace>,
    /// foreach steps under way: their items and how many went through.
    pub loops: HashMap<String, (Vec<String>, usize)>,
    /// The step at `at` started and did not finish yet (a restart finds it so).
    pub inflight: bool,
    /// Steps that called an engine so far.
    pub engine_steps: u32,
    /// agent: until when it may work (ms since 1970).
    pub agent_until: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Trace {
    pub node: String,
    pub kind: String,
    /// The step in words ("agente «Leggi i ticket»").
    pub what: String,
    pub ok: bool,
    /// Its outcome: the result, the choice, the error.
    pub out: String,
    pub at: u64,
}

/// One line of Impostazioni → Esecuzioni.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunInfo {
    pub id: String,
    pub flow_id: String,
    pub name: String,
    pub cause: String,
    pub status: String,
    pub started: u64,
    pub ended: u64,
    pub steps: usize,
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
        if st.kind == "foreach" && (st.body.trim().is_empty() || st.body.trim() == "end" || !known(&st.body)) {
            return Err(tf("Il passo «{n}» ripete i passi da «{to}», che non esiste.", &[("n", &st.node), ("to", &st.body)]));
        }
        if !known(&st.on_error) {
            return Err(tf("Se «{n}» non riesce va a «{to}», che non esiste.", &[("n", &st.node), ("to", &st.on_error)]));
        }
        if !known(&st.next) {
            return Err(tf("Il passo «{n}» va a «{to}», che non esiste.", &[("n", &st.node), ("to", &st.next)]));
        }
        for b in &st.branches {
            if !known(&b.to) {
                return Err(tf("Un ramo di «{n}» va a «{to}», che non esiste.", &[("n", &st.node), ("to", &b.to)]));
            }
            if !["contains", "equals", "empty", "filled", "else", "model"].contains(&b.op.as_str()) {
                return Err("branches[].op deve essere uno di: contains, equals, empty, filled, else, model.".into());
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
    let run = Run { id: format!("r{}", now_ms()), flow, cause, ctx, ok: true, status: "running".into(), started: now_ms(), ..Default::default() };
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
        if run.status != "running" && !run.status.is_empty() {
            continue;
        }
        crate::log::line(format!("flusso ripreso: {} al passo {}", run.flow.name, run.at + 1));
        tauri::async_runtime::spawn(go(app.clone(), run, actions.clone()));
    }
}

async fn go(app: AppHandle, mut run: Run, actions: Vec<Value>) {
    let name = if run.flow.name.trim().is_empty() { t("Automazione").to_string() } else { run.flow.name.clone() };
    if run.flow.steps.is_empty() {
        run.done.push(t("nessun passo da eseguire").into());
    }
    'steps: while let Some(step) = run.flow.steps.get(run.at).cloned() {
        if run.taken >= MAX_STEPS_PER_RUN {
            run.ok = false;
            run.done.push(tf("fermato dopo {n} passi: forse un giro senza fine", &[("n", &MAX_STEPS_PER_RUN)]));
            break;
        }
        save(&run);
        let i = run.at;
        let mut link = step.next.clone();
        let model_choice = step.kind == "decide" && step.branches.iter().any(|b| b.op == "model");
        let uses_engine = step.kind == "agent" || model_choice;
        let mut attempt: u8 = 0;
        let outcome: Result<String, String> = loop {
        let interrupted = run.inflight && EFFECTS.contains(&step.kind.as_str());
        let result: Result<String, String> = if interrupted {
            Err(t("interrotto da un riavvio a metà: non lo ripeto, per non farlo due volte").into())
        } else if uses_engine && run.engine_steps >= MAX_ENGINE_STEPS {
            Err(tf("troppi passi con un motore in questo giro (al massimo {n})", &[("n", &MAX_ENGINE_STEPS)]))
        } else {
        if uses_engine {
            run.engine_steps += 1;
        }
        run.inflight = true;
        save(&run);
        match step.kind.as_str() {
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
                    run.status = "stopped".into();
                    run.inflight = false;
                    run.trace.push(Trace { node: step.node.clone(), kind: step.kind.clone(), what: crate::automations::step_words(&step), ok: true, out: t("non confermata").into(), at: now_ms() });
                    break 'steps;
                }
                Ok(t("confermata").into())
            }
            "ask" => ask(&app, &step, &run.ctx, &name, &run.id).await,
            "decide" if model_choice => match by_model(&app, &step, &run.ctx).await {
                Ok((to, label)) => {
                    link = to;
                    Ok(label)
                }
                Err(e) => Err(e),
            },
            "foreach" => {
                let (items, done) = run.loops.entry(step.node.clone()).or_insert_with(|| (items_of(&step, &run.ctx), 0)).clone();
                match items.get(done) {
                    Some(item) => {
                        put(&mut run.ctx, "elemento", item);
                        if let Some(l) = run.loops.get_mut(&step.node) {
                            l.1 += 1;
                        }
                        link = step.body.clone();
                        Ok(tf("elemento {n} di {tot}: {x}", &[("n", &(done + 1)), ("tot", &items.len()), ("x", item)]))
                    }
                    None => {
                        run.loops.remove(&step.node);
                        Ok(tf("finiti {n} elementi", &[("n", &items.len())]))
                    }
                }
            }
            "decide" => match pick(&step.branches, &run.ctx) {
                Some(to) => {
                    link = to.to_string();
                    Ok(tf("scelto: {to}", &[("to", &if to.is_empty() { t("il passo seguente").to_string() } else { to.to_string() })]))
                }
                None => Ok(t("nessun ramo: si va avanti").into()),
            },
            "agent" => agent(&app, &step, &mut run).await,
            _ => crate::automations::run_step(&app, &step, &actions, &run.ctx).await,
        }
        };
        run.inflight = false;
        match result {
            Err(e) if !interrupted && attempt < step.retries.min(3) && !NO_RETRY.contains(&step.kind.as_str()) && !(step.kind == "decide" && !model_choice) => {
                attempt += 1;
                run.trace.push(Trace {
                    node: step.node.clone(),
                    kind: step.kind.clone(),
                    what: crate::automations::step_words(&step),
                    ok: false,
                    out: tf("{e} · riprovo ({n} di {tot})", &[("e", &e), ("n", &attempt), ("tot", &step.retries.min(3))]),
                    at: now_ms(),
                });
                save(&run);
                tokio::time::sleep(Duration::from_secs(10 * 3u64.pow(u32::from(attempt) - 1))).await;
            }
            other => break other,
        }
        };
        run.taken += 1;
        run.trace.push(Trace {
            node: step.node.clone(),
            kind: step.kind.clone(),
            what: crate::automations::step_words(&step),
            ok: outcome.is_ok(),
            out: match &outcome { Ok(x) | Err(x) => x.chars().take(4000).collect() },
            at: now_ms(),
        });
        match outcome {
            Ok(text) => {
                put(&mut run.ctx, &step.node, &text);
                if step.kind != "foreach" {
                    put(&mut run.ctx, "risultato", &text);
                }
                run.done.push(text);
            }
            Err(e) if !step.on_error.trim().is_empty() => {
                // A way out for this failure: the flow goes on there.
                put(&mut run.ctx, "errore", &e);
                put(&mut run.ctx, &step.node, &e);
                run.done.push(tf("errore gestito: {e}", &[("e", &e)]));
                link = step.on_error.clone();
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
    if run.status == "running" || run.status.is_empty() {
        run.status = if run.ok { "done".into() } else { "failed".into() };
    }
    run.ended = now_ms();
    save(&run);
    prune();
    let detail = run.done.join(" · ");
    let ok = run.ok;
    if run.flow.notify || !ok {
        crate::automations::notice(&app, &tf("Automazione «{name}»", &[("name", &name)]), &detail, if ok { "ok" } else { "error" });
    }
    if !ok && crate::telegram::linked(&app) {
        let text = format!("⚠️ {}\n{}", tf("Flusso «{name}» non riuscito", &[("name", &name)]), detail.chars().take(1500).collect::<String>());
        crate::telegram::tell(&app, &text).await;
    }
    crate::automations::push_log(LogEntry { at: now_ms(), name, cause: run.cause, ok, detail });
    let _ = app.emit_to(crate::SETTINGS_LABEL, "automations-log", ());
}

/// Only the last KEEP_RUNS finished runs stay.
fn prune() {
    let mut done: Vec<Run> = all().into_iter().filter(|r| r.status != "running").collect();
    done.sort_by(|a, b| b.started.cmp(&a.started));
    for r in done.iter().skip(KEEP_RUNS) {
        let _ = std::fs::remove_file(file(&r.id));
    }
}

fn all() -> Vec<Run> {
    let Ok(entries) = std::fs::read_dir(dir()) else { return Vec::new() };
    entries
        .flatten()
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("json"))
        .filter_map(|e| std::fs::read(e.path()).ok().and_then(|b| serde_json::from_slice::<Run>(&b).ok()))
        .collect()
}

/// A safe run id: it names a file.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Impostazioni → Esecuzioni: newest first.
pub fn runs() -> Vec<RunInfo> {
    let mut list: Vec<RunInfo> = all()
        .into_iter()
        .map(|r| RunInfo {
            id: r.id,
            flow_id: r.flow.id,
            name: r.flow.name,
            cause: r.cause,
            status: if r.status.is_empty() { "running".into() } else { r.status },
            started: r.started,
            ended: r.ended,
            steps: r.trace.len(),
        })
        .collect();
    list.sort_by(|a, b| b.started.cmp(&a.started));
    list
}

pub fn run_detail(id: &str) -> Result<Run, String> {
    if !valid_id(id) {
        return Err(t("Esecuzione non trovata.").into());
    }
    std::fs::read(file(id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).ok_or_else(|| t("Esecuzione non trovata.").into())
}

/// The editor's "Prova da qui": a run of `flow` from step `node`, with the
/// data of its last run when there is one (so `{leggi}` has something in it).
pub fn try_from(app: &AppHandle, mut flow: Automation, node: &str, actions: Vec<Value>) -> Result<(), String> {
    name_steps(&mut flow.steps);
    let at = flow.steps.iter().position(|s| s.node == node).ok_or(t("Passo non trovato."))?;
    let ctx = all().into_iter().filter(|r| r.flow.id == flow.id).max_by_key(|r| r.started).map(|r| r.ctx).unwrap_or_default();
    let run = Run {
        id: format!("r{}", now_ms()),
        cause: tf("prova da «{node}»", &[("node", &node)]),
        ctx,
        at,
        ok: true,
        status: "running".into(),
        started: now_ms(),
        flow,
        ..Default::default()
    };
    tauri::async_runtime::spawn(go(app.clone(), run, actions));
    Ok(())
}

/// "Riprendi da qui": a new run of the same flow from step `node`, with the
/// data the old run had (each step's outcome included).
pub fn rerun(app: &AppHandle, id: &str, node: &str, actions: Vec<Value>) -> Result<(), String> {
    let old = run_detail(id)?;
    if old.status == "running" {
        return Err(t("Questa esecuzione sta ancora lavorando.").into());
    }
    let at = old.flow.steps.iter().position(|s| s.node == node).ok_or(t("Passo non trovato."))?;
    let run = Run {
        id: format!("r{}", now_ms()),
        cause: tf("ripreso da «{node}»", &[("node", &node)]),
        ctx: old.ctx,
        at,
        ok: true,
        status: "running".into(),
        started: now_ms(),
        flow: old.flow,
        ..Default::default()
    };
    tauri::async_runtime::spawn(go(app.clone(), run, actions));
    Ok(())
}

/// Flow questions waiting on Telegram: "flow-<run>" → where the answer goes.
static ASKS: Mutex<Vec<(String, tokio::sync::oneshot::Sender<String>)>> = Mutex::new(Vec::new());

/// A button or /rispondi on Telegram for a flow's question (telegram.rs).
pub fn answer(key: &str, text: &str) -> Result<String, String> {
    let mut asks = ASKS.lock().unwrap();
    let i = asks.iter().position(|(k, _)| k == key).ok_or(t("Domanda già chiusa."))?;
    let (_, tx) = asks.remove(i);
    let _ = tx.send(text.chars().take(2000).collect());
    Ok(t("flusso").to_string())
}

/// /rispondi: the latest flow question, if any is waiting.
pub fn answer_latest(text: &str) -> Option<String> {
    if text.trim().is_empty() {
        return None;
    }
    let key = ASKS.lock().unwrap().last().map(|(k, _)| k.clone())?;
    answer(&key, text).ok()
}

/// "ask": a card with the user's choices; the one clicked is the result.
/// With Telegram linked the same question goes there too, first answer wins.
async fn ask(app: &AppHandle, step: &Step, ctx: &Ctx, name: &str, run_id: &str) -> Result<String, String> {
    let plain = |v: &str, _| v.to_string();
    let mut options: Vec<String> = step.options.iter().map(|o| fill(o.trim(), ctx, &plain)).filter(|o| !o.is_empty()).take(3).collect();
    if options.is_empty() {
        options = vec![t("Sì").into(), t("No").into()];
    }
    let title = fill(step.title.trim(), ctx, &plain);
    let title = if title.is_empty() { tf("Automazione «{name}»", &[("name", &name)]) } else { title };
    let text = fill(step.text.trim(), ctx, &plain);
    if !crate::telegram::linked(app) {
        return match crate::moments::ask_card(app, &title, &text, "info", options, ASK_WAIT).await {
            Some(crate::moments::CardAnswer::Chose(c)) => Ok(c),
            _ => Err(t("nessuna risposta").into()),
        };
    }
    let key = format!("flow-{run_id}");
    let (tx, rx) = tokio::sync::oneshot::channel();
    ASKS.lock().unwrap().push((key.clone(), tx));
    let question = if text.is_empty() { title.clone() } else { format!("{title}\n{text}") };
    crate::telegram::ask_flow(app, &key, name, &question, &options).await;
    let card_id = crate::moments::new_card_id();
    let island = async {
        match crate::moments::ask_card_as(app, &card_id, &title, &text, "info", options.clone(), ASK_WAIT).await {
            Some(crate::moments::CardAnswer::Chose(c)) => Some(c),
            // Closed or not shown: Telegram may still answer.
            _ => std::future::pending::<Option<String>>().await,
        }
    };
    let telegram = async { tokio::time::timeout(ASK_WAIT, rx).await.ok().and_then(Result::ok) };
    let answer = crate::tasks::first_some(island, telegram).await;
    ASKS.lock().unwrap().retain(|(k, _)| k != &key);
    match answer {
        Some((a, 1)) => {
            crate::moments::expire_card(app, &card_id);
            Ok(a)
        }
        Some((a, _)) => Ok(a),
        None => Err(t("nessuna risposta").into()),
    }
}

/// foreach: the non-empty lines of its value, at most MAX_ITEMS ("- " bullets dropped).
fn items_of(step: &Step, ctx: &Ctx) -> Vec<String> {
    let plain = |v: &str, _| v.to_string();
    fill(&step.text, ctx, &plain)
        .lines()
        .map(|l| l.trim().trim_start_matches(['-', '*', '•']).trim().to_string())
        .filter(|l| !l.is_empty())
        .take(MAX_ITEMS)
        .collect()
}

/// "decide" with "model" branches: the engine reads the step's text (with the
/// data filled in) and answers with the number of the branch that fits.
async fn by_model(app: &AppHandle, step: &Step, ctx: &Ctx) -> Result<(String, String), String> {
    let plain = |v: &str, _| v.to_string();
    let branches: Vec<&crate::automations::Branch> = step.branches.iter().filter(|b| b.op == "model").collect();
    let mut list = String::new();
    for (i, b) in branches.iter().enumerate() {
        list.push_str(&format!("{}. {}\n", i + 1, fill(&b.to_match, ctx, &plain)));
    }
    let what = fill(step.text.trim(), ctx, &plain);
    let prompt = tf(
        "Devi scegliere una sola strada per un flusso di EasyIsland. Non usare strumenti.\n\nSituazione:\n{what}\n\nStrade:\n{list}\nRispondi solo con il numero della strada giusta.",
        &[("what", &what), ("list", &list)],
    );
    let chat = crate::Chat::default();
    let engine = (!step.engine.trim().is_empty()).then(|| step.engine.trim().to_string());
    let model = (!step.model.trim().is_empty()).then(|| step.model.trim().to_string());
    let used = engine.clone().unwrap_or_default();
    let reply = crate::chat_turn(app, &chat, prompt, None, engine, model, false, crate::Channel::Helper, &|_| {}).await;
    if used == "opencode" {
        crate::opencode::forget(chat.cli_session());
    }
    let text = reply?.text;
    let n = first_number(&text).ok_or_else(|| tf("il motore non ha scelto una strada: {x}", &[("x", &text.chars().take(120).collect::<String>())]))?;
    let b = n.checked_sub(1).and_then(|i| branches.get(i)).ok_or_else(|| tf("il motore ha scelto una strada che non c'è: {n}", &[("n", &n)]))?;
    Ok((b.to.clone(), tf("scelta del modello: {x}", &[("x", &b.to_match)])))
}

/// An agent's time limit: 60 minutes unless the step says otherwise.
fn agent_minutes(step: &Step) -> u64 {
    if step.minutes == 0 { 60 } else { step.minutes.clamp(1, 720) }
}

/// The last JSON object in `text` with every one of `fields`, as text values.
fn json_fields(text: &str, fields: &[String]) -> Option<Vec<(String, String)>> {
    let mut end = text.len();
    while let Some(close) = text.get(..end)?.rfind('}') {
        let head = text.get(..close)?;
        let mut start = head.len();
        while let Some(open) = text.get(..start)?.rfind('{') {
            if let Some(Value::Object(map)) = text.get(open..=close).and_then(|s| serde_json::from_str::<Value>(s).ok()) {
                let got: Vec<(String, String)> = fields
                    .iter()
                    .filter_map(|f| {
                        map.get(f).map(|v| (f.clone(), match v {
                            Value::String(s) => s.clone(),
                            other => other.to_string(),
                        }))
                    })
                    .collect();
                if got.len() == fields.len() {
                    return Some(got);
                }
            }
            start = open;
        }
        end = close;
    }
    None
}

fn first_number(text: &str) -> Option<usize> {
    let digits: String = text.chars().skip_while(|c| !c.is_ascii_digit()).take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// "agent": a task with the step's goal (and the data filled in), waited for
/// until it is over. Asking the user or a pause keep it waiting: the task's
/// own buttons in Impostazioni → Flussi take it on.
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
            let mut goal = fill(step.text.trim(), &run.ctx, &plain);
            if !step.fields.is_empty() {
                goal.push_str(&tf(
                    "\n\nAlla fine del risultato (task_done) metti un oggetto JSON su una riga con questi campi, valori in testo: {fields}.",
                    &[("fields", &step.fields.join(", "))],
                ));
            }
            let title = fill(step.title.trim(), &run.ctx, &plain);
            let task = crate::tasks::create(app, &title, &goal, "", step.engine.trim())?;
            if !step.model.trim().is_empty() {
                let _ = crate::tasks::set_engines(app, &task.id, step.engine.trim(), step.model.trim(), &[]);
            }
            run.task = task.id.clone();
            run.agent_until = now_ms() + agent_minutes(step) * 60_000;
            save(run);
            task.id
        }
    };
    loop {
        if run.agent_until > 0 && now_ms() > run.agent_until {
            let _ = crate::tasks::control(app, &id, "stop");
            run.task.clear();
            run.agent_until = 0;
            return Err(tf("l'agente non ha finito entro {n} minuti", &[("n", &agent_minutes(step))]));
        }
        let Some(task) = crate::tasks::get(&id) else {
            run.task.clear();
            return Err(t("il compito è stato eliminato").into());
        };
        match task.state {
            crate::tasks::TaskState::Done => {
                run.task.clear();
                run.agent_until = 0;
                let result = if task.result.trim().is_empty() { t("Fatto.").to_string() } else { task.result };
                if !step.fields.is_empty() {
                    let got = json_fields(&result, &step.fields).ok_or_else(|| {
                        tf("l'agente non ha dato i campi chiesti ({f})", &[("f", &step.fields.join(", "))])
                    })?;
                    for (k, v) in got {
                        put(&mut run.ctx, &format!("{}.{k}", step.node), &v);
                    }
                }
                return Ok(result);
            }
            crate::tasks::TaskState::Failed | crate::tasks::TaskState::Stopped => {
                run.task.clear();
                run.agent_until = 0;
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
    fn agent_fields_from_json() {
        let f = vec!["urgenza".to_string(), "cliente".to_string()];
        let text = "Letto tutto.\n{\"urgenza\": \"alta\", \"cliente\": \"Rossi\", \"n\": 3}";
        assert_eq!(json_fields(text, &f), Some(vec![("urgenza".into(), "alta".into()), ("cliente".into(), "Rossi".into())]));
        assert_eq!(json_fields("{\"urgenza\": 2} e niente altro", &f), None);
        assert_eq!(json_fields("{\"a\": {\"urgenza\": 1, \"cliente\": true}}", &f), Some(vec![("urgenza".into(), "1".into()), ("cliente".into(), "true".into())]));
        let mut steps = vec![Step { kind: "notice".into(), node: "a".into(), on_error: "manca".into(), ..Default::default() }];
        assert!(check_links(&steps).is_err());
        steps[0].on_error = "end".into();
        assert!(check_links(&steps).is_ok());
    }

    #[test]
    fn foreach_items_and_numbers() {
        let st = Step { kind: "foreach".into(), text: "{lista}".into(), ..Default::default() };
        let mut ctx: Ctx = Vec::new();
        put(&mut ctx, "lista", "- Rossi\n\n* Bianchi \n• Verdi");
        assert_eq!(items_of(&st, &ctx), vec!["Rossi", "Bianchi", "Verdi"]);
        assert_eq!(first_number("La strada è la 2."), Some(2));
        assert_eq!(first_number("nessuna"), None);
        let mut steps = vec![Step { kind: "foreach".into(), node: "giro".into(), body: "manca".into(), ..Default::default() }];
        name_steps(&mut steps);
        assert!(check_links(&steps).is_err());
        steps[0].body = "giro".into();
        assert!(check_links(&steps).is_ok());
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
