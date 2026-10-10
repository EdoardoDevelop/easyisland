# Integrazioni, widget, azioni e automazioni

## Integrazione o widget
Un servizio o programma che di solito c'è una volta sola è un'**integrazione** (Impostazioni → Integrazioni), mai un widget. I widget sono solo controlli ripetibili: ping, porta, sito, certificato, servizio, API JSON, calendario ICS, domini.

## Dove stanno
- Integrazioni con API (Stripe, n8n, GitHub, Vercel, Resend, Notion, Cal.com): `src-tauri/src/integrations.rs`.
- Integrazioni che sono controlli (`settings::PROBE_INTEGRATIONS`) girano nello scheduler di `src-tauri/src/widgets.rs` (`all_widgets`), con le opzioni in `integrationConfig`:
  - stato del PC, sicurezza, rete e meteo: `probes.rs`. Il meteo manda anche `sky` (`sky_kind`: codice WMO e `is_day` → il cielo che il personaggio mostra). Con la pioggia probabile resta l'avviso (badge e suono), ma la pillola non usa lo stato `ratelimit` (`integrations.ts`).
  - Outlook classico (COM via PowerShell; il nuovo Outlook `olk.exe` non è supportato): `outlook.rs`
  - Zammad (usa `ticket_overviews`, che funziona senza Elasticsearch): `zammad.rs`
- Widget: `widgets.rs`, `probes.rs` (domini), `calendar.rs` (ICS). Lo scheduler gira ogni 5 s, con intervalli minimi per ogni controllo, ed è più lento a batteria. Un errore nuovo si mostra solo dopo un secondo controllo 15 s dopo (`hold_back`); dopo uno standby (salto dell'orologio di più di 60 s tra due giri) per 90 s i nuovi errori si riprovano soltanto, perché la rete torna con calma.
- Consumo di Claude Code (`integration_claude_usage`): `usage.rs`. Legge i token dalle trascrizioni in `~/.claude/projects`, solo i campi di consumo e mai il testo, una volta per `message.id`. In cima mette i limiti del piano (5 ore e settimana) arrivati dalla status line (`set_plan`, `plan-limits.json`); dall'80 % la card avvisa, e al cambio di fascia (50/80/100 %) il controllo riparte subito (`widgets::refresh`).
- Profili automatici: `profiles.rs`. "Davanti al cliente": `presence.rs` (niente nomi né titoli sullo schermo). Scorciatoie globali: `hotkeys.rs`; «Apri l'isola» apre la Panoramica (`onHotkey` in `island.ts`), o la richiesta in attesa se ce n'è una; premuta con l'isola aperta la chiude.
- «Apri» delle integrazioni: `open_integration` in `lib.rs`, solo bersagli fissi. Se non c'è nulla da aprire il pulsante non compare (`canOpen`).

## 3CX
- `src-tauri/src/threecx/`:
  - `myphone.rs`: accesso con interno e password, con il protocollo del web client V20 ricostruito (protobuf "MyPhone" e websocket). È un protocollo non documentato e può rompersi con un aggiornamento del centralino.
  - `api.rs`: client API ufficiale (serve una licenza 8SC+).
  - `pb.rs`: protobuf minimo.
- Websocket con WinHTTP: `src-tauri/src/wss.rs`. Scheda: `src/views/threecx.ts`. Le righe `3cx: call` finiscono in `easyisland.log`.
- L'analisi completa del protocollo è in `archivio/HANDOFF-fino-al-6-ottobre.md`, sezione 7.

## Azioni rapide (`actions.rs`, `actionsSection`)
- Tipi: link, programmi, script, prompt su appunti, testo selezionato o file. Le azioni sui file rilasciati non hanno cartella.
- `open_app` toglie le virgolette, espande `%VARIABILI%` e, se CreateProcess fallisce, usa `ShellExecuteExW` con `SEE_MASK_FLAG_NO_UI`. Così funzionano App Paths, `shell:` e `ms-settings:`, e la richiesta di elevazione. Un nome sbagliato diventa un errore nell'isola, non una finestra di Windows.
- Cartelle: `QuickAction.folder` = "i:<icona> Nome", "🖥 Nome" o "Nome" (`folderLook`/`folderValue` in `state.ts`). Oltre 8 azioni compare «Cerca un'azione».
- Nelle Impostazioni ogni modifica resta una bozza (`drafts`) con Salva / Annulla. Spostare ed eliminare valgono subito.

## Automazioni (`src-tauri/src/automations.rs`)
- Regole "quando… se… allora…" in `settings.automations` (salvate per PC). La pagina è `automationsSection`.
- Il registro è in memoria. Lo sblocco del PC arriva da `WTSRegisterSessionNotification`. Si interroga solo ciò che serve alle automazioni accese. I controlli arrivano da `widgets.rs` (`automations::on_widget`).
- Le azioni che vogliono una conferma o Claude passano all'isola (`automation-action`). Ogni regola passa da `automations::validate`.

## Proposte dalle abitudini (`src-tauri/src/habits.rs`)
- Spente di serie (`habitsEnabled`). Registrano solo nomi di programmi e orari in `habits.jsonl` locale, mai titoli o contenuti. L'analisi è la funzione pura `analyse`.
- Rifiuti in `suggestionsDismissed`, rimandi in `suggestionsSnoozed`. Una proposta diventa un'automazione solo con un clic e passa da `automations::validate`.
