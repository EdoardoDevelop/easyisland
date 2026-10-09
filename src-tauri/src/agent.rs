// The tools Claude can use from EasyIsland's own chat (the `easyisland` MCP
// server, `easyisland-hook mcp`, which hands every call to us over the pipe).
//
// Permissions are not decided here: Claude Code pre-allows only the read-only
// tools (claude_cli.rs `AGENT_READ_ONLY`) and asks the island — Consenti /
// Nega — before every other call. What is decided here is what a tool can do
// at all: no arbitrary commands (only the user's own quick actions), links
// only http(s), nothing that sends mail or deletes.

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::island::WINDOW_LABEL;

static RUNS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// One-line JSON answer for the pipe: {"ok": bool, "text": "…"}.
pub async fn call(app: &AppHandle, tool: &str, args: &Value) -> Value {
    crate::log::line(format!("agent {tool}"));
    match run(app, tool, args).await {
        Ok(text) => json!({ "ok": true, "text": text }),
        Err(text) => json!({ "ok": false, "text": text }),
    }
}

fn arg<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).unwrap_or_default().trim()
}

fn settings(app: &AppHandle) -> Result<crate::settings::Settings, String> {
    app.try_state::<crate::Shared>()
        .map(|s| s.settings.lock().unwrap().clone())
        .ok_or_else(|| "EasyIsland non è pronto.".to_string())
}

/// Changes the settings like a save from the settings window: on disk, and
/// sent to both windows.
pub(crate) fn update_settings(app: &AppHandle, change: impl FnOnce(&mut crate::settings::Settings)) -> Result<(), String> {
    let shared = app.try_state::<crate::Shared>().ok_or("EasyIsland non è pronto.")?;
    let updated = {
        let mut s = shared.settings.lock().unwrap();
        change(&mut s);
        s.clone()
    };
    crate::settings::save(&updated).map_err(|e| format!("Impostazioni non salvate: {e}"))?;
    crate::habits::apply(&updated);
    crate::threecx::settings_saved(&updated);
    let _ = app.emit("settings-changed", updated);
    Ok(())
}

fn pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

/// What a probe integration is called in the island.
fn probe_name(id: &str) -> &'static str {
    match id {
        "integration_system" => "Stato del PC",
        "integration_security" => "Sicurezza",
        "integration_network" => "Rete",
        "integration_weather" => "Meteo",
        "integration_outlook" => "Outlook",
        "integration_zammad" => "Ticket Zammad",
        "integration_claude_usage" => "Consumo Claude",
        _ => "Widget",
    }
}

