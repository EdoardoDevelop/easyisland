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
- Consumo di Claude Code (`integration_claude_usage`): `usage.rs`. Legge i token dalle trascrizioni in `~/.claude/projects`, solo i campi di consumo e mai il testo, una volta per `message.id`. In cima mette i limiti del piano (5 ore, settimana e settimana Opus) in `plan-limits.json`, dalla fonte più recente fra due: Anthropic (`ask_anthropic`, ogni 5 minuti mentre la card è attiva, 30 dopo un errore; `GET api.anthropic.com/api/oauth/usage` con il token di `~/.claude/.credentials.json`, solo letto e mai nel log; token scaduto = `expired` nel log, distinto da `no-login`: non si rinnova (`docs/decisioni.md`); quando `.credentials.json` cambia si chiede subito; «Aggiorna» nella card chiede subito con `usage::ask_now`) e la status line (`set_plan`). Dall'80 % la card avvisa, e al cambio di fascia (50/80/100 %) il controllo riparte subito (`widgets::refresh`). Le percentuali vanno anche nell'intestazione dell'isola («5h 12% 7g 83%», `PlanGauge` → `planGauge` in `views.ts`), tolte con «Piano nell'isola» → «Solo nella card» (`planInHeader`). Numeri di oltre 15 minuti (`PlanGauge.at`) diventano grigi nell'intestazione, e il suggerimento parte da «Piano aggiornato: 7 h fa · motivo» (`plan_problem`).
- Profili automatici: `profiles.rs`. "Davanti al cliente": `presence.rs` (niente nomi né titoli sullo schermo). Durante una chiamata 3CX (`threecx::in_call`, anche sul telefono «Questo PC», che usa il microfono dell'isola) il microfono non conta: il personaggio deve restare per chiudere la chiamata. Scorciatoie globali: `hotkeys.rs`; «Apri l'isola» apre la Panoramica (`onHotkey` in `island.ts`), o la richiesta in attesa se ce n'è una; premuta con l'isola aperta la chiude.
- «Apri» delle integrazioni: `open_integration` in `lib.rs`, solo bersagli fissi. Se non c'è nulla da aprire il pulsante non compare (`canOpen`).

## 3CX
- `src-tauri/src/threecx/`:
  - `myphone.rs`: accesso con interno e password, con il protocollo del web client V20 ricostruito (protobuf "MyPhone" e websocket). È un protocollo non documentato e può rompersi con un aggiornamento del centralino.
  - `api.rs`: client API ufficiale (serve una licenza 8SC+).
  - `pb.rs`: protobuf minimo.
- Websocket con WinHTTP: `src-tauri/src/wss.rs`. Scheda: `src/views/threecx.ts`. Le righe `3cx: call` finiscono in `easyisland.log`.
- **Team, chat, segreteria, code, trasferimento** (11 ottobre 2026, solo con «Interno e password»): messaggi ricavati dal codice pubblico del web client V20 (schema protobuf nei suoi file `main.*.js` e nei pezzi caricati dopo); numeri dei tipi e dei campi in `myphone.rs`.
  - Team: i colleghi arrivano spinti dal centralino come gruppi (tipo 208), interi alla connessione e poi a pezzi; lo stato (disponibile, assente, non disturbare, al telefono, squilla, non collegato) si ricava da registrazione, profilo, «occupato» e chiamate del collega (`Team` in `myphone.rs`). Una chiamata che squilla a un collega si prende con «Rispondi al suo posto» (PickupCall).
  - Chat: la conversazione con dei colleghi si apre con CreateConversation e gli interni ordinati come testo e uniti da «:» (il proprio compreso), come fa il web client; i messaggi nuovi, i non letti e «sta scrivendo» arrivano spinti (209, 229, 180). I messaggi letti a schermo si segnano con i loro id (SetChatReceived). Le conversazioni esterne (live chat, WhatsApp…) si leggono e si scrivono come le altre, senza le azioni da operatore (prendi, chiudi, trasferisci).
  - Un messaggio nuovo: badge sulla pillola 3CX, suono e isola aperta sulla conversazione, ma solo se l'isola non è già in uso; davanti al cliente o con «solo permessi» solo il badge (`incomingMessage` in `src/island/integrations.ts`).
  - Segreteria: elenco con la trascrizione del centralino; «Ascolta» fa squillare il telefono (PlayVoiceMail), non scarica l'audio.
  - Code: «In coda / Fuori coda» compare solo se il centralino manda delle code per l'interno; cambia solo quel campo dello stato.
  - Trasferisci (chiamata in linea) e Devia (chiamata che squilla, anche in segreteria): il team si apre in modalità scelta; Invio passa la chiamata al primo collega o al numero scritto.
  - Tutto in memoria come le chiamate: nessun messaggio o nome su disco né nel log (solo quanti colleghi, `3cx: team of N colleagues`).
- **«Questo PC»: EasyIsland come telefono** (12 ottobre 2026, solo con «Interno e password»), come il web client V20 nel browser. Ricavato dal suo codice (`webrtcService` in `main.*.js`):
  - Si sceglie nel menu del dispositivo della scheda (`threecxDevice = "pc"`). Solo allora la sessione si registra come dispositivo WebRTC dell'interno (RegisterWebRTCEndpoint 163, `NeedsRegistration` falso come il web client) e lo toglie uscendo; cambiare dispositivo da o verso «Questo PC» ricollega la sessione (`settings_saved`). Il centralino lo fa squillare come gli altri dispositivi.
  - Segnalazione in Rust (`WebRtc` in `myphone.rs`, comando `threecx_webrtc`): le chiamate del telefono arrivano spinte come MyWebRTCEndpoint (227, a delta come MyInfo) con l'SDP del centralino; ogni passo torna con ChangeSDPState (164 → 228 con il CallId). Audio WebRTC nella pagina dell'isola: `src/core/softphone.ts`. Uscente: nostra offerta con il numero (o `replaceConnectionId` per «Rispondi al suo posto») → «answer provided» → conferma. Entrante: offerta (o richiesta di offerta) del centralino → nostra risposta dopo «Rispondi». Nessun server STUN, ICE raccolto per intero prima di mandare l'SDP, come il web client. Riaggancia e Rifiuta restano DropCall sulla connessione; la chiamata della scheda si lega a quella WebRTC con il SIPDialogID (campo 32 della connessione, 8 del WebRTCCall).
  - Microfono: concesso alla sola finestra dell'isola (`allow_microphone`, PermissionRequested di WebView2), altrimenti WebView2 mostrerebbe un suo avviso. Il microfono si chiude a fine chiamata, così «davanti al cliente» (che durante la chiamata scatta, il microfono è in uso) torna libero.
  - Durante una chiamata dal PC il tastierino manda i toni (DTMF) e c'è «Muto».
  - Suoneria: un trillo sintetizzato in `softphone.ts` (un WAV fatto una volta e suonato da un `<audio>` in loop come il file dell'utente: un `AudioContext` aperto da un evento del centralino, senza clic, può restare sospeso in WebView2 e suonare muto), oppure un file dell'utente (MP3, WAV, OGG, M4A fino a 10 MB) copiato come `ringtone.<ext>` accanto alle impostazioni (`threecx::set_ringtone`, scelto in Impostazioni → 3CX e inviato come corpo grezzo del comando). Suona solo per le chiamate che squillano su «Questo PC»; `threecxRing` la silenzia (anche dall'altoparlante nell'intestazione della scheda).
- **Chiamata in arrivo nell'isola:** `threecxAlert` falso (Impostazioni o campanella della scheda) lascia solo il pallino sulla pillola, senza suono né isola aperta (`incomingCall` in `src/island/integrations.ts`).
- **Scheda come un telefono** (`src/views/threecx.ts`): a sinistra display, tastierino, tasto verde e dispositivo; a destra chiamate in corso (pulsanti tondi con la scritta sotto) e un elenco alla volta, Recenti all'apertura; sotto la barra di icone Team, Chat, Segreteria, Recenti, Perse con i contatori. Scrivendo lettere nel display compare la rubrica. Con il client API niente barra (non ci sono team, chat né cronologia).
- L'analisi completa del protocollo è in `archivio/HANDOFF-fino-al-6-ottobre.md`, sezione 7.

## Azioni rapide (`actions.rs`, `actionsSection`)
- Tipi: link, programmi, script, prompt su appunti, testo selezionato o file. Le azioni sui file rilasciati non hanno cartella.
- Un prompt sul testo selezionato ha `output`: «chat» (predefinito) o «replace», che riscrive la selezione con l'anteprima di «Sostituisci» (`docs/strumenti.md`). Nell'editor è una scelta sola, «Lavora su» (`PromptUse`), invece di due menu. Queste azioni sono le voci del menu di `Win+Alt+A`.
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
