# Handoff — EasyIsland

_Aggiornato al 15 ottobre 2026. Versione **0.8.4** in `main` con il tag `v0.8.4` (la CI pubblica l'installer). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete; della 0.6.7 «Continua», «Chiedi», «Sempre» di sessione e 📌 come finestra; della 0.6.8 menu con `Win+Alt+A`, «Sostituisci» e reazioni del personaggio; della 0.6.9 e 0.7.0 i nuovi personaggi e la Fiamma animata; della 0.7.1 team e chat di 3CX e il cielo grande; della 0.7.2 il personaggio della chat lasciato su una finestra; della 0.7.3 il piano letto da Anthropic, il tempo rimasto sui permessi e gli appunti rimessi per intero; della 0.7.4 l'isola che non si chiude trascinando il personaggio della chat; della 0.7.5 «Questo PC» di 3CX con audio e suoneria e l'avvio dopo un aggiornamento su un altro PC; della 0.7.7 «Cerchia e chiedi» e il personaggio durante una chiamata 3CX; della 0.7.8 il nuovo impianto, le risposte rapide, la card del Meteo e il personaggio che torna al suo colore; della 0.7.9 le proposte al momento giusto, il riepilogo del giorno e gli strumenti in Claude Code; della 0.8.0 il rinnovo dell'accesso di Claude Code, il ping e le impostazioni di rete, la Rubrica di 3CX; della 0.8.2 «Sostituisci» con la formattazione in Word, Outlook e Gmail; della 0.8.3 la «Modalità terminale» e ⚡ «Automatica» della chat, Notion con l'account vero; della 0.8.4 le automazioni con contesto e le Impostazioni sopra l'isola. Tutte in `docs/prove-dal-vivo.md`.
- [ ] **3CX team e chat:** fatti nel codice, da provare sul centralino vero (`docs/prove-dal-vivo.md`). Se qualcosa non arriva, il log dice quali tipi di messaggio manda il centralino (`3cx: event type …`).
- [ ] **3CX «Questo PC»:** telefono WebRTC nell'isola, suoneria e scheda da telefono fatti nel codice e nell'anteprima; audio vero da provare sul centralino (`docs/prove-dal-vivo.md`).
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Notion, seconda parte:** «Manda a Notion», scheda cliente su 3CX/Zammad, avviso delle scadenze (`docs/idee.md`).
- [ ] **Account Microsoft** (mail nuove e calendario con Graph, ripieghi se l'azienda blocca il consenso): da decidere (`docs/idee.md`).
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

### 15 ottobre 2026 — Automazioni con contesto, Impostazioni sopra l'isola, versione 0.8.4
- Versione **0.8.4** con queste voci, Notion (viste e avvisi), Remote Desktop Manager e Integrazioni a gruppi. Su richiesta di Edoardo:
  - **Impostazioni sopra l'isola:** mentre sono la finestra attiva entrano tra quelle sempre in primo piano, sopra l'isola; poi tornano normali (`keep_settings_above` in `island.rs`, `docs/architettura.md`).
  - **Automazioni** («non solo orario e programmi»): nuovi «quando» (download, chiamata 3CX, agente, server di sviluppo, programma in primo piano, rientro dalla pausa) con filtro; più condizioni con «se non»; ripetizioni; i dati dell'evento nei passi con i vincoli di sicurezza; passo «Chiedi alla chat». Anche lo strumento `create_automation` (`docs/integrazioni.md`). Fatti i punti 1–3 di `docs/idee.md`, tranne calendario e fine giornata.
- **Prove:** test Rust, editor nell'anteprima, `npm run smoke`. Da provare dal vivo (`docs/prove-dal-vivo.md`).

### 15 ottobre 2026 — Remote Desktop Manager, predisposizione
- Su richiesta di Edoardo («tutto a portata di mano», origine dati ancora da decidere, forse condivisa con i colleghi): integrazione «Remote Desktop Manager» (`rdm.rs`, `src/views/rdm.ts`, `docs/integrazioni.md`).
  - **Elenco:** letto dal modulo Devolutions.PowerShell per qualsiasi origine dati, senza password.
  - **Apertura:** con l'exe o con `rdm://`.
  - **Dove compare:** card con Fissate e Recenti, barra in alto, chiamata 3CX, ticket Zammad (con il cliente nel titolo), «Cerca in RDM» e «Connetti con RDP/SSH» dal testo selezionato.
  - **Impostazioni:** stato e origine dati.
- **Prove:** RDM non è su questo PC, quindi solo test, anteprima (`rdm`) e la verifica che senza RDM e senza PowerShell 7 lo dica senza bloccarsi. Da provare la settimana prossima (`docs/prove-dal-vivo.md`).

### 15 ottobre 2026 — Notion più semplice e con avvisi; Impostazioni → Integrazioni rifatta
- **Notion:**
  - avvisi nell'isola prima delle attività con orario e per i commenti nuovi (l'API non dà le notifiche di Notion);
  - le attività di oggi nel riepilogo del mattino;
  - «+ Attività» con la scadenza e i valori della vista in uso, «Rimanda a domani»;
  - «Nota / Attività in Notion» dal testo selezionato;
  - la configurazione rapida, che propone i database e crea le viste Oggi, Settimana e Tutte.
- **Integrazioni:** rifatta a gruppi, una riga per integrazione con il suo stato, che si apre al clic; ricerca e «Solo attive» (`docs/integrazioni.md`).
- **Prove:** con i test, nell'anteprima, e in sola lettura sul Notion vero (la configurazione rapida propone «✅ Attività» e «📝 Note»). Non provati gli avvisi veri.

### 15 ottobre 2026 — Notion: viste delle attività
- Su richiesta di Edoardo (troppe attività che non gli servono ogni giorno), le «viste» in Impostazioni → Notion: filtri con un nome per periodo (oggi, settimana, mese, prossimi N giorni, con o senza quelle senza data), per i valori di select, multi-select, stato e relazioni (Contesto, Tipo, Priorità, Progetto, Area…) e con l'ordine per scadenza o priorità. Nella card si cambiano con dei pulsanti, e c'è il pallino della priorità (`notion.rs` `view_filter`, `docs/integrazioni.md`). Provato in sola lettura sul suo database, con i test, nell'anteprima (`notion&views`) e con l'editor delle Impostazioni.

### 15 ottobre 2026 — Modalità terminale della chat, versione 0.8.3
- Versione **0.8.3** con queste voci e il Notion del 14 ottobre. Su richiesta di Edoardo («più autonoma, come da terminale»), Impostazioni → Chat → «Modalità terminale» con la cartella di lavoro. Claude Code ha tutti i suoi strumenti, i server MCP, i plugin e le skill, e ogni permesso arriva sulla card con «Sempre». I passi si vedono mentre lavora. opencode lavora nella cartella con «Sempre» per qualsiasi comando. Gli altri motori passano da opencode, con la chiave solo nell'ambiente del server (`docs/chat.md`, `docs/decisioni.md`). Il server di opencode riparte quando cambia la sua configurazione: è il caso di Notion che la chat non vedeva. Poi ⚡ «Automatica» nella testata della chat, per una conversazione: Claude Code nel modo `auto`, opencode con il filtro `delicate()`, e ciò che è delicato resta sulla card (scena `chat&terminal&auto`). Il collaudo ha trovato un nome mancante nelle chiamate 3CX (`initials`): corretto. Provato con i test e le Impostazioni nell'anteprima; il turno vero va provato (`docs/prove-dal-vivo.md`).