async fn run(app: &AppHandle, tool: &str, args: &Value) -> Result<String, String> {
    match tool {
        "get_foreground_app" => {
            let fg = crate::context::foreground().ok_or("Nessuna app in primo piano.")?;
            Ok(pretty(&json!({ "exe": fg.exe, "title": fg.title })))
        }

        "list_status" => {
            let s = settings(app)?;
            let list: Vec<Value> = crate::widgets::all_widgets(&s)
                .into_iter()
                .map(|w| {
                    let name = if w.name.trim().is_empty() { probe_name(&w.id).to_string() } else { w.name.clone() };
                    match crate::widgets::last_result(&w.id) {
                        Some(r) => json!({
                            "nome": name,
                            "livello": r.level,
                            "riassunto": r.summary,
                            "dettagli": r.fields.iter().map(|f| json!({ f.label.clone(): f.value.clone() })).collect::<Vec<_>>(),
                        }),
                        None => json!({ "nome": name, "riassunto": "in attesa del primo controllo" }),
                    }
                })
                .collect();
            if list.is_empty() {
                return Ok("Nessuna integrazione o widget di controllo acceso (Impostazioni → Integrazioni / Widget).".into());
            }
            Ok(pretty(&Value::Array(list)))
        }

        "list_quick_actions" => {
            let s = settings(app)?;
            let list: Vec<Value> = s
                .actions
                .iter()
                .map(|a| {
                    let kind = a.get("kind").and_then(Value::as_str).unwrap_or_default();
                    let detail = match kind {
                        "url" => a.get("target").cloned().unwrap_or_default(),
                        "app" => json!(format!(
                            "{} {}",
                            a.get("target").and_then(Value::as_str).unwrap_or_default(),
                            a.get("args").and_then(Value::as_str).unwrap_or_default()
                        ).trim().to_string()),
                        "script" => a.get("script").cloned().unwrap_or_default(),
                        "prompt" => a.get("prompt").cloned().unwrap_or_default(),
                        _ => Value::Null,
                    };
                    json!({
                        "id": a.get("id"),
                        "nome": a.get("name"),
                        "tipo": match kind { "url" => "link", "app" => "programma", "script" => "script", "prompt" => "domanda alla chat (non eseguibile da qui)", _ => kind },
                        "dettaglio": detail,
                    })
                })
                .collect();
            if list.is_empty() {
                return Ok("L'utente non ha ancora creato azioni rapide.".into());
            }
            Ok(pretty(&Value::Array(list)))
        }

        "run_quick_action" => {
            let id = arg(args, "id");
            let s = settings(app)?;
            let a = s
                .actions
                .iter()
                .find(|a| a.get("id").and_then(Value::as_str) == Some(id))
                .cloned()
                .ok_or_else(|| format!("Nessuna azione rapida con id «{id}»."))?;
            let get = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
            let name = get("name");
            match get("kind").as_str() {
                "url" => {
                    let url = get("target");
                    if !(url.starts_with("https://") || url.starts_with("http://")) {
                        return Err("Il link dell'azione non è un indirizzo web.".into());
                    }
                    crate::open_url_now(&url);
                    Ok(format!("Aperto «{name}»."))
                }
                "app" => {
                    crate::actions::open_app(&get("target"), &get("args"))?;
                    Ok(format!("Avviato «{name}»."))
                }
                "script" => {
                    let run_id = format!("agent-{}", RUNS.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
                    let res = crate::actions::run_script(&run_id, &get("shell"), &get("script")).await?;
                    let status = if res.timed_out {
                        "interrotto per tempo scaduto".to_string()
                    } else {
                        format!("terminato con codice {}", res.code.map(|c| c.to_string()).unwrap_or("?".into()))
                    };
                    Ok(format!("Script «{name}» {status}.\nOutput:\n{}", if res.output.is_empty() { "(nessuno)" } else { &res.output }))
                }
                _ => Err("Le azioni di tipo domanda alla chat non si eseguono da qui: chiedi direttamente.".into()),
            }
        }

        "open_app" => {
            let target = arg(args, "target");
            if target.is_empty() {
                return Err("Manca il programma da aprire.".into());
            }
            crate::actions::open_app(target, arg(args, "args"))?;
            Ok(format!("Aperto {target}."))
        }

        "open_url" => {
            let url = arg(args, "url");
            if !(url.starts_with("https://") || url.starts_with("http://")) {
                return Err("Solo indirizzi http:// o https://.".into());
            }
            crate::open_url_now(url);
            Ok(format!("Aperto {url}."))
        }

        "read_clipboard" => tauri::async_runtime::spawn_blocking(crate::actions::clipboard_text)
            .await
            .ok()
            .flatten()
            .ok_or_else(|| "Negli appunti non c'è testo.".to_string()),

        "write_clipboard" => {
            let text = args.get("text").and_then(Value::as_str).unwrap_or_default().to_string();
            if text.is_empty() {
                return Err("Nessun testo da copiare.".into());
            }
            let n = text.chars().count();
            tauri::async_runtime::spawn_blocking(move || crate::actions::set_clipboard_text(&text))
                .await
                .map_err(|e| e.to_string())??;
            Ok(format!("Copiati {n} caratteri negli appunti."))
        }

        "show_notice" => {
            let level = match arg(args, "level") {
                "ok" | "warn" | "error" => arg(args, "level"),
                _ => "info",
            };
            let cut = |s: &str, n: usize| s.chars().take(n).collect::<String>();
            let _ = app.emit_to(WINDOW_LABEL, "hook", json!({
                "hook_event_name": "EasyIslandNotify",
                "title": cut(arg(args, "title"), 120),
                "text": cut(arg(args, "text"), 600),
                "level": level,
                "url": "",
            }));
            Ok("Avviso mostrato.".into())
        }

        "media_status" => {
            let s = settings(app)?;
            if !s.active_integrations.iter().any(|a| a == crate::media::ID) {
                return Err("L'integrazione Musica è spenta (Impostazioni → Integrazioni).".into());
            }
            match crate::media::last() {
                Some(v) if v.get("active").and_then(Value::as_bool) == Some(true) => Ok(pretty(&json!({
                    "titolo": v.get("title"),
                    "artista": v.get("artist"),
                    "album": v.get("album"),
                    "app": v.get("app"),
                    "in_riproduzione": v.get("playing"),
                }))),
                _ => Ok("Niente in riproduzione.".into()),
            }
        }

        "media_control" => {
            let cmd = arg(args, "command");
            if !["toggle", "next", "prev"].contains(&cmd) {
                return Err("Comando: toggle, next o prev.".into());
            }
            crate::media::command(cmd);
            Ok("Fatto.".into())
        }

        "list_uploaded_files" => {
            let files = crate::files::list_inbox();
            if files.is_empty() {
                return Ok("Nessun file rilasciato sull'isola negli ultimi 7 giorni.".into());
            }
            Ok(pretty(&json!(files)))
        }

        "list_profiles" => {
            let s = settings(app)?;
            let list: Vec<Value> = s
                .profiles
                .iter()
                .map(|p| json!({ "id": p.id, "nome": p.name, "attivo": p.id == s.active_profile }))
                .collect();
            Ok(pretty(&Value::Array(list)))
        }

        "switch_profile" => {
            let id = arg(args, "id");
            let s = settings(app)?;
            let p = s.profiles.iter().find(|p| p.id == id).ok_or_else(|| format!("Nessun profilo con id «{id}»."))?;
            let name = p.name.clone();
            crate::activate_profile(app, id, "chat");
            Ok(format!("Profilo «{name}» attivo."))
        }

        "list_automations" => {
            let s = settings(app)?;
            let list: Vec<String> = s
                .automations
                .iter()
                .filter_map(|v| serde_json::from_value::<crate::automations::Automation>(v.clone()).ok())
                .map(|a| crate::automations::describe(&a, &s))
                .collect();
            if list.is_empty() {
                return Ok("Nessuna automazione.".into());
            }
            Ok(list.join("\n"))
        }

        "create_automation" => {
            let s = settings(app)?;
            let auto = crate::automations::validate(args, &s)?;
            let text = crate::automations::describe(&auto, &s);
            let value = serde_json::to_value(&auto).map_err(|e| e.to_string())?;
            update_settings(app, |s| s.automations.push(value))?;
            Ok(format!("Creata e accesa: {text}. Si modifica in Impostazioni → Automazioni."))
        }

        "set_automation_enabled" => {
            let id = arg(args, "id").to_string();
            let on = args.get("enabled").and_then(Value::as_bool).ok_or("Manca enabled (true/false).")?;
            let mut found = false;
            update_settings(app, |s| {
                for a in s.automations.iter_mut() {
                    if a.get("id").and_then(Value::as_str) == Some(id.as_str()) {
                        a["enabled"] = json!(on);
                        found = true;
                    }
                }
            })?;
            if !found {
                return Err(format!("Nessuna automazione con id «{id}» (vedi list_automations)."));
            }
            Ok(if on { "Automazione accesa.".into() } else { "Automazione spenta.".into() })
        }

        _ => Err(format!("Strumento sconosciuto: {tool}")),
    }
}
