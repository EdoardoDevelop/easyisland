# Handoff — EasyIsland

_Aggiornato al 16 ottobre 2026. Versione **0.8.5** in `main` con il tag `v0.8.5` (la CI pubblica l'installer). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete; della 0.6.7 «Continua», «Chiedi», «Sempre» di sessione e 📌 come finestra; della 0.6.8 menu con `Win+Alt+A`, «Sostituisci» e reazioni del personaggio; della 0.6.9 e 0.7.0 i nuovi personaggi e la Fiamma animata; della 0.7.1 team e chat di 3CX e il cielo grande; della 0.7.2 il personaggio della chat lasciato su una finestra; della 0.7.3 il piano letto da Anthropic, il tempo rimasto sui permessi e gli appunti rimessi per intero; della 0.7.4 l'isola che non si chiude trascinando il personaggio della chat; della 0.7.5 «Questo PC» di 3CX con audio e suoneria e l'avvio dopo un aggiornamento su un altro PC; della 0.7.7 «Cerchia e chiedi» e il personaggio durante una chiamata 3CX; della 0.7.8 il nuovo impianto, le risposte rapide, la card del Meteo e il personaggio che torna al suo colore; della 0.7.9 le proposte al momento giusto, il riepilogo del giorno e gli strumenti in Claude Code; della 0.8.0 il rinnovo dell'accesso di Claude Code, il ping e le impostazioni di rete, la Rubrica di 3CX; della 0.8.2 «Sostituisci» con la formattazione in Word, Outlook e Gmail; della 0.8.3 la «Modalità terminale» e ⚡ «Automatica» della chat, Notion con l'account vero; della 0.8.4 le automazioni con contesto e le Impostazioni sopra l'isola; della 0.8.5 la barra dell'app in uso e il menu contestuale. Tutte in `docs/prove-dal-vivo.md`.
- [ ] **3CX team e chat:** fatti nel codice, da provare sul centralino vero (`docs/prove-dal-vivo.md`). Se qualcosa non arriva, il log dice quali tipi di messaggio manda il centralino (`3cx: event type …`).
- [ ] **3CX «Questo PC»:** telefono WebRTC nell'isola, suoneria e scheda da telefono fatti nel codice e nell'anteprima; audio vero da provare sul centralino (`docs/prove-dal-vivo.md`).
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Notion, seconda parte:** «Manda a Notion», scheda cliente su 3CX/Zammad, avviso delle scadenze (`docs/idee.md`).
- [ ] **Account Microsoft (API):** predisposto (accesso, Outlook e Teams con Graph); da provare registrando l'app in Entra (`docs/prove-dal-vivo.md`), poi avvisi di mail nuove, chat, automazioni (`docs/integrazioni.md`).
- [ ] **Remote Desktop Manager:** predisposto; prova la settimana prossima sul PC con RDM (`docs/prove-dal-vivo.md`), poi i passi in `docs/idee.md`.
- [ ] **Clic destro in Esplora file:** voci di EasyIsland sui file («Manda a EasyIsland», azioni sui file), deciso con Edoardo l'11 ottobre come passo successivo al menu sulla selezione (`docs/idee.md`).
- [ ] **opencode:** card per lo strumento `question` anche nella chat (per l'agente c'è), controllo di Ollama/LM Studio nel menu (`docs/idee.md`).
- [ ] **Spunti da Coucou:** Amp/Hermes, limiti di Codex, riepilogo condivisibile come immagine, GitHub (`docs/idee.md`).
- [ ] **Prova dal vivo dei nuovi personaggi** (`docs/prove-dal-vivo.md`).
- [ ] **Da decidere con Edoardo:** firma del codice, tag `windows-latest` (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro. Torna davanti a ogni cambio di finestra in primo piano. Va verificato con Start aperto.
- **Limiti del piano da Anthropic:** l'indirizzo (`/api/oauth/usage`) non è documentato e può cambiare; se smette di rispondere il log scrive «limiti del piano da Anthropic: HTTP …» e restano i numeri della status line.
- **Rinnovo dell'accesso di Claude Code** (`renew.rs`): provato qui che Claude Code parte invisibile, apre `/usage` e si chiude senza lasciare processi; il rinnovo vero di un accesso scaduto va visto alla prossima scadenza (`docs/prove-dal-vivo.md`). Chiudendolo, Claude Code al lancio dopo può dire che il suo renderer a schermo intero «non ha finito di partire» e usare quello classico una volta.

## Registro
Al massimo 5 voci, la più recente in alto. Le più vecchie vanno in `docs/archivio/registro.md`.

### 16 ottobre 2026 — Account Microsoft (API), predisposizione
- Su richiesta di Edoardo, Outlook e Teams con Microsoft Graph (`msgraph.rs`, `docs/integrazioni.md`): «Accedi con Microsoft» con PKCE e ritorno su localhost, token in Gestione credenziali, sola lettura. Outlook usa Graph quando c'è l'accesso (anche nuovo Outlook e Outlook chiuso); Teams mostra stato e riunioni con «Partecipa». Guida alla registrazione in Entra nelle Impostazioni.
- **Prove:** test (anche PKCE con l'esempio dell'RFC 7636), card con dati simulati, `npm run smoke`. Non provato con Microsoft: serve la registrazione.

### 16 ottobre 2026 — Microsoft Teams, parte locale
- Su richiesta di Edoardo, integrazione Teams senza account (`teams.rs`, `src/views/teams.ts`, `docs/integrazioni.md`): Teams aperto e in riunione (microfono e webcam), Microfono, Video, Alza la mano, Condividi ed Esci con le scorciatoie di Teams mandate alla sua finestra, anche nella striscia a isola chiusa; Apri Teams, Partecipa dal link copiato; automazioni «inizia / finisce una riunione Teams». Graph (riunioni, chat, stato) è il secondo passo in `docs/idee.md`.
- **Prove:** test, scena `teams&call`, `npm run smoke`. Da provare in una riunione vera (`docs/prove-dal-vivo.md`).

### 16 ottobre 2026 — Barra dell'app in uso personalizzabile, azioni Tasti
- Su richiesta di Edoardo: la barra mostra solo le sue azioni («Nella barra con», `*` = tutti), niente di predefinito; ha la precedenza sulla riga dell'agente. Nuove azioni **Tasti** (`keys.rs`) e domanda su **tutto il testo della finestra**; per azione «Solo nella barra» e aspetto (icona, testo, entrambi); per la barra aspetto, numero massimo, nome del programma. Corretto: `appBar` non era salvato da Rust (mancava in `settings.rs`).
- **Prove:** test (anche delle sequenze di tasti), scena `strip&strip=app`, `npm run smoke`. Tasti veri da provare (`docs/prove-dal-vivo.md`).

### 16 ottobre 2026 — Barra dell'app in uso, Panoramica con i loghi grandi, menu contestuale, versione 0.8.5
- Versione **0.8.5** con queste voci.
- Su richiesta di Edoardo, una «Touch Bar» accanto al personaggio chiuso: le sue azioni rapide legate al programma in primo piano («Nella barra con») e i suggerimenti ⚡ dei programmi noti, quando la striscia non ha altro (`strip.ts`, evento `foreground` da `context.rs`, `docs/architettura.md`). I comandi interni delle app non sono raggiungibili su Windows. Panoramica: logo grande e sbiadito nell'angolo in basso a sinistra, un cerchio per chi non ha logo.
- Menu contestuale dell'isola al posto di quello di WebView2: per integrazioni, agenti, azioni, testo e chat, con «Impostazioni «nome»» che apre le Impostazioni sulla voce (`ctxmenu.ts`, `open_settings_at`, `docs/architettura.md`).
- **Prove:** test, scene `strip&strip=app` e `overview`, `npm run smoke`. Da provare dal vivo (`docs/prove-dal-vivo.md`).

### 15 ottobre 2026 — Automazioni con contesto, Impostazioni sopra l'isola, versione 0.8.4
- Versione **0.8.4** con queste voci, Notion (viste e avvisi), Remote Desktop Manager e Integrazioni a gruppi. Su richiesta di Edoardo:
  - **Impostazioni sopra l'isola:** mentre sono la finestra attiva entrano tra quelle sempre in primo piano, sopra l'isola; poi tornano normali (`keep_settings_above` in `island.rs`, `docs/architettura.md`).
  - **Automazioni** («non solo orario e programmi»): nuovi «quando» (download, chiamata 3CX, agente, server di sviluppo, programma in primo piano, rientro dalla pausa) con filtro; più condizioni con «se non»; ripetizioni; i dati dell'evento nei passi con i vincoli di sicurezza; passo «Chiedi alla chat». Anche lo strumento `create_automation` (`docs/integrazioni.md`). Fatti i punti 1–3 di `docs/idee.md`, tranne calendario e fine giornata.
- **Prove:** test Rust, editor nell'anteprima, `npm run smoke`. Da provare dal vivo (`docs/prove-dal-vivo.md`).
