# Flussi

Automazioni e compiti sono un solo sistema a nodi con editor visivo (deciso il 25/10/2026). Tappe 1–6 fatte; da provare dal vivo un flusso vero con agente (con `fields`), foreach, scelta del modello, domanda su Telegram e ripresa dopo riavvio.

## Scelte di fondo
- **Un flusso è un'automazione con passi collegati:** resta `settings.automations`; ogni passo ha un nome (`node`; `id` è l'azione rapida), `next` (id, `"end"` o vuoto = il seguente) e `branches`. Le automazioni lineari sono già flussi; nessuna migrazione.
- **I nodi Agente usano i compiti** (`tasks.rs` invariato): il nodo crea un compito e ne aspetta il risultato.
- **Sicurezza invariata:** niente nodi con codice; gli agenti hanno strumenti e permessi della chat.

## Motore (`flows.rs`, `automations::Step`)
- Nodi: **Agente** (`agent`: obiettivo, motore, modello; risultato in `{<id>}` e `{risultato}`), **Decisione** (`decide`: contiene, uguale, vuoto, altrimenti; oppure `op: "model"` con `toMatch`, il motore risponde col numero via `Channel::Helper` senza strumenti, `by_model`, `first_number`), **Chiedi a me** (`ask`: card con 1–3 scelte), **Per ogni elemento** (`foreach`: righe di `text`, max 30, in `{elemento}` → `body`; stato in `Run.loops`).
- Ogni passo scrive in `{<id>}`. `validate`: id unici, destinazioni esistenti.
- Giri salvati dopo ogni passo in `%APPDATA%\EasyIsland\flussi\<giro>.json`; al riavvio riprendono (attese col tempo rimasto, agenti ritrovano il compito). Passi con effetti rimasti a metà (`inflight`: programmi, link, azioni rapide, avvisi, chat, compiti) non si ripetono: vanno in `onError` come «interrotto dal riavvio».
- Limiti per giro: 200 passi, 20 passi con un motore (agenti e scelte del modello).
- `retries` 0–3 (10 s, 30 s, 90 s), mai su domande e conferme; un `decide` a regole non si riprova.
- `onError` con `{errore}`; un errore gestito non segna il giro fallito; «finisci senza errore» = riuscito. Giro fallito → messaggio su Telegram se collegato.
- Agenti: `minutes` (60 di serie) poi il passo fallisce; `fields` → l'agente chiude con JSON, campi in `{nome.campo}`, senza JSON il passo fallisce. Domande: 10 minuti.
- `ask` anche su Telegram (`telegram::ask_flow`, chiave `flow-<giro>`): vale la prima risposta (`tasks::first_some`), la card sparisce (`moments::expire_card`); a parole con /rispondi (`flows::answer_latest`, prima dei compiti).

## Chat
`create_automation` con nodi, rami, agenti (anteprima = conferma): schema in `hook/src/tool_list.rs`, anteprima in `describeAutomation` (`src/island/hooks.ts`), riassunto `automations::describe`.

## Finestra «Flussi»
- `flussi.html`, `src/flows/` (`main.ts`, `catalog.ts`, `flows.css`); creata alla prima apertura (`open_flows_window`, async: dal thread principale si bloccherebbe), poi nascosta. Il flusso da mostrare lo chiede con `flow_pending` (in release la query nell'indirizzo non passa).
- Elenco a sinistra con «+ Nuovo flusso»; disegno dall'alto con scheda **Quando**, «+» fra i passi e «Fine»; barra dei blocchi da trascinare o cliccare; pannello a destra con moduli e dati disponibili come pastiglie. Rami e salti scritti dentro la scheda, non fili.
- Flusso vuoto: «Descrivilo a parole» (`flow_ask_chat`) e tre modelli pronti. «Prova» e «Prova da qui» (`flow_try_from`, `flows::try_from`, con i dati dell'ultima esecuzione); esecuzioni a destra, schede verdi/rosse.
- Salvataggio automatico di un flusso alla volta (`flow_save`, `flow_delete`; niente sovrascritture fra finestre), «Da completare: …» da `catalog::missing`.
- Impostazioni → Flussi (id pagina `compiti`): solo elenco (acceso/spento, Modifica), proposte dalle abitudini, compiti. Guida: 16-automazioni, 14-compiti.
