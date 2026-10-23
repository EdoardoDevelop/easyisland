//! EasyIsland's tools for the chat engines, in one place: the MCP server of
//! the relay (`hook/src/mcp.rs`) offers them, and the app gives the same list
//! to the engine that calls the Anthropic API itself (`src-tauri/src/claude.rs`
//! includes this file with `#[path]`). Only serde_json here.

use serde_json::{json, Value};

/// (name, description, input schema, read-only)
pub fn tools() -> Vec<(&'static str, &'static str, Value, bool)> {
    let none = json!({ "type": "object", "properties": {} });
    vec![
        (
            "get_foreground_app",
            "L'app che l'utente sta usando adesso (eseguibile e titolo della finestra).",
            none.clone(),
            true,
        ),
        (
            "list_status",
            "Lo stato attuale delle integrazioni e dei widget di EasyIsland: PC (disco, memoria, batteria), sicurezza, rete, meteo, Outlook (mail non lette, appuntamenti), ticket Zammad e i controlli dell'utente (siti, server, certificati…). Ogni voce ha livello (ok/warn/error), riassunto e dettagli.",
            none.clone(),
            true,
        ),
        (
            "list_quick_actions",
            "Le azioni rapide che l'utente ha creato in EasyIsland (link, programmi, script, domande a Claude), con id, nome, tipo e a cosa servono. Si eseguono con run_quick_action.",
            none.clone(),
            true,
        ),
        (
            "run_quick_action",
            "Esegue un'azione rapida dell'utente per id (vedi list_quick_actions). Link e programmi si aprono; gli script girano nascosti e ne torna l'output. Le azioni di tipo domanda a Claude non si possono eseguire da qui.",
            json!({ "type": "object", "properties": { "id": { "type": "string", "description": "id dell'azione" } }, "required": ["id"] }),
            false,
        ),
        (
            "open_app",
            "Apre un programma, una cartella o un file sul PC dell'utente. target: nome o percorso (es. \"outlook\", \"notepad\", \"C:\\\\Users\\\\nome\\\\Documents\", \"mstsc\"); args: argomenti facoltativi (es. \"/v:server01\").",
            json!({ "type": "object", "properties": {
                "target": { "type": "string" },
                "args": { "type": "string" }
            }, "required": ["target"] }),
            false,
        ),
        (
            "open_url",
            "Apre un indirizzo web (http o https) nel browser predefinito.",
            json!({ "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"] }),
            false,
        ),
        (
            "read_clipboard",
            "Legge il testo attualmente negli appunti dell'utente.",
            none.clone(),
            false,
        ),
        (
            "write_clipboard",
            "Mette un testo negli appunti dell'utente, pronto da incollare.",
            json!({ "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] }),
            false,
        ),
        (
            "show_notice",
            "Mostra un breve avviso nell'isola di EasyIsland. level: info, ok, warn o error.",
            json!({ "type": "object", "properties": {
                "title": { "type": "string" },
                "text": { "type": "string" },
                "level": { "type": "string", "enum": ["info", "ok", "warn", "error"] }
            }, "required": ["title"] }),
            true,
        ),
        (
            "show_card",
            "Mostra una card nell'isola di EasyIsland, in alto sullo schermo dell'utente, anche mentre lavora in un'altra finestra. Con buttons (fino a 3 etichette brevi) aspetta il clic e restituisce l'etichetta scelta: utile per una domanda rapida o per avvisare che un lavoro lungo è finito. wait_seconds: quanto aspettare (5–300, predefinito 120). level: info, ok, warn o error.",
            json!({ "type": "object", "properties": {
                "title": { "type": "string" },
                "text": { "type": "string" },
                "level": { "type": "string", "enum": ["info", "ok", "warn", "error"] },
                "buttons": { "type": "array", "items": { "type": "string" }, "maxItems": 3 },
                "wait_seconds": { "type": "integer", "minimum": 5, "maximum": 300 }
            }, "required": ["title"] }),
            true,
        ),
        (
            "add_to_tray",
            "Mette una copia di un file nel Vassoio di EasyIsland, da dove l'utente lo trascina in un'email, in una chat o in un'altra app (es. un report, un'immagine o uno ZIP appena creati). path: percorso completo del file.",
            json!({ "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"] }),
            false,
        ),
        (
            "list_work_folder",
            "La cartella di lavoro dell'utente (scelta in EasyIsland, la stessa della modalità terminale): cartelle e file di una sua sottocartella, con il percorso completo della cartella. path: sottocartella relativa, vuoto = la cartella stessa. I file si leggono con Read dal percorso completo.",
            json!({ "type": "object", "properties": { "path": { "type": "string" } } }),
            true,
        ),
        (
            "move_to_work_folder",
            "Sposta (o copia, con copy=true) un file del Vassoio di EasyIsland nella cartella di lavoro dell'utente. name: nome del file nel Vassoio (da list_uploaded_files); folder: sottocartella relativa di destinazione, vuoto = la cartella stessa.",
            json!({ "type": "object", "properties": {
                "name": { "type": "string" }, "folder": { "type": "string" }, "copy": { "type": "boolean" }
            }, "required": ["name"] }),
            false,
        ),
        (
            "media_status",
            "Cosa sta suonando sul PC (titolo, artista, app, in riproduzione o in pausa), se l'integrazione Musica è accesa.",
            none.clone(),
            true,
        ),
        (
            "media_control",
            "Controlla la musica: toggle (play/pausa), next, prev.",
            json!({ "type": "object", "properties": { "command": { "type": "string", "enum": ["toggle", "next", "prev"] } }, "required": ["command"] }),
            true,
        ),
        (
            "list_uploaded_files",
            "I file nel Vassoio di EasyIsland: quelli che l'utente ha rilasciato sull'isola (copie) e quelli messi con add_to_tray, con percorso, dimensione e data. Si possono leggere con Read.",
            none.clone(),
            true,
        ),
        (
            "notion_map",
            "La struttura del Notion dell'utente, salvata da EasyIsland (nessuna chiamata a Notion): database con id, link, proprietà e tipo, opzioni di stati e selezioni, relazioni; senza database anche le pagine. Usala prima degli strumenti di Notion invece di cercare come è fatto. database: nome (anche una parte) o id, vuoto = tutti.",
            json!({ "type": "object", "properties": { "database": { "type": "string" } } }),
            true,
        ),
        (
            "notion_search",
            "Cerca pagine e database nel Notion dell'utente per titolo, con il collegamento di EasyIsland. query: parole del titolo.",
            json!({ "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] }),
            true,
        ),
        (
            "notion_read",
            "Legge una pagina o una riga di Notion: proprietà e testo. page: id o link.",
            json!({ "type": "object", "properties": { "page": { "type": "string" } }, "required": ["page"] }),
            true,
        ),
        (
            "notion_query",
            "Le righe di un database di Notion con id e proprietà, le più recenti prima. database: nome (anche una parte) o id; text: solo le righe col titolo che lo contiene; filter: filtro nel formato dell'API di Notion con i nomi della mappa (es. {\"and\": [{\"property\": \"Data\", \"date\": {\"on_or_after\": \"2026-10-01\"}}, {\"property\": \"Categoria\", \"select\": {\"equals\": \"Casa\"}}]}); sorts: ordine nel formato dell'API; limit: quante (predefinito 20, massimo 200). Per totali e conti usa filter e controlla che la risposta dica «sono tutte».",
            json!({ "type": "object", "properties": {
                "database": { "type": "string" },
                "text": { "type": "string" },
                "filter": { "type": "object" },
                "sorts": { "type": "array", "items": { "type": "object" } },
                "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
            }, "required": ["database"] }),
            true,
        ),
        (
            "notion_add_row",
            "Aggiunge una riga a un database di Notion. database: nome o id (vedi notion_map). properties: { \"Nome proprietà\": valore } con i nomi esatti; testo per titolo e testo, numero (anche \"6,40\"), nome dell'opzione per selezione e stato, elenco per selezione multipla, \"AAAA-MM-GG\" o {start, end} per le date, true/false per le caselle, id o titoli per le relazioni. I valori sono controllati prima di scrivere: se qualcosa non va, torna l'errore con le proprietà e le opzioni giuste.",
            json!({ "type": "object", "properties": {
                "database": { "type": "string" },
                "properties": { "type": "object" }
            }, "required": ["database", "properties"] }),
            false,
        ),
        (
            "notion_update_row",
            "Cambia le proprietà di una riga di un database di Notion (vedi notion_query per l'id). page: id o link della riga; properties: come notion_add_row, solo quelle da cambiare.",
            json!({ "type": "object", "properties": {
                "page": { "type": "string" },
                "properties": { "type": "object" }
            }, "required": ["page", "properties"] }),
            false,
        ),
        (
            "notion_delete_row",
            "Sposta una riga di un database di Notion nel cestino di Notion (si può ripristinare da lì). page: id o link della riga (notion_query). Prima chiedi conferma all'utente in chat dicendo quale riga elimini, e aspetta il suo sì; poi chiama con confirmed: true. Senza conferma non elimina nulla.",
            json!({ "type": "object", "properties": {
                "page": { "type": "string" },
                "confirmed": { "type": "boolean" }
            }, "required": ["page", "confirmed"] }),
            false,
        ),
        (
            "remote_status",
            "Il PC remoto a cui la chat è collegata (scheda «Accesso remoto» dell'isola, pulsante 🔌 nella chat): nome, indirizzo, sistema, WinRM o SSH. Errore se non c'è una connessione o la chat non è collegata.",
            json!({ "type": "object", "properties": {} }),
            true,
        ),
        (
            "remote_run",
            "Esegue un comando sul PC remoto collegato alla chat e ne restituisce l'uscita: PowerShell se è Windows, sh se è Linux (remote_status lo dice). Ogni chiamata è una sessione nuova: cartella e variabili non restano, quindi metti tutto in un comando. Preferisci comandi che leggono; prima di cambiare o cancellare qualcosa dillo all'utente. command: il comando; timeout: secondi (predefinito 120, massimo 300).",
            json!({ "type": "object", "properties": {
                "command": { "type": "string" },
                "timeout": { "type": "integer", "minimum": 5, "maximum": 300 }
            }, "required": ["command"] }),
            false,
        ),
        (
            "memory_search",
            "Cerca nella memoria della chat: le note salvate e il diario delle domande passate (una riga per domanda, con data, motore, domanda e inizio della risposta), dalle più recenti. query: parole da trovare (tutte); month: \"AAAA-MM\" per un mese solo. Usalo quando l'utente si riferisce a qualcosa di una volta precedente.",
            json!({ "type": "object", "properties": {
                "query": { "type": "string" },
                "month": { "type": "string" }
            }, "required": ["query"] }),
            true,
        ),
        (
            "memory_note",
            "Salva una nota nella memoria della chat (MEMORIA.md), che arriva all'inizio di ogni conversazione: una riga breve su ciò che vale anche le prossime volte (preferenze, clienti, persone, come si fa una cosa). Non salvare password, chiavi o dati sensibili. text: la nota.",
            json!({ "type": "object", "properties": {
                "text": { "type": "string" }
            }, "required": ["text"] }),
            true,
        ),
        (
            "todo_list",
            "Le attività di Microsoft To Do (da Outlook classico, che deve essere aperto), con id breve, scadenza, importanza, promemoria e nota, e i nomi delle liste. list: nome della lista (vuoto = tutte); done: true per vedere anche quelle fatte; limit: quante (predefinito 50).",
            json!({ "type": "object", "properties": {
                "list": { "type": "string" },
                "done": { "type": "boolean" },
                "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
            } }),
            true,
        ),
        (
            "todo_add",
            "Aggiunge un'attività a Microsoft To Do (tramite Outlook classico). title obbligatorio; list: nome della lista (vuoto = Attività); due: \"AAAA-MM-GG\"; reminder: \"AAAA-MM-GG HH:MM\"; importance: low, normal o high; note: testo.",
            json!({ "type": "object", "properties": {
                "title": { "type": "string" },
                "list": { "type": "string" },
                "due": { "type": "string" },
                "reminder": { "type": "string" },
                "importance": { "type": "string", "enum": ["low", "normal", "high"] },
                "note": { "type": "string" }
            }, "required": ["title"] }),
            false,
        ),
        (
            "todo_update",
            "Cambia un'attività di Microsoft To Do: id da todo_list; solo i campi da cambiare tra title, due (\"\" la toglie), reminder (\"\" lo toglie), importance, note (sostituisce la nota), done (true = fatta, false = da fare). Non elimina.",
            json!({ "type": "object", "properties": {
                "id": { "type": "string" },
                "title": { "type": "string" },
                "due": { "type": "string" },
                "reminder": { "type": "string" },
                "importance": { "type": "string", "enum": ["low", "normal", "high"] },
                "note": { "type": "string" },
                "done": { "type": "boolean" }
            }, "required": ["id"] }),
            false,
        ),
        (
            "list_profiles",
            "I profili di EasyIsland (es. Lavoro, Casa) e quello attivo.",
            none.clone(),
            true,
        ),
        (
            "list_automations",
            "Le automazioni dell'utente (Impostazioni → Automazioni): id, nome, accesa o spenta, quando partono e cosa fanno.",
            none.clone(),
            true,
        ),
        (
            "create_automation",
            "Crea un'automazione \"quando… se… allora…\" che poi gira da sola. L'utente vede l'anteprima e conferma. Prima usa list_quick_actions, list_profiles e list_status per gli id. trigger.kind: time (time \"HH:MM\", days 1=lun…7=dom, vuoto = ogni giorno) | startup (delay secondi dopo l'avvio di EasyIsland, con il PC) | unlock (sblocco del PC) | wifi (ssid) | app (exe che parte, es. teams.exe) | foreground (exe che passa in primo piano) | drive (chiavetta o disco collegato) | folder (folder: nuovo file nella cartella) | download (download finito) | integration (source: id di un'integrazione-controllo o widget da list_status; when: problem | event | any) | call (chiamata 3CX in arrivo) | agent (when: stop = un agente ha finito | permission = aspetta un permesso | any) | server (parte un server di sviluppo) | back (rientro dopo almeno minutes minuti senza tastiera e mouse) | teams (when: start = inizia una riunione Teams | end = finisce). trigger.filter per folder, download, integration, call, agent, server: parole separate da virgola, \".pdf\" = estensione, altrimenti contenuta nel nome del file, chiamante, progetto. profile: id di un profilo o vuoto. conditions (tutte vere, not = la negazione): hours (from, to \"HH:MM\", days) | wifi (ssid) | app (exe aperto) | foreground (exe in primo piano) | battery (percent 0 = a batteria, altrimenti sotto il percent %) | idle (minutes senza tastiera e mouse) | meeting (microfono o webcam in uso) | client (davanti al cliente). repeat: \"\" ogni volta | every (al massimo ogni every minuti) | day (una volta al giorno). steps in ordine, kind: quick (id azione rapida) | notice (title, text, level info/ok/warn/error) | profile (id) | app (target, args) | url (url) | chat (text: la domanda da mandare alla chat) | task (title, text: l'obiettivo di un compito che EasyIsland porta avanti da solo). In notice, url, app, chat e task si possono usare i dati del quando: {file} {percorso} {cartella} (folder, download, agent), {rete}, {programma}, {unità}, {testo} {fonte} (integration), {chiamante} {numero} (call), {agente} {progetto} (agent), {porta} {link} (server), {minuti} (back), sempre {ora} e {data}. notify: avvisa ogni volta che gira.",
            json!({ "type": "object", "properties": {
                "name": { "type": "string" },
                "trigger": { "type": "object", "properties": {
                    "kind": { "type": "string", "enum": ["time", "startup", "unlock", "wifi", "app", "foreground", "drive", "folder", "download", "integration", "call", "agent", "server", "back", "teams"] },
                    "time": { "type": "string" },
                    "days": { "type": "array", "items": { "type": "integer", "minimum": 1, "maximum": 7 } },
                    "delay": { "type": "integer" },
                    "ssid": { "type": "string" },
                    "exe": { "type": "string" },
                    "folder": { "type": "string" },
                    "source": { "type": "string" },
                    "when": { "type": "string", "enum": ["problem", "event", "any", "stop", "permission", "start", "end"] },
                    "filter": { "type": "string" },
                    "minutes": { "type": "integer" }
                }, "required": ["kind"] },
                "profile": { "type": "string" },
                "conditions": { "type": "array", "items": { "type": "object", "properties": {
                    "kind": { "type": "string", "enum": ["hours", "wifi", "app", "foreground", "battery", "idle", "meeting", "client"] },
                    "not": { "type": "boolean" },
                    "from": { "type": "string" },
                    "to": { "type": "string" },
                    "days": { "type": "array", "items": { "type": "integer", "minimum": 1, "maximum": 7 } },
                    "ssid": { "type": "string" },
                    "exe": { "type": "string" },
                    "minutes": { "type": "integer" },
                    "percent": { "type": "integer", "minimum": 0, "maximum": 100 }
                }, "required": ["kind"] } },
                "repeat": { "type": "string", "enum": ["", "every", "day"] },
                "every": { "type": "integer" },
                "steps": { "type": "array", "items": { "type": "object", "properties": {
                    "kind": { "type": "string", "enum": ["quick", "notice", "profile", "app", "url", "chat", "task"] },
                    "id": { "type": "string" },
                    "title": { "type": "string" },
                    "text": { "type": "string" },
                    "level": { "type": "string" },
                    "target": { "type": "string" },
                    "args": { "type": "string" },
                    "url": { "type": "string" }
                }, "required": ["kind"] } },
                "notify": { "type": "boolean" }
            }, "required": ["name", "trigger", "steps"] }),
            false,
        ),
        (
            "set_automation_enabled",
            "Accende o spegne un'automazione per id (vedi list_automations).",
            json!({ "type": "object", "properties": {
                "id": { "type": "string" },
                "enabled": { "type": "boolean" }
            }, "required": ["id", "enabled"] }),
            false,
        ),
        (
            "get_settings",
            "Le impostazioni di EasyIsland che si possono cambiare con set_setting, divise per sezione (Chat, Integrazioni, Isola e aspetto, Riepiloghi…): chiave, valore attuale, a cosa serve e valori ammessi. Le altre (chiavi, connettori, modalità terminale) si cambiano solo in Impostazioni.",
            none.clone(),
            true,
        ),
        (
            "set_setting",
            "Cambia un'impostazione di EasyIsland, con effetto immediato (vale per il profilo attivo se è un'impostazione del profilo). key: una chiave di get_settings (es. chatEngine, cliModel, engineModels.opencode, theme.character, language, notify, integrations.integration_weather); value: il nuovo valore (true/false, un numero o un testo tra quelli ammessi). L'utente conferma.",
            json!({ "type": "object", "properties": {
                "key": { "type": "string" },
                "value": {}
            }, "required": ["key", "value"] }),
            false,
        ),
        (
            "task_plan",
            "Solo dentro un compito di EasyIsland: scrive o corregge il piano del compito. steps: i passi, brevi e concreti, nell'ordine (al massimo 20). I passi già fatti con le stesse parole restano fatti.",
            json!({ "type": "object", "properties": {
                "steps": { "type": "array", "items": { "type": "string" } }
            }, "required": ["steps"] }),
            true,
        ),
        (
            "task_step",
            "Solo dentro un compito: segna un passo del piano. index: il numero del passo (da 1); done: true se fatto (predefinito), false se va rifatto; note: cosa è stato fatto, in breve.",
            json!({ "type": "object", "properties": {
                "index": { "type": "integer", "minimum": 1 },
                "done": { "type": "boolean" },
                "note": { "type": "string" }
            }, "required": ["index"] }),
            true,
        ),
        (
            "task_note",
            "Solo dentro un compito: una riga nel registro del compito (cosa hai trovato, cosa hai deciso).",
            json!({ "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] }),
            true,
        ),
        (
            "task_ask",
            "Solo dentro un compito: fa una domanda all'utente con una card nell'isola (pulsanti per options, più un campo per una risposta libera). Restituisce la risposta; se non risponde subito il compito aspetta e devi chiudere il turno. question: la domanda; options: fino a 6 risposte possibili.",
            json!({ "type": "object", "properties": {
                "question": { "type": "string" },
                "options": { "type": "array", "items": { "type": "string" } }
            }, "required": ["question"] }),
            true,
        ),
        (
            "task_done",
            "Solo dentro un compito: lo chiude come fatto. result: il risultato per l'utente, breve e utile (cosa è stato fatto, dove trovarlo, cosa resta a lui).",
            json!({ "type": "object", "properties": { "result": { "type": "string" } }, "required": ["result"] }),
            true,
        ),
        (
            "task_create",
            "Crea un compito di EasyIsland: un obiettivo che l'agente porta avanti da solo, a turni, con un piano, finché è fatto o gli serve l'utente. Usalo quando l'utente chiede di fare qualcosa più tardi, a un orario, ogni giorno, o un lavoro lungo. title: breve; goal: cosa fare, con tutti i dettagli che servono; when: vuoto = subito, \"at:AAAA-MM-GG HH:MM\", \"daily:HH:MM\" o \"weekdays:HH:MM\". L'utente conferma.",
            json!({ "type": "object", "properties": {
                "title": { "type": "string" },
                "goal": { "type": "string" },
                "when": { "type": "string" }
            }, "required": ["goal"] }),
            false,
        ),
        (
            "task_list",
            "I compiti di EasyIsland: id, titolo, stato (scheduled, queued, running, asking, paused, done, failed, stopped), passi fatti e ultima riga.",
            none.clone(),
            true,
        ),
        (
            "switch_profile",
            "Attiva un profilo di EasyIsland per id (vedi list_profiles).",
            json!({ "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }),
            false,
        ),
    ]
}
