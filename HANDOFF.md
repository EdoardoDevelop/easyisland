# Handoff — EasyIsland

_Aggiornato al 30 ottobre 2026. Versione **1.0.15** in `main` con il tag `v1.0.15` (allegati della chat e Notizie in una scheda): due finestre (personaggio e isola), **barra fissa** (`docs/architettura.md` → Barra fissa, che dal 1.0.12 si rimette a posto dopo un cambio di schermo) e pagina Aspetto a schede con le immagini. Si lavora su `claude/sviluppo` (le Notizie, fatte su `claude/notizie`, sono unite). In attesa `claude/modello-integrato`; `claude/barra-fissa` è il primo tentativo, solo archivio. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Notizie** (`docs/chat.md` → Notizie, piano in `docs/idee.md`): nella 1.0.14 argomenti, Google News, vista, «Di più» / «Non mi interessa», Panoramica, Buongiorno, Telegram e barra; nella 1.0.15 scheda fissa disattivabile, argomenti scelti da soli da un motore (mai persone né il nome dell'utente) con interruttore per argomento, fonte a scelta Google o Bing News, aspetto elenco / miniature / schede con lo scorrimento. Da provare dal vivo; restano i riassunti del motore e la chat che cambia gli argomenti.
- [ ] **Allegati della chat** (nella 1.0.15, `docs/chat.md` → Allegati): nel campo, più d'uno, cartelle intere, 📎. Da provare dal vivo con i vari motori.
- [ ] **Personaggio e isola in due finestre** (unite in `claude/sviluppo`; misure in `docs/due-webview.md`, come funziona in `docs/architettura.md`): da provare ai lati e su un secondo schermo (in basso e i file rilasciati sul personaggio funzionano, provati da Edoardo il 29 ottobre 2026).
- [ ] **Barra fissa** (unita in `claude/sviluppo`, `docs/architettura.md` → Barra fissa): fatta e provata in alto. Da provare in basso, sul secondo monitor e con il menu «…».
- [ ] **Widget della barra** (unita in `claude/sviluppo`, nella 1.0.13, `docs/architettura.md` → Barra fissa → Widget della barra): catalogo «+ Aggiungi», «Opzioni» per elemento, orologio, volume, microfono, luminosità, batteria, rete e menu di spegnimento (`barsys.rs`). Card nell'isola per orologio, volume, microfono, luminosità, batteria e rete (`src/views/barcard.ts`). Da provare dal vivo; poi gli altri elementi (`docs/idee.md`).
- [ ] **Aspetto a schede con le immagini** (unita in `claude/sviluppo`, `docs/architettura.md` → Impostazioni): sei schede, una miniatura disegnata accanto a ogni voce. Modalità chiara non ancora guardata.
- [ ] **Integrazioni personali:** fatte nel codice e nell'anteprima (`docs/integrazioni.md`); da provare con l'app vera (`docs/prove-dal-vivo.md`).
- [ ] **Guida sul sito**, italiano e inglese (`docs/guida/`, `docs/guida/en/` → `site/guida/`, `site/en/guide/`; homepage inglese `site/en/index.html`, schermate inglesi in `site/media/en/`): da tenere allineate a ogni funzione nuova (`node scripts/guida.mjs`). Il link delle Impostazioni nella lingua dell'app arriva con la prossima versione.
- [ ] **EasyIsland agente personale** (dopo la 1.0.0) (priorità alta, chiesto da Edoardo il 23 ottobre 2026): fatti i **Compiti** con motore per compito, motori aiutanti e **Battito**, e le **Abilità** (`docs/chat.md`; da provare dal vivo domande e permessi, `docs/prove-dal-vivo.md`). Prossimi: proattività su ticket e chiamate, permessi per livelli, memoria per cliente. Piano in `docs/idee.md`.
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete; della 0.6.7 «Continua», «Chiedi», «Sempre» di sessione e 📌 come finestra; della 0.6.8 menu con `Win+Alt+A`, «Sostituisci» e reazioni del personaggio; della 0.6.9 e 0.7.0 i nuovi personaggi e la Fiamma animata; della 0.7.1 team e chat di 3CX e il cielo grande; della 0.7.2 il personaggio della chat lasciato su una finestra; della 0.7.3 il piano letto da Anthropic, il tempo rimasto sui permessi e gli appunti rimessi per intero; della 0.7.4 l'isola che non si chiude trascinando il personaggio della chat; della 0.7.5 «Questo PC» di 3CX con audio e suoneria e l'avvio dopo un aggiornamento su un altro PC; della 0.7.7 «Riquadra e chiedi» e il personaggio durante una chiamata 3CX; della 0.7.8 il nuovo impianto, le risposte rapide, la card del Meteo e il personaggio che torna al suo colore; della 0.7.9 le proposte al momento giusto, il riepilogo del giorno e gli strumenti in Claude Code; della 0.8.0 il rinnovo dell'accesso di Claude Code, il ping e le impostazioni di rete, la Rubrica di 3CX; della 0.8.2 «Sostituisci» con la formattazione in Word, Outlook e Gmail; della 0.8.3 la «Modalità terminale» e ⚡ «Automatica» della chat, Notion con l'account vero; della 0.8.4 le automazioni con contesto e le Impostazioni sopra l'isola; della 0.8.5 la barra dell'app in uso e il menu contestuale; della 0.8.6 le azioni Tasti, Teams e l'account Microsoft; della 0.8.7 Registra e ⚡ «Automatica» con i connettori di opencode; della 0.8.8 Telegram, la cartella di lavoro e gli strumenti di EasyIsland con opencode; della 0.8.9 «Automatica» in Telegram, impostazioni dagli agenti, «Permessi e chiamate», il mini Notion e i vocali da Telegram; della 0.9.0 Antigravity come agente e come motore; della 0.9.1 Remote Desktop Manager con l'Hub (vault utente, elenco offline, Sincronizza); della 0.9.2 Ferma nella chat e su Telegram e la mappa di Notion per la chat; della 0.9.3 gli strumenti di Notion, Antigravity e Claude API con gli strumenti di EasyIsland, la Seconda opinione, /oggi e /domani; della 0.9.4 velocità e ricette della chat; della 0.9.5 Microsoft To Do (sul PC con Outlook) e gli hook senza Git Bash; della 0.9.6 Accesso remoto ed eliminazione di righe di Notion dalla chat; della 0.9.7 la chat nuova, la memoria e la RAM di WebView2. Tutte in `docs/prove-dal-vivo.md`.
- [ ] **La giornata di oggi e domani** (priorità alta): riassunto delle integrazioni fatto dall'IA, da solo agli orari scelti e a richiesta da chat, ricerca, Telegram e azioni rapide. Fatti `/oggi` e `/domani` su Telegram; il resto in `docs/idee.md`.
- [ ] **3CX team e chat:** fatti nel codice, da provare sul centralino vero (`docs/prove-dal-vivo.md`). Se qualcosa non arriva, il log dice quali tipi di messaggio manda il centralino (`3cx: event type …`).
- [ ] **3CX «Questo PC»:** telefono WebRTC nell'isola, suoneria e scheda da telefono fatti nel codice e nell'anteprima; audio vero da provare sul centralino (`docs/prove-dal-vivo.md`).
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Notion, seconda parte:** «Manda a Notion», scheda cliente su 3CX/Zammad, avviso delle scadenze (`docs/idee.md`).
- [ ] **Account Microsoft (API):** predisposto (accesso, Outlook e Teams con Graph); da provare registrando l'app in Entra (`docs/prove-dal-vivo.md`), poi avvisi di mail nuove, chat, automazioni (`docs/integrazioni.md`).
- [ ] **Secondo cervello:** pagine collegate, da-leggere, controllo e finestra Memoria fatti nel codice e nell'anteprima (`docs/chat.md`); da provare con la memoria vera (`docs/prove-dal-vivo.md`).
- [ ] **Chat nuova e memoria:** fatte nel codice; da provare con i motori veri e da guardare dopo qualche giorno d'uso (`docs/prove-dal-vivo.md`).
- [ ] **Accesso remoto:** fatto nel codice; collegamento vero con WinRM e SSH (Windows e Linux) da provare su un PC di un cliente (`docs/prove-dal-vivo.md`).
- [ ] **Remote Desktop Manager:** predisposto; prova la settimana prossima sul PC con RDM (`docs/prove-dal-vivo.md`), poi i passi in `docs/idee.md`.
- [ ] **Clic destro in Esplora file:** voci di EasyIsland sui file («Manda a EasyIsland», azioni sui file), deciso con Edoardo l'11 ottobre come passo successivo al menu sulla selezione (`docs/idee.md`).
- [ ] **opencode:** card per lo strumento `question` anche nella chat (per l'agente c'è), controllo di Ollama/LM Studio nel menu (`docs/idee.md`).
- [ ] **Spunti dall'app originale:** Amp/Hermes, limiti di Codex, riepilogo condivisibile come immagine, GitHub (`docs/idee.md`).
- [ ] **Prova dal vivo dei nuovi personaggi** (`docs/prove-dal-vivo.md`).
- [ ] **Modalità chiara:** guardare tutte le schede dell'isola e le pagine delle Impostazioni in chiaro con l'app vera e correggere in `src/style-light.css` / `settings-light.css` ciò che il plugin sbaglia (colori in linea nel codice TypeScript non cambiano).
- [ ] **Flussi:** fatti nel codice (finestra Flussi, agenti, scelte, per ogni, domande su Telegram, tentativi, esecuzioni; piano e scelte in `docs/flussi.md`); da provare con flussi veri, soprattutto un agente con i campi, la scelta del modello e la ripresa dopo un riavvio.
- [ ] **Isola fissa: barra riservata** in alto o in basso, con tre aree (inizio, centro, fine) per personaggio, integrazioni, azioni, widget e striscia, tutto scelto dall'utente, personaggio non più trascinabile: decisioni prese con Edoardo, primo passo una prova della barra di Windows (`docs/idee.md`).
- [ ] **Modello integrato** (accantonato il 27 ottobre 2026): fatto nel branch `claude/modello-integrato`, non unito, manca la prova dal vivo (`docs/idee.md`).
- [ ] **Recapiti tra due EasyIsland** (casa ↔ notebook, memorie separate, senza VPN né cloud): da valutare (`docs/idee.md`).
- [ ] **Pulizia strutturale** (dal controllo del 27 ottobre 2026):
  - immagini della guida rotte su GitHub (`../media/` da `docs/guida/` cerca `docs/media`): percorso vero verso `site/media/`, corretto da `guida.mjs` per il sito; niente collegamenti simbolici;
  - `island.rs` `on_foreground_change`: un thread nuovo a ogni cambio di finestra (isola ritirata sopra la barra); un contatore che fa uscire i thread vecchi basta;
  - test del front end con `node --test` (zero dipendenze), per primi `expr.ts`, `markdown.ts`, `calc.ts`;
  - i 170 testi inglesi «inutilizzati» di `check:i18n`: guardarli uno per uno, alcuni sono composti al momento.
- [ ] **Inglese lingua principale anche nell'app** (chiesto da Edoardo il 27 ottobre 2026; README e homepage lo sono dalla 1.0.9): oggi i testi nascono in italiano (`t("testo italiano")`, chiave = italiano, inglese in `src/i18n/en.json`) e l'interfaccia parte in italiano. Da decidere come: solo la lingua predefinita di una nuova installazione, oppure anche le chiavi in inglese.
- [ ] **Da decidere con Edoardo:** firma del codice, tag `windows-latest` (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Occhi troppo grandi** nello stato felice per alcuni personaggi (segnalato il 14 ottobre 2026, quali personaggi è da capire).
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro. Torna davanti a ogni cambio di finestra in primo piano. Va verificato con Start aperto.
- **Limiti del piano da Anthropic:** l'indirizzo (`/api/oauth/usage`) non è documentato e può cambiare; se smette di rispondere il log scrive «limiti del piano da Anthropic: HTTP …» e restano i numeri della status line.
- **Rinnovo dell'accesso di Claude Code** (`renew.rs`): provato qui che Claude Code parte invisibile, apre `/usage` e si chiude senza lasciare processi; il rinnovo vero di un accesso scaduto va visto alla prossima scadenza (`docs/prove-dal-vivo.md`). Chiudendolo, Claude Code al lancio dopo può dire che il suo renderer a schermo intero «non ha finito di partire» e usare quello classico una volta.

## Registro
Al massimo 5 voci, la più recente in alto. Le più vecchie vanno in `docs/archivio/registro.md`.

### 30 ottobre 2026 — Versione 1.0.15: allegati nel campo, cartelle; Notizie in una scheda, argomenti da soli, miniature
- Chat: gli allegati stanno nel campo sopra il testo, sono più d'uno (fino a 20) e possono essere cartelle (percorso ed elenco dei file al motore); 📎, `@file`, `@cartella`, Ctrl+V e rilascio li aggiungono tutti (`ChatContext::Files`).
- Notizie: voce sempre nel menu (spegnibile), argomenti scelti una volta al giorno da un motore e seguiti da soli, interruttore per argomento; fonte Google o Bing News (Bing con foto e riassunto), aspetto elenco / miniature / schede, la lista scorre.

### 30 ottobre 2026 — Versione 1.0.14: Notizie
- Notizie, passo 3 e parte del 4: «Di più» (più notizie per argomento e subito la stessa storia) e «Non mi interessa» (a −3 propone di smettere di seguirlo), riquadro nella Panoramica, notizie nel Buongiorno, `/notizie` su Telegram, elemento «Notizie» nei Widget della barra. `claude/notizie` e `claude/sviluppo` unite in `main` con il tag `v1.0.14`.
- Guida: nuova pagina Notizie e capitoli rinumerati da 1 a 30 senza doppioni, così il pulsante della lingua porta alla pagina giusta (gli indirizzi non cambiano).

### 30 ottobre 2026 — «L'isola si apre» anche con la barra fissa
- La scelta era nascosta e ignorata con la barra accesa; ora vale anche lì (`openAway` in `island.ts`; Rust la gestiva già in `place_origin`).

### 30 ottobre 2026 — Notizie, passo 2 (su `claude/notizie`)
- Google News (scelto da Edoardo) per ogni argomento seguito, ogni 4 ore o quando cambiano gli argomenti; filtro in locale (parole da evitare, 3 giorni, già viste, stessa storia); voce e vista «Notizie» nell'isola. Una ricerca vera provata con un test; l'app non ancora provata dal vivo.

### 30 ottobre 2026 — Notizie, passo 1 (su `claude/notizie`)
- `news.rs` propone gli argomenti dalle pagine della memoria (citazioni, note, diario del mese, aggiornamenti recenti), mai persone e clienti; pagina Impostazioni → Notizie con Aggiungi / Escludi / Riammetti e le parole da cercare ed evitare. Niente rete ancora. Smoke «nessun errore».
