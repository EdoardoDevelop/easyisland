# Handoff — EasyIsland

_16 novembre 2026. **1.0.51** in `main` (tag `v1.0.51`). Si lavora su `claude/sviluppo`; `claude/modello-integrato` da riprendere per l'LLM interno. Repo pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale; il funzionamento sta in `docs/` (indice in `CLAUDE.md`).

## Da fare
- [ ] **Ricerca nelle Impostazioni** (19/11, `docs/architettura.md` → Impostazioni): provata nell'anteprima (italiano e inglese, Telegram aperto e illuminato, risultati nel campo dell'isola); da provare nell'app che l'indice si costruisca all'avvio a finestra nascosta e che il clic dall'isola apra le Impostazioni sul controllo.
- [ ] **Panoramica della memoria** (17/11, `docs/chat.md` → Finestra Memoria): provata nell'anteprima (scuro, chiaro, `few`, `many=300`, 900 px); da guardare nell'app con la memoria vera, CPU a finestra aperta e ferma, righe dal vivo quando la chat legge o scrive.
- [ ] **Avvisi in una finestra loro** (17/11, `docs/architettura.md` → Avvisi): provati nell'anteprima (scena `avvisi`) e con i test di `spot`; da provare nell'app che la finestra non prenda il fuoco né resti bianca, i tre posti con l'isola aperta e chiusa, un download mentre una card di Claude Code aspetta, «+N», schermo intero e davanti al cliente.
- [ ] **Modello sul PC** (15/11, nella 1.0.49): `docs/chat.md` → Motori → Modello sul PC. Provato dal vivo con `chiedi`: RTX 3070 (Qwen 3.5 4B, 55 token/s scritti, 1.500 letti) e Radeon 840M del portatile (Gemma 4 E2B 21/180, consigliato lì; 4B 8/150). Ora in Modalità terminale usa il giro interno (`local_agent.rs`, senza opencode): dal vivo 3.989 token alla prima domanda sulla 840M (38 s), ~2.100 sulla 3070 (`git status` senza card in 6 s); obiettivo 2.500 da limare (note della memoria davanti). Limiti rispetto a opencode in `docs/idee.md`, lasciati così (Edoardo, 15/11). Dal 15/11 anche OpenRouter, Ollama e LM Studio usano il terminale interno (`local_agent::ENGINES`): OpenRouter provato dal vivo (5,6 s e 1,8 s, `git status` senza card); Ollama e LM Studio non provati (nessun modello impostato). Da provare nell'isola: Impostazioni → card, «Scarica» del consigliato, «Prova la velocità», risposte dalla memoria scritte dal modello, Modalità terminale (tempo e token sotto 2.500 nel `server.log`, `git status` senza card, `write_file`/`npm install` con card, Ferma su comando lungo, «⟲ File»).
- [ ] **Voti e Solo EasyIsland** (15/11, ramo `claude/voti-solo-easyisland`, da `claude/sviluppo` che ha già `claude/risposte-memoria`): `docs/chat.md` → Voti, Solo EasyIsland. Provati con test, anteprima e `chiedi --motore easyisland` sul portatile (risposte, righe vicine, domanda ripetuta); da provare nell'isola i voti veri (👍 a un motore che insegna una riga, 👎 poi «Chiedi al motore») e «Riprova» in Impostazioni → Chat. Unito in `claude/sviluppo`. Poi (stesso ramo) i suggerimenti 📒 dalla memoria (`memory_tips.rs`): da guardare nell'isola con una pagina o un file di un cliente davanti e dopo una domanda.
- [ ] **Risposte dalla memoria e `chiedi`** (15/11, in `claude/sviluppo`): da guardare nell'isola «📒 Dalla memoria» e «Chiedi al motore»; con l'uso, i 👎 dicono dove la regola delle parole in `memory_answer.rs` sbaglia.
- [ ] **Ricerca per significato sul PC** (14/11, in `claude/sviluppo`): da provare nell'app «Scarica», poi domande con parole diverse dalle note: «🧠 N per significato» sotto la risposta e le righe «significato (…)» nel log dicono cosa ha trovato e con che punteggio; soglie 0,30/0,10 da rivedere sulla memoria vera. Dopo: lo stesso confronto per le ricette (`docs/idee.md`).
- [ ] **Comandi e ricette con date** (14/11, nella 1.0.47): da provare nell'app «apri <azione rapida>», «pausa», «ricordami di …» con Esegui; «spese di settembre», «di ottobre», poi «di novembre» in diretta; `cache_read_input_tokens` con il motore API.
- [ ] **Smistatore** (14/11, nella 1.0.47): `docs/chat.md` → Smistatore. Da provare nell'app: una domanda ripetuta (stato del PC, azioni rapide) che dopo due turni uguali risponde da sola, «Chiedi al motore», i numeri in Impostazioni → Chat. Tappa 3 in `docs/idee.md`.
- [ ] **VLAN ID in Modifica rete…** (13/11, ramo `claude/domande`): `docs/integrazioni.md` → Rete. Da provare l'applicazione vera da amministratore su una scheda con VLAN (e il ritorno a 0).
- [ ] **Domande con le scelte nella chat** (13/11, ramo `claude/domande`): `docs/chat.md` → Domande e piano. Provate con un processo vero di Claude Code (driver) e nell'anteprima; da provare nell'app: domanda dall'isola, «Altro…», «Non ora», Ferma con la card aperta, Piano con «Procedi», un permesso normale non risposto (deve restare negato).
- [ ] **Browser e portali dei fornitori** (12/11, in `main` dalla 1.0.45): `docs/chat.md` → Anteprima e Portali dei fornitori. Provati solo con test e con gli script sulle pagine vere (estrazione, blocco del carrello, modulo di accesso); da provare nell'app (`docs/prove-dal-vivo.md`). Seguiti in `docs/idee.md`.
- [ ] **Importa abilità** (1.0.43, `docs/chat.md` → Abilità → Importa): provato su The Agency vera con `live_scan` e nell'anteprima; da provare nell'app con «Da Claude Code», una cartella vera e «Adatta con un motore» con i vari motori (risposta nel formato giusto, durata). Seguiti in `docs/idee.md`.
- [ ] **Terminale vero nella chat** (9/11): fatto con ConPTY e xterm.js (`docs/chat.md` → Terminale); da provare dal vivo (editor, Ctrl+C, finestra staccata). Restano più schede e scelta della shell (`docs/idee.md`).
- [ ] **Riduci animazioni** (`docs/architettura.md` → Accessibilità): personaggi, apertura dell'isola, Ezzy, luccichio e transizioni CSS non lo rispettano ancora; scelto di rimandarlo il 9/11.
- [ ] **Notizie** (`docs/chat.md` → Notizie, piano in `docs/idee.md`): fatte (1.0.14–1.0.15) argomenti anche scelti da un motore (mai persone né il nome dell'utente), Google/Bing News, vista elenco/miniature/schede, «Di più»/«Non mi interessa», Panoramica, Buongiorno, Telegram, barra, scheda fissa. Da provare dal vivo; mancano riassunti del motore e argomenti cambiati dalla chat.
- [ ] **Allegati della chat** (1.0.15, `docs/chat.md` → Allegati): più file, cartelle, 📎. Da provare con i vari motori.
- [ ] **Personaggio e isola in due finestre** (`docs/due-webview.md`, `docs/architettura.md`): da provare ai lati e su un secondo schermo (in basso e file rilasciati provati il 29/10).
- [ ] **Barra fissa** (`docs/architettura.md` → Barra fissa): provata in alto; da provare in basso, secondo monitor, menu «…».
- [ ] **Widget della barra** (1.0.13+, `barsys.rs`, card in `src/views/barcard.ts`): da provare dal vivo, soprattutto «Nascondi da sola», sfocatura, winget. Mancano Wi-Fi, Bluetooth, temperature (`docs/idee.md`).
- [ ] **Aspetto a schede con le immagini** (`docs/architettura.md` → Impostazioni): modalità chiara non guardata.
- [ ] **Integrazioni personali** (`docs/integrazioni.md`): da provare con l'app vera. Le 7 voci URGENTI del 7/11 sono nella 1.0.33; PDF, nome del file e riga di «Salvate» provati dal pulsante con «DDT Easytech». Provare dal vivo pulsante script, `quick_action_*`, «In esecuzione» e i motori di Agent Chat nella cartella del progetto, con turni veri, «DDT Easytech» è sul modello HTML con PDF diretto, provato dal pulsante il 7/11.
- [ ] **Guida sul sito** IT/EN (`docs/guida/`, `docs/guida/en/` → `site/guida/`, `site/en/guide/`; homepage EN `site/en/index.html`, schermate EN `site/media/en/`): allineare a ogni funzione nuova (`node scripts/guida.mjs`). Link delle Impostazioni nella lingua dell'app: prossima versione.
- [ ] **Documenti Word e PDF nella chat** (7/11, `docs/chat.md` → Documenti Word e PDF): fatti leggere `.docx` e PDF, creare `.docx` vuoti o dai modelli con preventivi calcolati e immagini, PDF con Word, unire e dividere PDF. Lettura e modelli provati dalla chat il 8/11; immagini, unione e divisione provati con Word e PDF veri, non ancora dalla chat. Il resto in `docs/idee.md`.
- [ ] **Agente personale** (priorità alta, 23/10): fatti Compiti, motori aiutanti, Battito, Abilità, permessi per livelli (1.0.16: «Sempre» sulle reversibili, permessi per compito, «Cosa ho fatto» con Annulla; `docs/chat.md`). Da provare dal vivo. Prossimi: proattività su ticket e chiamate, memoria per cliente (`docs/idee.md`).
- [ ] **Prove dal vivo** delle versioni 0.6.3–0.9.7: elenco in `docs/prove-dal-vivo.md`.
- [ ] **La giornata di oggi e domani** (priorità alta): fatti `/oggi` e `/domani` (Telegram, chat), voce nel campo in alto e azione rapida, riassunto IA in Buongiorno/Fine giornata con motore a scelta, invio Telegram all'ora scelta (orari in `giornata.rs`). Da provare dal vivo.
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Notion, seconda parte:** «Manda a Notion», scheda cliente su 3CX/Zammad, scadenze (`docs/idee.md`).
- [ ] **Account Microsoft (Graph):** predisposto; da provare registrando l'app in Entra, poi avvisi mail, chat, automazioni (`docs/integrazioni.md`).
- [ ] **Secondo cervello**, **chat nuova e memoria**: da provare con memoria e motori veri (`docs/chat.md`, `docs/prove-dal-vivo.md`).
- [ ] **Remote Desktop Manager:** predisposto; prova sul PC con RDM, poi passi in `docs/idee.md`.
- [ ] **Clic destro in Esplora file** («Manda a EasyIsland», azioni sui file; deciso l'11/10, `docs/idee.md`).
- [ ] **opencode:** card per `question` anche nella chat, controllo di Ollama/LM Studio nel menu (`docs/idee.md`).
- [ ] **Agent Chat** (1.0.18–1.0.21): server sulla VPS, token `casa` collegato. Server pubblicato sulla VPS (uguale a `main` del repo `agentchat`, controllato il 6/11): provare stati e scrittura dall'isola con i due PC. Da provare: risposte dei motori, capo che affida un lavoro, ascolto spento dall'isola, un «ciao» con due PC accesi (risponde uno solo), `@nome`, nome già preso. Memoria condivisa (lavoro «Condividi la memoria» Sì; casa «Memoria di un altro PC» = lavoro): ricerca da casa con lavoro acceso e spento; nota di lavoro da casa a lavoro spento, poi riaccenderlo.
- [ ] **Spunti dall'app originale:** Amp/Hermes, limiti di Codex, riepilogo come immagine, GitHub (`docs/idee.md`).
- [ ] **Modalità chiara:** funziona, poco usata: provare schede dell'isola e Impostazioni con l'app vera, correggere in `src/style-light.css` / `settings-light.css` (i colori in linea nel TS non cambiano).
- [ ] **Flussi** (`docs/flussi.md`): da provare con flussi veri, soprattutto agente con campi, scelta del modello, ripresa dopo riavvio.
- [ ] **Isola fissa, barra riservata** con tre aree scelte dall'utente, personaggio non trascinabile: decisa; primo passo una prova della barra di Windows (`docs/idee.md`).
- [ ] **Recapiti tra due EasyIsland** senza VPN né cloud: da valutare (`docs/idee.md`).
- [ ] **Pulizia strutturale** (27/10):
  - immagini della guida rotte su GitHub (`../media/` da `docs/guida/` punta a `docs/media`): percorso vero verso `site/media/`, corretto da `guida.mjs`; niente symlink;
  - `island.rs` `on_foreground_change` crea un thread a ogni cambio di finestra: basta un contatore che faccia uscire i vecchi;
  - test front end con `node --test`, prima `expr.ts`, `markdown.ts`, `calc.ts`;
  - 170 testi inglesi «inutilizzati» di `check:i18n`: alcuni sono composti al momento, guardarli uno per uno.
- [ ] **Inglese lingua principale nell'app** (27/10): oggi chiavi in italiano e avvio in italiano. Da decidere: solo lingua predefinita delle nuove installazioni o anche chiavi in inglese.
- [ ] **Da decidere con Edoardo:** firma del codice, tag `windows-latest`, nota a mano con freccia (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro; torna davanti al cambio di finestra. Verificare con Start aperto.
- **Limiti del piano da Anthropic:** `/api/oauth/usage` non è documentato; se smette, il log scrive «limiti del piano da Anthropic: HTTP …» e restano i numeri della status line.
- **Rinnovo dell'accesso di Claude Code** (`renew.rs`): parte invisibile, apre `/usage`, si chiude senza processi; il rinnovo di un accesso scaduto va visto alla prossima scadenza. Dopo, Claude Code può usare una volta il renderer classico.
- **Test instabile** `cc_memory::tests::project_folders_read_as_paths` (10/11): una volta su due nella suite completa fallisce, da solo passa; probabile gara con un altro test sulla lingua o sulle variabili d'ambiente. Da rendere indipendente.
- **Chiave salvata in opencode vince su quella di EasyIsland** (2/11): in Modalità terminale OpenRouter, OpenAI, Gemini e API Anthropic passano da opencode (`opencode::via`, chiave in `OPENROUTER_API_KEY` ecc.), che preferisce la sua (`opencode auth list`). Sintomo: «User not found» solo in `~/.local/share/opencode/log/opencode.log`. Risolto a mano con `opencode auth logout openrouter`. Da fare: far vincere sempre la chiave di EasyIsland (`providers.openrouter.settings.apiKey` in `OPENCODE_CONFIG_CONTENT` non ha funzionato) o dirlo nell'errore.

## Registro
Max 5 voci, la più recente in alto; le vecchie in `docs/archivio/registro.md`.

### 19/11 — Ricerca nelle Impostazioni
Campo in cima al menu delle Impostazioni (anche Ctrl+F) e gruppo «Impostazioni» nel campo unico dell'isola: un risultato apre pagina, scheda o integrazione e illumina il controllo (`src/settings/search.ts`, `src/core/settings-index.ts`).
- L'indice si legge dai controlli veri (pagine disegnate fuori schermo), una volta per versione e lingua, e passa all'isola dal `localStorage` condiviso; niente Rust.

### 18/11 — Panoramica: ricerca e linee vere
La ricerca in alto non arrivava alla Panoramica (`applySearch` parlava solo alle viste su canvas): ora accende le particelle trovate, filtra feed e gettoni, conta i risultati; Invio apre il risultato migliore nel Grafo. Le linee da «Ultimi arrivi» vanno alla particella vera di ogni riga (diario → giorno di chat), seguono lo scorrimento e si accendono al passaggio del mouse, in tutti e due i versi.

### 17/11 sera — Panoramica della Mappa della memoria
La finestra Memoria si apre su un cruscotto con i dati veri (`src/memory/dashboard.ts`, `dashboard.css`): numeri, ultimi arrivi, nucleo di particelle con gli archi dei gruppi, filtri, tappe con Leggi/Collega/Controlla, pagine più collegate, registro dal vivo, tre periodi.
- Ogni clic porta al Grafo (o alle Bolle) su quella cosa, «← Panoramica» torna; le 14 viste restano. Niente Rust nuovo.
- Nucleo a 30 fps al massimo, solo a finestra visibile e a fuoco, fermo 20 s dopo l'ultimo mouse. `?few` e `?many=300` nell'anteprima; `docs/chat.md`, guida 12.

### 17/11 sera — Avvisi in una finestra loro
Messaggi, aggiornamenti, momenti (download, Vassoio, errore copiato…), fine ed errori degli agenti, riepilogo e giornata vanno in toast in una finestra che non prende il fuoco e non apre né cambia l'isola (`src/notices/notices.ts`, `notices_window.rs`).
- Permessi, domande, card di Claude Code con le scelte e chiamate 3CX restano all'isola. Durata 8/15 s, errori finché chiusi, mouse sopra = pausa, massimo 3 + «+N».
- Impostazioni → Notifiche → Avvisi: sotto l'isola (di serie), alto o basso a destra, nell'isola come prima. Scena `avvisi` (anche nello smoke), `docs/architettura.md`, guida 06.

