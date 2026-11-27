# Idee e progetti non ancora fatti

Dettagli di ciò che `HANDOFF.md` riassume in una riga; per ogni voce solo ciò che resta. Idee più vecchie e analisi di 3CX: `archivio/HANDOFF-fino-al-6-ottobre.md`, sezione 7.

## Isola costruita da un JSON (23/11/2026, Edoardo)
Obiettivo: **layout e contenuto** dell'isola da una sorgente JSON (`isola.json`), cambiati dalla chat. Il funzionamento dei pezzi esistenti (chat, terminale, Anteprima, schede di Claude Code, card, viste) non si tocca: il JSON decide cosa c'è, dove e in che ordine. Esempi di Edoardo: «aggiungi in basso a sinistra dell'isola un pulsante per spegnere il PC»; «crea una scheda con tutte le applicazioni di Windows installate».
- **Layout:** zone dell'isola (barra in alto, menu e schede, corpo, angoli e piede), schede nuove e loro ordine, riquadri della Panoramica, pulsanti in una zona.
- **Contenuto a blocchi** da elenco fisso: pulsante, griglia di icone, lista, card, riga, testo, valore, grafico. Ogni blocco legge una **fonte** da elenco fisso (stato del PC, app installate, finestre aperte, azioni rapide, cartelle, integrazioni personali…) e fa un'**azione** da elenco fisso (azione rapida, apri app/file/link, apri scheda, comando di sistema: spegni, riavvia, blocca, sempre con conferma). Mai codice nel JSON; una fonte o un'azione nuova si aggiunge nell'app, poi la chat la usa.
- **Pezzi esistenti come blocchi:** il JSON ne sceglie solo posto e opzioni.
- **Dalla chat:** strumento che propone la modifica, anteprima nell'isola, Consenti/Nega, «Annulla» e storico; JSON non valido → ultima versione buona.
- Vincoli: card Consenti/Nega, password e chiavi mai modificabili dalla chat; testi tradotti; isola chiusa a CPU ~0.
- Tappe: 1) fatta il 23/11 (`architettura.md` → Isola da JSON): zone `menu-bottom` e `header`, schede con griglia di pulsanti, azioni da elenco fisso, bozza visibile durante Consenti/Nega, Annulla e storico; 2) fatta il 23/11: blocchi `grid`, `list`, `value`, `text` con fonti app installate, finestre, azioni rapide, cartella, valori del PC (restano possibili: integrazioni personali, file recenti, Notion come fonti); 3) fatta il 23/11: `menu` e `header` con ordine e parti nascoste, `island_layout` dà l'isola intera. Fatti il 23/11 anche Panoramica nel JSON e pezzi esistenti come blocchi (`piece`). Fatti il 23/11 (secondo giro): fonti recenti, Vassoio, appunti, VS Code, schede delle integrazioni personali, Notion; blocco grafico; piede con pulsanti, angolo e valori. Fatti il 24/11 (ramo `claude/isola-stile`): aspetto dell'isola (`style`: colori, sfumatura, angoli, font, testo, bordo, alone, misure minime, sfondi di menu/testata/footer, spaziatura), aspetto di pulsanti, schede, blocchi e valori del footer, condizioni `when` (ore, giorni, programma davanti, valore del PC) e soglie `levels`. Restano: barra fissa cambiata dalla chat con card (Edoardo: «vedremo»); larghezza del menu e dimensione del personaggio dal JSON (toccano le misure di `island.ts`, `RAIL_W`); temi pronti da scegliere a parole («tema caldo», «notte») come `style` salvati. Isola per profilo scartata (23/11: Edoardo non usa i profili); storico delle versioni con «Rimetti questa» escluso (24/11: non gli serve).

## Autoriparazione e automiglioramento (24/11/2026, Edoardo; «mettiamolo nelle idee per ora»)
Chiesto dal portatile («una sorta di autoriparazione o automiglioramento… a livello di codice»). Due parti diverse:
- **Mentre l'app gira:** già ci sono guardiano della barra di Windows, recupero del profilo WebView2, servizi che riprovano. Manca il **ritorno alla versione precedente**: l'exe di prima tenuto da parte a ogni aggiornamento (installer e Prova veloce); se il nuovo si chiude all'avvio 2–3 volte di fila, riparte quello e lo dice. Piccolo, il primo da fare.
- **Codice:** mai modificato dall'app sul PC dove gira (aggiornamenti firmati, rilascio con l'ok di Edoardo). Si automatizza il giro fatto a mano il 24/11:
  1. **raccolta** sul PC, locale, senza telemetria: errori degli strumenti, turni interrotti, panic, errori ripetuti nel log, segnali di fastidio («?», «fallo tu», richiesta riscritta, insulti), in un file di EasyIsland;
  2. **analisi** a casa, dove c'è il repo: compito periodico di Claude Code che legge il file (Agent Chat o WinRM), lo confronta con commit, `HANDOFF.md` e `archivio/registro.md` (il 24/11 erano stati riproposti nove problemi già risolti) e manda solo i nuovi;
  3. **correzione** su un ramo con test e anteprima solo su scelta di Edoardo; unione e installazione sempre dopo il suo ok.
- Rischio: il rumore. Prima la sola raccolta per qualche giorno, guardata insieme, poi l'analisi automatica.

## Terminale vero nella chat (9/11/2026)
Fatto il 9/11 con ConPTY e xterm.js (`docs/chat.md` → Terminale); il 22/11 più schede, shell (PowerShell, Prompt dei comandi, WSL), link cliccabili, Ctrl+F. Restano: un terminale come pannello a sé (oggi le schede stanno in un pannello solo), profili della shell scelti dall'utente.

## Il PC dal campo dell'isola, seguiti (22/11/2026)
Fatti file, finestre aperte e pagine/comandi di Windows (`architettura.md` → Campo unico). Proposti e lasciati qui da Edoardo:
- **Testo dallo schermo:** «Copia il testo» in «Riquadra e chiedi» con l'OCR di Windows (`Windows.Media.Ocr`, nessuna dipendenza); per errori, finestre, immagini non selezionabili (diverso dalle scansioni escluse per i documenti).
- **Incolla dalla cronologia degli appunti:** una scorciatoia apre la cronologia vicino al cursore, la voce scelta si incolla nell'app in uso.
- **Posta e calendario nel campo:** email e appuntamenti di Outlook classico (COM, come To Do).
- **Conversioni nel campo:** unità, date («tra 30 giorni», «quanti giorni al 15/1»), fusi orari. Le valute no (servirebbe un servizio non configurato).
- **Testi pronti e dettatura:** frasi salvate da richiamare; dettatura con whisper.cpp dentro l'app (modelli solo interni).
- **File trascinato dal campo nella chat.**
- L'**estensione per Chrome ed Edge** (sotto) porterebbe nel campo anche le schede del browser.

## Domanda a parte (22/11/2026)
Proposta il 22/11 (come la «side chat» della nuova app desktop di Claude Code), messa da parte da Edoardo. Un pannello dei pannelli della chat (`dock.ts`) per una domanda veloce sulla conversazione in corso, che la legge ma non ci scrive; un clic riporta la risposta nella conversazione.

## Editor e confronto veri nell'Anteprima (22/11/2026)
Proposto il 22/11, messo da parte da Edoardo. CodeMirror 6 (più leggero dell'editor di VS Code) per «Codice» e «Modifiche»: confronto affiancato, numeri di riga, ricerca, modifica a mano del file prima di accettare. Da valutare: peso, temi scuro/chiaro, commenti sulle righe che ci sono già (`lineComments`).

## Importare abilità da file e cartelle (11/11/2026)
Fatto l'11/11 nella 1.0.43 (`docs/chat.md` → Abilità → Importa), partendo da The Agency (`github.com/msitarzewski/agency-agents`, MIT). Restano:
- ruolo per tutta la conversazione («Parla con: …»), invece del solo `/id` per un messaggio;
- ruoli in `task_delegate` (motore + abilità) e squadre da `strategy/runbooks.json` di The Agency come modelli di Compito;
- installare gli stessi file negli agenti di codice (`~/.claude/agents/`, Codex, Gemini, opencode), solo file nuovi, con anteprima;
- adattamento di più abilità insieme (oggi una chiamata per abilità, in sequenza).

## Integrazioni personali, seguiti (11/11/2026, dal PC lavoro: DDT, «Clienti», «Registro lavori e vendite»)
Fatte l'11/11 tutte e sei (`docs/integrazioni.md` → Integrazioni personali): tendina dei `link` sovrapposta, «Anteprima» e `custom_preview` senza salvare, `custom_update` a pezzi, `templateFrom` e `integrazioni\_comune`, `new_id`, descrizione di `custom_create`. Resta: un modo per mettere un'immagine in `_comune` senza Esplora file (oggi la copia l'utente o la chat in Modalità terminale).

## Integrazioni personali, audio e script (11/11/2026, dal PC lavoro: «Messaggi vocali TTS» con OpenRouter)
Fatti l'11/11 (`docs/integrazioni.md` → File in risposta, Lettore, Script): file ricevuti da `http` salvati senza script (`folder`, `filename`, `tray`), lettore nella scheda (immagini, audio, video, PDF, testo, Word) anche per il campo `file`, chiavi negli script come `EASYISLAND_SECRET_<NOME>`, esempio di `EASYISLAND_SCHEDA` nella descrizione di `custom_create`. La TTS si può rifare con un'azione `http`. Restano:
- «Non chiedere più» per uno `script` approvato (legato all'hash): contro la regola del clic a ogni pressione, serve l'ok di Edoardo; con `http` che salva i file la TTS non ne ha più bisogno.
- Ritorno dallo script: file `EASYISLAND_RISULTATO` (JSON `{ valori, messaggio }`) che compila campi e mostra un avviso nell'isola.
- Fatto l'11/11: `select` con `optionsFrom` e tendine dipendenti (`docs/integrazioni.md` → Scelte da una fonte). Resta: lo stesso per le colonne delle tabelle.
- Campo `file` in uscita: file del Vassoio in `multipart/form-data` o base64 (clonazione voce, trascrizione).

## Integrazioni personali, impostazioni proprie (12/11/2026, chiesto da Edoardo, non urgente)
Oggi in Impostazioni → Integrazioni → Create da te ci sono solo le chiavi (`secrets`, Gestione credenziali); nessun valore non segreto per integrazione. Proposta:
- `settings` nella definizione, campi come `fields` (id, label, kind: text, number, select, checkbox, cartella, help, default), mostrati accanto alle chiavi.
- Valori come `{{setting:id}}` in url, headers, body, folder, filename, template e `default` dei campi; negli script `EASYISLAND_SETTING_<ID>` (come `EASYISLAND_SECRET_<NOME>`).
- Salvati in un file dell'integrazione (non segreti: nei backup e nelle versioni); le chiavi restano separate.
- MCP: lettura e modifica con conferma, descritti in `custom_create`.
- Usi: cartella degli audio, motore e voce predefiniti di «TTSpeak»; intestazione o firma di un documento.

## Compiti a orario, seguiti (12/11/2026, chiesto da Edoardo, non urgente)
Già oggi (`tasks.rs` → `due`): un `at:` passato parte al primo avvio; `daily`/`weekdays` saltati partono una volta se EasyIsland si apre più tardi lo stesso giorno; un giorno intero perso non si recupera (giusto: una volta sola); `weekly` solo nel suo giorno, quindi se salta si perde. «Elimina» c'è solo in Impostazioni → Flussi. Manca:
- `weekly` recuperato all'avvio nei giorni dopo (una volta, fino al giorno successivo previsto).
- «Partito in ritardo: era previsto per …» nel registro del compito, in Flussi e come avviso nell'isola.
- Per compito: «se salta l'orario: esegui appena possibile / salta» e un limite facoltativo «non oltre N ore di ritardo».
- Compiti una volta sola «Fatto»: archivio o pulizia automatica dopo N giorni, a scelta in Impostazioni.
- MCP `task_update` (titolo, obiettivo, orario di un compito non partito) e `task_cancel`; con la regola «mai eliminare» annullare = pausa/archivio, eliminare resta un clic in Flussi.

## Controllo del browser, seguiti (12/11/2026, chiesto da Edoardo)
Fatto il 12/11 sul ramo `claude/browser` (`docs/chat.md` → Anteprima e Portali dei fornitori): tasti, mouse, scorrimento, tendine, trascinamento, `preview_steps`, «Sempre» per sito, mai acquisti, `preview_find`, schermate leggere, schede dietro, corpi di rete, `preview_extract`, ricette dei portali, `preview_login` con Devolutions, foto nel Vassoio, costo + ricarico nei preventivi. Restano: caricare un file del Vassoio in un modulo, download dalla pagina nel Vassoio, JavaScript di sola lettura, sequenze registrate come azioni rapide senza motore, Compiti che controllano un portale e avvisano se cambia, catalogo dietro SSO da provare con l'accesso. Il piano di partenza qui sotto.
- **Pari a Claude Desktop:**
  - tasti (Invio, Tab, Esc, frecce, scorciatoie), passaggio del mouse, scorrimento e «porta in vista», doppio clic, clic destro, trascinamento, clic su un punto (canvas, mappe);
  - più passi in una chiamata (apri, clicca, scrivi, aspetta, leggi): meno giri, meno token;
  - consenso per sito e conversazione invece che per clic (come «Sempre» di Claude Code, 8/11): eccezione alla regola del clic, serve l'ok di Edoardo; mai per acquisti, ordini, carrello, invio di moduli con effetti reali;
  - tendine, caselle e date con un comando; cerca un elemento per testo; schermata di una zona o ridotta;
  - schede in secondo piano, scegli o chiudi da strumento; tema scuro (`setEmulatedMedia` c'è già); corpo delle risposte di rete, JavaScript solo per leggere;
  - caricare un file del Vassoio in un modulo, download nel Vassoio.
- **Per i preventivi dai fornitori:**
  - accesso ai portali con le credenziali di Devolutions inserite nei campi senza passare dal motore (conferma come `dvc_show`); sessioni che restano nel profilo dell'Anteprima;
  - `preview_extract`: dati strutturati dalla pagina (codice, descrizione, caratteristiche, prezzo netto/listino, IVA, disponibilità, foto, link) invece dell'albero intero, anche da liste di risultati. Ordine, dal meno caro: JSON-LD `Product`/`Offer`, microdata e meta `og:`; risposte JSON delle API del portale viste in rete (corpo letto nella pagina, con la sessione); ricetta del portale (selettori salvati, eseguita senza motore); testo principale o albero limitato a una zona; schermata solo per controllo visivo. Le foto si prendono dall'indirizzo, il motore non le guarda;
  - Nessun portale nel codice né nel repo: l'utente addestra EasyIsland. Prova del 12/11 su tre portali reali: i casi tipici sono scheda JSON-LD `Product` completa, ricerca che risponde in JSON con l'intestazione giusta, suggerimenti di ricerca con i prodotti nel `dataLayer` (prezzo vero solo dopo l'accesso), catalogo in un'app dietro SSO. `preview_extract` deve riconoscerli da solo, senza sapere di quale sito si tratta.
  - **Addestramento («Insegna un portale»):** l'utente fa una ricerca nell'Anteprima con la chat che guarda (o glielo spiega a parole); EasyIsland prova i metodi in ordine, mostra cosa ha trovato (tabella con codice, prezzo, foto) e l'utente corregge («il prezzo giusto è quello netto», «la disponibilità è in quel riquadro»). Salva una **ricetta** nei dati dell'utente (`%APPDATA%`, come le abilità; mai nel repo): indirizzo di ricerca con `{codice}`/`{testo}`, metodo, campi e dove si trovano, se serve l'accesso e con quale voce di Devolutions (solo il riferimento), IVA inclusa o no. Visibile e modificabile in Impostazioni, esportabile verso un altro EasyIsland. Se una ricetta smette di funzionare (sito cambiato), lo dice e propone di riaddestrarla.
  - Con le ricette, una ricerca su un portale non usa il motore: lo usa solo per scegliere i prodotti e comporre il preventivo.
  - stessa ricerca su più portali in schede parallele, tabella di confronto con fonte, data e ora del prezzo;
  - foto del prodotto scaricate nel Vassoio e messe nel documento;
  - preventivo da modello Word o da un'integrazione personale (righe con link alla fonte, ricarico, IVA), totali sempre di EasyIsland;
- **Più di Claude Desktop:** sequenze registrate che diventano azioni rapide o abilità ripetute senza motore; Compiti e Battito che controllano un portale (prezzo, disponibilità, ordine) e avvisano solo se cambia; dalla pagina a schede, Notion e memoria; dal telefono (Telegram, Agent Chat) sull'EasyIsland giusto; con ogni motore.
- **Dopo:** il browser vero dell'utente con l'estensione (sezione «Estensione per Chrome ed Edge»).

## Agente personale (dal 23/10/2026)
Obiettivo: EasyIsland agente personale programmabile, che riceve obiettivi, lavora nel tempo e si muove per primo. Vincoli: niente email, approvazioni o eliminazioni senza clic (salvo «Automatica»), comandi solo in Modalità terminale, lavoro in Rust svegliato da orari ed eventi (CPU ~0 %), nessun server in mezzo.
- Fatti: Compiti, Battito, ripetizioni, abilità salvate a fine compito, motori aiutanti, domande e permessi su Telegram, riordino serale, abilità come comandi Telegram, permessi per livelli, secondo cervello, «Parla», giornata (`docs/chat.md`).
- **Restano:**
  - costo stimato nella card del compito; più compiti insieme e sotto-agenti (da valutare: `decisioni.md` frena la squadra autonoma);
  - esecuzione a PC spento (vedi «EasyIsland collegati»);
  - un'abilità che limita davvero gli strumenti (oggi `strumenti` è un'indicazione);
  - **si muove per primo:** su ticket nuovo, fine chiamata, mail importante, scadenza Notion prepara bozze e note da confermare;
  - Annulla anche per abilità salvate e schede delle integrazioni personali;
  - memoria: cartella a scelta (per editor di note a grafo), testo dai PDF senza dipendenze;
  - secondo cervello: mail di Outlook classico (testo via COM), trascrizione della chiamata quando 3CX la registra.

## 3CX + Zammad: ticket sulla chiamata in arrivo
- Quando squilla, sotto il chiamante i suoi ticket aperti (titolo, stato, da quanto), clic apre. Numero normalizzato (`+39`, spazi, zeri) → cliente in Zammad → ticket non chiusi suoi o dell'organizzazione.
- Da verificare: `/api/v1/users/search` e `/api/v1/tickets/search` senza Elasticsearch?
- Solo con entrambe accese, tutto in memoria, niente davanti al cliente, niente azioni senza clic. Seguito: «Nuovo ticket» dalla chiamata.

## Soluzioni proposte per i ticket Zammad (30/10)
Su un ticket nuovo EasyIsland cerca una soluzione; sceglie e agisce sempre l'utente. Oggi `zammad.rs` legge solo conteggi e titoli (`ticket_overviews`).
- **Quando:** ticket nuovo assegnato o «Da assegnare» (`new_ticket_event`) o «Cerca una soluzione» a mano. È un compito con motore e limiti delle Impostazioni.
- **Legge:** ticket intero (`/api/v1/tickets/{id}`, `/api/v1/ticket_articles/by_ticket/{id}`); ticket chiusi simili o dello stesso cliente (senza Elasticsearch: ultimi chiusi filtrati in locale); knowledge base; memoria (`brain.rs`) e abilità; web (documentazione, forum, note di rilascio); strumenti di sola lettura (server, RDM).
- **Propone** nella card e con un avviso: causa probabile, passi in ordine con sicurezza, fonti, bozza di risposta e nota interna; «Utile»/«Non utile».
- **Mai senza clic:** «Aggiungi come nota interna», «Usa come risposta» (bozza mai inviata); stato, assegnatario, priorità non si toccano. Comandi sul PC del cliente solo da «Accesso remoto».
- **Impara:** a ticket chiuso propone di salvare problema e soluzione nella memoria (`memory_page_write`, con conferma).
- **Riservatezza:** motore locale, oppure togliere email, telefoni, indirizzi, nomi; ricerche web con soli termini tecnici; niente davanti al cliente.
- **Costi:** tetto di ticket al giorno e turni per ticket, salta i già proposti, filtro per code/gruppi o assegnati.
- **Ordine:** 1) ticket intero e ricerca a mano con memoria e web; 2) simili e knowledge base; 3) partenza da sola; 4) nota interna e salvataggio in memoria.

## Account Microsoft (predisposto il 16/10, `integrazioni.md` → Account Microsoft)
- **Graph:** «Accedi con Microsoft» (PKCE, indirizzo locale di ritorno, `Mail.Read`, `Calendars.Read`), account di lavoro e personali, senza Outlook aperto. Controllo ~ogni minuto (il push vuole un server pubblico). Card «mail nuova» (Apri, Chiedi alla chat, bozza mai inviata), card prima di un evento con «Partecipa» (`onlineMeeting.joinUrl`), poi «quando» per le automazioni.
- **Teams, secondo passo:** riunioni di oggi, chat non lette (`Chat.Read`), stato (`Presence.Read`/`Presence.ReadWrite`).
- **Vincoli:** refresh token in Gestione credenziali; rete solo verso Microsoft a integrazione accesa; registrazione una tantum in Entra (ID pubblico).
- **Consenso bloccato dall'IT:** serve l'ok dell'amministratore, mai aggirarlo. Ripieghi: avviso di mail nuova da Outlook classico (`outlook.rs`, solo aperto); notifiche di Windows (`UserNotificationListener`; forse serve identità di pacchetto, provare prima); link ICS nel widget Calendario (non copre la posta).
- Domande aperte: Outlook classico o nuovo; chi amministra il Microsoft 365.

## Exchange in sede (29/10)
Graph non vale in sede; si fa come i client di posta.
- **Accesso:** Autodiscover dall'indirizzo → URL EWS (`https://mail.cliente.it/EWS/Exchange.asmx`); NTLM o Negotiate/Kerberos; credenziali in Gestione credenziali (`keyring`); con PC nel dominio l'utente Windows senza login.
- **EWS** (in sede ancora supportato): posta `FindItem`/`GetItem`, calendario `FindItem` con `CalendarView`, attività dalla cartella Tasks.
- **Rust:** SOAP fisso; XML con `quick-xml` (dipendenza da valutare) o a mano. Autenticazione con **WinHTTP** dal crate `windows` (`Win32_Networking_WinHttp`, già presente, gestisce l'utente Windows) — preferito a `sspi`. Comandi `get_mail`, `get_calendar`, `get_tasks`.
- Sconsigliati ActiveSync (complicato, licenza) e IMAP (solo posta).

## Menu dell'app in uso nella barra
Fatto il 31/10 come menu del titolo della finestra (`appmenu.rs`). Restano le schede della barra multifunzione di Office e le voci dei sottomenu delle app moderne (oggi la voce apre il menu nel programma).

## Elementi della barra fissa
Fatti il 30/10 (catalogo, opzioni, `opts`, elementi di sistema, aspetto; `architettura.md` → Barra fissa). **Restano:** cambio del dispositivo d'uscita (nessuna API pubblica: la card porta alle impostazioni audio), Wi-Fi, Bluetooth, temperature, «Non disturbare» (nessuna API pubblica), consumo di Codex e Copilot. Vincoli: aggiornamento su evento (Core Audio, notifiche di Windows), CPU e rete ogni 2–5 s, orologio ai secondi solo se scelto, solo crate `windows`, nessuna animazione continua. Esclusi: più schermi, CSS personale, systray, barra sostitutiva, desktop virtuali, gestori a riquadri, visualizzatore audio, sfondi, Pomodoro, notifiche di sistema.

## Notizie
Fatti passi 1–3 e argomenti scelti da un motore (`docs/chat.md` → Notizie). **Restano:** riassunti del motore (turno con strumenti, con tetto giornaliero); la chat che cambia gli argomenti («non mostrarmi più notizie su X», con Consenti/Nega); i progetti degli agenti come fonte; parole da evitare, fonti e domini preferiti/esclusi per argomento. Vincoli: controllo in Rust a orari, notizie già viste non si ripetono (URL o titolo simile), feed solo sul PC.

## Estensione per Chrome ed Edge (29/10)
Parla solo con EasyIsland via native messaging (niente rete); rivede la decisione dell'11/10.
- Prima: azioni per sito nella barra (come «Nella barra con»); la chat vede la pagina (indirizzo, titolo, selezione, testo) al posto di Ctrl+A/C di `context::window_text`.
- Poi: schede aperte nella ricerca dell'isola; card dell'integrazione che corrisponde alla pagina, «Manda a Notion»/«Salva nella memoria»; nuovi «quando» per i Flussi.
- Ultimo, delicato: la chat che usa il browser con Consenti/Nega a ogni passo.
- Costi: Chrome Web Store (o criteri aziendali), registro del canale nell'installer, Firefox a parte, un pezzo in più da tenere allineato; JS semplice.

## Notion, seconda parte
- «Manda a Notion» da Appunti e dalla risposta della chat (dal testo selezionato c'è).
- **Clienti:** database clienti con proprietà telefono; su chiamata 3CX o ticket Zammad la scheda del cliente con «Apri in Notion».
- Attività assegnate a me: serve scegliere la persona (l'API vede il bot).

## Remote Desktop Manager, dopo le prove
- API REST di DVLS (`Search-DSEntry`/`Get-DSEntry`) o Hub (`Get-HubEntry`) se il modulo non va bene in azienda.
- Creare una voce (`New-RDMSession`, `Set-RDMSession`) con i campi base.
- Associazione esplicita cliente 3CX/organizzazione Zammad ↔ cartella RDM: fatta per le cartelle di Devolutions Cloud (4/11, `rdmFolders`); manca per le cartelle lette dal modulo di RDM.
- Strumento per la chat: fatti `rdm_search` e `rdm_open` (4/11).
- Da non fare: legarlo a «davanti al cliente»; leggere password.

### Devolutions Cloud (03/11, dal PC lavoro) — fatto il 4/11
Fatti tutti e quattro i passi più lo strumento per la chat (`docs/integrazioni.md` → Devolutions Cloud). Resta qui come appunto di cosa era stato provato.
Prove di @claudio sul PC lavoro, dettagli in `RDM-Devolutions-Cloud-connessione.md` e nella skill `devolutions-cloud` (SKILL.md, `scripts/setup.ps1`, `scripts/DevolutionsCloud.psm1`), arrivati in Agent Chat il 03/11.
- **Cosa funziona:** l'MCP di RDM e i cmdlet RDM non vedono il vault; vanno i **cmdlet Hub** (`Devolutions.PowerShell` in pwsh 7) con una **Application identity** (Is enabled, Can access user vaults, senza admin). Un'identità per PC (es. `Claude-RDM-Casa`): il Secret si vede una volta sola e rigenerarlo scollega l'altro PC.
- **Credenziali:** URL, Key e Secret in una finestra di EasyIsland, salvati con DPAPI o in Gestione credenziali; mai in chat, mai copiati tra PC (il file DPAPI vale solo dove è stato creato).
- **Lettura:** elenco vault e voci per cartella cliente (farmacie) senza password; strumento per la chat «apri/cerca il server di X».
- **Password:** solo negli appunti, che si svuotano da soli; mai a schermo né al motore.
- **Scrittura** (`New-DVCCredential`, `New-DVCPasswordList`): conferma nell'isola con anteprima `-DryRun`; dopo la scrittura rilettura con `-ResolvePasswords` e controllo che dice solo giusto/sbagliato. Trappola: al salvataggio la password passa in chiaro. Niente eliminazioni.
- **Ordine:** 1) collegamento e lettura; 2) password negli appunti; 3) scrittura con anteprima e verifica; 4) associazione cliente 3CX/Zammad ↔ cartella del vault.

## Spunti dall'app originale
- Plugin come quello di opencode per **Amp** e **Hermes**.
- **Limiti di Codex** con `account/rateLimits/read` di `codex app-server`.
- **Riepilogo settimanale come immagine** condivisibile, con «Nascondi i nomi dei progetti».
- **GitHub:** PR con CI e revisioni, avvisi CI, griglia dei contributi («GitHub rinnovato» escluso per ora).
- Da scegliere con Edoardo: Impostazioni con intestazione per pagina (titolo, sottotitolo, personaggi su nero con particelle) e righe «titolo + descrizione / comando»; **note delle chiamate** (trascrizione per persona, riassunto, punti, cose da fare; audio poi cancellato; serve riconoscimento vocale e avviso ai partecipanti; la registrazione c'è); **dettatura ovunque** (riconoscimento locale ~700 MB, o `Win+H`); durata della cronologia, «ripristina predefiniti» per pagina, Impostazioni all'avvio manuale.
- Fuori per ora: comandi a voce sempre in ascolto, app Android con server, suoni da file.

## Proposte al momento giusto, seguiti
«Chiudi il programma» sulla porta occupata; cartella del progetto nella card del server di sviluppo (serve la riga di comando del processo). Dettatura ripulita (serve riconoscimento vocale): per ora no.

## Automazioni, ancora fuori
«N minuti prima di un evento del calendario», «fine giornata» come evento, «nessun agente al lavoro» come condizione (Rust non tiene lo stato delle sessioni), chiamata 3CX finita. Segnaposto sempre sicuri: nei link codificati, negli script solo come argomento.

## Strumenti di EasyIsland per gli altri motori via API
Fatto per Anthropic con chiave; opencode li ha. Senza: OpenRouter, OpenAI, Gemini, Ollama, LM Studio (`openai.rs`), salvo Modalità terminale via opencode. Servirebbe `tools` da `hook/src/tool_list.rs`, `tool_calls` dallo stream, ciclo come `claude.rs`, ripiego al 400 e interruttore. Edoardo ha scelto il 19/10 di non farlo per ora.

## Documenti Word e PDF nella chat (21/10, fatto il 7–8/11)
Fatti creare, compilare, leggere `.docx` con immagini, Word → PDF, lettura, unione e divisione dei PDF (`docs/chat.md` → Documenti Word e PDF). Revisioni e commenti esclusi (`docs/decisioni.md`). Restano:
- moduli PDF; copiare pagine dai PDF cifrati senza password di apertura (RC4/AES);
- elenco dei modelli in Impostazioni (oggi solo dalla chat e dalla cartella `documenti\modelli`);
- immagini al posto di un segnaposto in mezzo al testo;
- PDF più difficili: font Type3, codifiche CJK senza ToUnicode, LZW e ASCII85.

## Recapiti tra due EasyIsland (25/10, da valutare)
Casa (sempre acceso) e notebook, due account Claude: uno lavora per l'altro senza mischiare le memorie.
- Compito con «consegna a: l'altro PC»: il risultato è un **pacco** (.md, PDF, riassunto) che l'altro ritira in `da-leggere` e impara col suo motore. Mai memoria, chat o chiavi condivise.
- Bidirezionale; il collegamento sa solo consegnare documenti e chiedere un compito (approvato se non consentito). Mai comandi o lettura dei dati altrui.
- **Niente VPN né cloud.** Opzioni: porta inoltrata a casa (UPnP, TLS, chiave, limiti; DNS dinamico), Telegram come postino (50 MB per file; conta come cloud?), consegna diretta in LAN. Hole punching escluso.
- Sicurezza: abbinamento con codice, chiave in Gestione credenziali, pacchi firmati e cifrati, niente eseguibili, solo in `da-leggere`. Costi a carico di chi esegue; compiti lunghi a passi, di notte, motore gratuito o locale.

## Memoria, seguiti
- **Pulizia proposta:** `brain::check` segnala pagine doppie (alias, titoli, parole in comune) e relazioni ripetute con nomi diversi; il compito propone «unisci» con `task_ask` (la pagina unita va in archivio).

## TextComposer: risposte dalla memoria scritte da un modello piccolo (15/11; prima versione fatta: `local_model::compose`, `docs/chat.md` → Modello sul PC)
Edoardo: Potion cerca (`memory_meaning.rs`, non si tocca), un modulo a parte scrive. Ingresso: domanda, estratti trovati, riferimenti; uscita: testo composto o «non riesco». Modello sostituibile senza toccare la ricerca.
- **Primo compositore = oggi:** le righe così come sono (`memory_answer::shown`); è anche il ripiego a ogni errore.
- **Poi un modello dentro EasyIsland** (Edoardo, 15/11: mai Ollama, LM Studio o servizi esterni per i modelli sul PC; es. Qwen2.5 0.5B Instruct, Apache 2.0): scaricato dopo un clic con SHA-256, eseguito dall'app, riusando `claude/modello-integrato` (llama-server in processo separato). La ricerca resta Potion (deciso il 15/11: altri modelli model2vec sono inglesi o peggiori; model2vec-rs dà gli stessi vettori con ~500 MB di RAM invece di ~25).
- **Controllo:** ogni numero, IP, nome in maiuscolo o codice del testo deve stare negli estratti, se no si mostrano le righe; fonti sempre sotto, piegate.
- **Risorse** (stime da misurare sul portatile con il modello dentro l'app, prima di unirlo): ~400 MB su disco, ~0,5–0,7 GB in memoria solo mentre scrive, 1–3 s di CPU. Solo sulle risposte dalla memoria, priorità bassa e max 2 core, scaricato subito dopo, tempo massimo 4 s, mai a batteria, sotto carico o in chiamata 3CX; spento di serie.
- **Misura:** 👍/👎 (`votes.rs`) delle risposte composte contro le righe.

## Modalità terminale interna: limiti rispetto a opencode (15/11, lasciati così da Edoardo)
`local_agent.rs` (Modello sul PC) legge ~4.000 token invece di ~11.000 e non vuole opencode, ma rispetto a opencode:
- **Strumenti:** niente web (cerca, apri pagina); ricerca solo a sottostringa, niente regex né per nome di file (`*.ts`); modifica = un testo unico sostituito o il file intero, niente patch su più punti o più file; niente piano a passi, sotto-agenti, skill, domande con scelte, diagnostica dell'editor; niente server MCP di `opencode.json` (solo gli strumenti di EasyIsland scelti da `toolhint`).
- **Comandi:** un PowerShell nuovo per comando (cartella e variabili non restano); niente comandi che restano accesi (server di sviluppo, watch: tempo massimo 600 s); output a 20.000 caratteri; Ferma chiude PowerShell ma non per forza i programmi che ha avviato.
- **Memoria del lavoro:** 25 passi per domanda; nella storia solo domanda e risposta finale (i file letti e i comandi del turno si rileggono al turno dopo); niente riassunto della sessione.
- **Permessi:** «Sempre» solo per quel comando o file esatti, nella conversazione (opencode salva regole più larghe).
- Più semplici da togliere, se servirà: ricerca per nome di file, modifica di più punti in una volta.

## Modello integrato (27/10)
Ripreso il 15/11 come «Modello sul PC» sul ramo `claude/llm-interno` (`docs/chat.md` → Motori): controllo della scheda grafica, consiglio, Vulkan, Modalità terminale, risposte dalla memoria. Il ramo `claude/modello-integrato` non serve più.

## Memoria master (26/11, decisioni 27/11, da progettare)
- **Gruppo e catalogo (Edoardo, 27/11, prevale su quanto sotto dove diverso):**
  - pensata da subito per i **colleghi**: ognuno ha uno spazio suo su Garage (scrive solo lui, gli altri leggono); **tutti amministratori** (invitano, tolgono un collega, tolgono una voce dal catalogo), ogni azione registrata e visibile;
  - **due memorie**: la **personale** (slave, sul PC) e la **condivisa** del gruppo (master); «Condividi» porta una voce della personale nella master, collegata, in sola lettura per gli altri;
  - **catalogo**: abilità, ricette dei portali, integrazioni personali (descrizione, immagini, pagina; le schede solo se scelto) e server MCP; Impostazioni → Catalogo con Installa / Aggiorna (con le differenze, mai automatico) e «Condividi» accanto alle proprie. Installare = copia locale, modificabile;
  - **chiavi mai pubblicate**: solo i nomi (`secrets`, variabili d'ambiente MCP), valori chiesti all'installazione e messi in Gestione credenziali; anteprima prima di pubblicare con quello che somiglia a una chiave segnato;
  - prima di installare si vede cosa fa: comando MCP, host e script dell'integrazione, testo dell'abilità;
  - **ognuno ha la sua chiave** (Edoardo, 27/11: «per poter scollegare in futuro il singolo utente»): chiave d'accesso a Garage per persona, revocabile da qualsiasi amministratore (non legge né scrive più nulla); per la cifratura una coppia di chiavi per PC e la chiave del gruppo consegnata a ciascuno chiusa con la sua; chi esce: accesso revocato e chiave del gruppo nuova per i dati da lì in poi, consegnata solo a chi resta (quanto aveva già scaricato non si riprende); ingresso con un **invito**;
  - **Agent Chat** tolta senza migrare `memshare`.
- **Due strade, stessa struttura (Edoardo, 27/11: «possiamo fare entrambi?»):** l'archivio del gruppo è una **cartella condivisa** (OneDrive, Dropbox, Google Drive, cartella di rete: EasyIsland legge e scrive file, membri e revoche li gestisce il servizio) oppure **Garage** (gli stessi file via HTTPS 443 dietro il reverse proxy, membri gestiti da EasyIsland). Stessi percorsi e formato, una sottocartella per persona con un solo autore. Ordine proposto: prima la cartella, poi Garage. Nel catalogo anche le **ricette** dei portali. Cifratura da decidere (proposta: leggibile nella cartella, cifrata su Garage).
  - Firewall dei clienti: solo HTTPS in uscita sulla 443, come un sito; 3900/3903 restano interne alla VPS.
- **Prima connessione a Garage (studiata il 27/11 sulla documentazione della v2.6.0):**
  - VPS, una volta: container `dxflrs/garage:v2.6.0` con dati persistenti, `garage.toml` a nodo singolo (`db_engine = "lmdb"`, `replication_factor = 1`, `s3_region = "garage"`, `rpc_secret` casuale, niente `admin_token` nel file), avvio `--single-node`; HTTPS dal reverse proxy di aaPanel per S3 (3900) e per l'API di amministrazione (3903); primo gettone con `garage admin-token create` (mostrato una volta).
  - Fondatore: Impostazioni → «Crea il gruppo» (indirizzo + gettone in Gestione credenziali); EasyIsland con l'API v2: `CreateKey` della persona, `CreateBucket` `mem-<persona>`, `AllowBucketKey` lettura/scrittura/proprietario, spazio `gruppo` (membri, registro, chiavi del gruppo consegnate); coppia di chiavi del PC, chiave del gruppo, chiave di recupero.
  - Invito: `CreateKey` + spazio del collega + lettura su tutti gli spazi (e a tutti sul suo) + scrittura sul suo e su `gruppo` + `CreateAdminToken` suo; codice d'invito cifrato con un PIN detto a parte.
  - Scollegare: `DeleteKey` + `DeleteAdminToken` + chiave del gruppo nuova per i dati da lì in poi; tutto nel registro.
  - Limiti: gettoni limitabili solo per operazioni, non per spazio (chi è amministratore può darsi permessi altrui: fiducia tra colleghi); chi può fare `CreateAdminToken` ha di fatto tutti i poteri; niente versioning degli oggetti (versioni nostre); scritture condizionate non documentate (non servono). `AllowBucketKey`: i permessi a `false` restano com'erano, per togliere serve `DenyBucketKey`.
Decisioni di Edoardo in `decisioni.md` → Memoria condivisa.
- **Il modello:**
  - ogni PC ha la sua memoria;
  - «Condividi» manda un dato alla master;
  - gli altri PC leggono la master.
- **Formato (concordato tra i due Claude, 27/11):**
  - Unità = voce condivisa (una pagina o una riga di `MEMORIA.md`). La scrive solo il PC che l'ha condivisa, quindi niente conflitti.
  - **Un secchio per PC** (`mem-<pc>`): Garage dà i permessi per chiave e secchio, non per prefisso. La chiave del PC scrive solo nel suo, le altre leggono: «solo lettura» lo impone il server.
  - Dentro: `voci/<id>/<versione>` cifrati (AES-256-GCM con CNG di Windows, nessuna dipendenza nuova), `indice`, e `note/<pc-autore>/<id-nota>` per le note lasciate agli altri (ognuno nel proprio secchio). Gli altri PC fanno un `GET` condizionato (ETag) solo sugli indici.
  - Garage non tiene le versioni: le ultime 5 di ogni voce le teniamo noi. Ordine di scrittura: versione nuova, poi indice, poi cancellazione oltre la quinta; chi riceve 404 rilegge l'indice. Niente scritture condizionate (un autore per secchio).
  - Firma SigV4 con la regione `s3_region` di Garage, indirizzi in stile percorso (`https://host/secchio/oggetto`).
  - Copia altrove: unica protezione oltre le 5 versioni, quindi istantanee **tirate** dall'altra parte (la VPS non può cancellarle), scadenza 30 giorni.
  - Garage non ha una console web ufficiale: secchi e chiavi si creano una volta con il comando `garage`.
- **Scelte di Edoardo (27/11):**
  - pagina condivisa **collegata**: si aggiorna da sola finché non si toglie la condivisione;
  - gli altri PC **solo leggono** e possono lasciare una nota all'autore, che la unisce con un clic;
  - condivisione **solo a mano**, voce per voce, con l'anteprima (righe `secret_like` tolte); nessuna regola automatica per cartella.
- **Lettura:** copia in sola lettura per PC di origine (`memoria-master/<pc>/`), separata dalla memoria propria. È lo schema di `memshare`. `memory_search` cerca prima nella propria memoria, poi nella copia, che entra anche nell'indice per significato.
- **«Smetti di condividere»:** la voce esce dall'indice; si cancellano tutte le versioni e le note. L'interfaccia dice «resta nella copia di sicurezza fino a <data>».
- **Migrazione:**
  - le pagine di `memshare` diventano voci, dopo anteprima e conferma;
  - le note in attesa (`waiting_file`) si consegnano prima di togliere Agent Chat;
  - `memoria-condivise/` si cancella dopo il primo scaricamento riuscito dalla master.
- **Chiave di recupero:** mostrata una volta, testo «Conservala in un posto sicuro fuori da questo PC», verifica di due gruppi prima di proseguire.
- **Ordine:**
  1. condivisione su richiesta e lettura dagli altri PC;
  2. note per l'autore;
  3. migrazione di `memshare.rs`;
  4. via Agent Chat.
- **Da verificare:** Gestione credenziali nel Windows in Docker della VPS (persiste al riavvio?).
- **Solo chat o tutto EasyIsland:** è indipendente, ancora da ragionare. Serve un inventario di cosa parte all'avvio in `lib.rs`.

## EasyIsland collegati: memoria condivisa (31/10, superata dalla Memoria master)
Notebook spesso spento; VPS con Windows 11 in Docker sempre accesa con un secondo EasyIsland usato da Telegram. Si condivide solo la memoria, anche con due EasyIsland al lavoro insieme (nessun custode). (Agent Chat ha poi aggiunto una memoria condivisa via server: `memshare.rs`.)
- **Collegamento:** un indirizzo raggiungibile, scelta **Tailscale** (nel Windows del container); vale anche VPN aziendale, LAN, porta aperta. Sul notebook DNS di Tailscale spento, indirizzo `100.x.y.z`, niente exit node; sulla VPS chiave senza scadenza. Prima qualche giorno di prova con le VPN dei clienti.
- **Abbinamento** (Impostazioni → «EasyIsland collegati»): codice temporaneo, scambio di chiave (Gestione credenziali), nome per EasyIsland, ascolto solo sull'indirizzo scelto, alla pari e per più di due; stato e «Scollega».
- **Cosa condividere** per collegato e verso: all'inizio la memoria (`MEMORIA.md`, `pagine/`, `diario/`, `da-leggere/`, `fonti/`, archivio); poi promemoria, abilità, automazioni. Impostazioni, chiavi, chat restano locali.
- **Sincronizzazione:** base per file, al collegamento solo il cambiato, poi subito (`brain_watch.rs`); recupero dopo giorni; gli spostamenti in archivio passano.
- **Unione** riga per riga sulla base comune: note e diario uniscono sempre; pagine con stesse righe cambiate tengono anche la copia dell'altro e `check` propone l'unione. `memory_page_write` con versione: scrittura solo se è ancora quella letta.
- **Turni:** riordino, lettura di `da-leggere/` (per file) e pulizia li prende chi arriva prima, con scadenza se si spegne.
- **Telegram:** un bot per EasyIsland.
- Da decidere: protocollo (HTTPS o WebSocket con TLS e chiave), frequenza massima per file, come mostrare le pagine arrivate. Ordine: prova Tailscale, abbinamento, sincronizzazione, turni, altro.

## Agenti in parallelo (19/11/2026, dalla ricerca di spunti; Edoardo: «lo facciamo dopo»)
- **Cosa:** nella scheda Agenti (sessioni di Claude Code, Codex, Antigravity nei terminali; non il «Multi motore» della chat) in cima chi chiede attenzione; righe compatte per progetto con CPU e RAM della sessione; shell e server rimasti accesi dopo la fine della sessione con «Ferma»; «chiudi le sessioni ferme da N minuti» con conferma; concluse piegate in fondo.
- **Perché:** il PC si blocca con molte sessioni e processi orfani dei build.
- **Fonti:** `claude-ponte/ricerca/` (principale 1–3, antigravity 28), fuori dal repo.

## Altro
- **Scheda esatta di Windows Terminal** per «Apri» (titolo della console + UI Automation): per ora non serve.
- **Clic destro in Esplora file** (deciso l'11/10): voce in `HKCU\Software\Classes\*\shell` scritta dopo conferma; in Windows 11 sotto «Mostra altre opzioni» (il menu nuovo vuole MSIX con `IExplorerCommand`).
- **Personaggi rimandati:** polpo, rana, granchio (prove dell'8/10 venute male); pose di Goccia (saluto con la mano, salto, caduta, onda).
- **opencode:** nella chat `question` è negato (`opencode.rs`): riusare la card dell'agente (`opencode_agent.rs`); il menu dei motori non controlla se Ollama/LM Studio rispondono.
- **Decisioni aperte:** firma del codice (Authenticode o Azure Trusted Signing); tag `windows-latest` creato per sbaglio; funzioni del Mac mai portate (invio di un file per email).
- **Nota a mano con freccia (6/11, da decidere se usarla):** freccia sottile disegnata a mano, verde acqua, con una nota breve in scrittura a mano accanto al punto indicato. Aspetto: freccia misurata sul disegno di riferimento, praticamente identica; font molto simile (prima quelli di Windows, altrimenti scritte fisse disegnate nel codice). Niente evidenziatore, niente dipendenze. Usi possibili: funzioni nuove nell'interfaccia (punto fisso, il più utile) o dubbi nelle risposte della chat (più estetico: il testo scorre e la colonna è stretta).
- **Da valutare:** TeamViewer (cosa serve, da chiarire); libreria di comandi PowerShell/cmd con conferma; casa (promemoria, Home Assistant); integrazioni proposte il 2/10: Windows Update, stampanti bloccate, Docker, Git locali, WSL, IMAP, DNS/blacklist, pagine di stato, CISA KEV, RSS, ntfy, Uptime Kuma, Proxmox, Synology/TrueNAS, UniFi, Pi-hole, GLPI.

## Pulizia del codice (solo quando si tocca quel file)
- `mmss` duplicato in `src/views/integrations.ts` (secondi) e `src/views/threecx.ts` (ms); «Copiato ✓» ripetuto in più viste.
- File lunghi: `src/settings/main.ts`, `src/island/island.ts`, `src/character/engine.ts`, `src-tauri/src/lib.rs`.

## Smistatore: scelta del motore (14/11)
Tappe 1, 2 e 4 fatte (`docs/chat.md` → Smistatore). Tappa 3: dal registro dei turni, un modello economico per le domande simili a quelle risolte bene con pochi passi e Claude per le altre; una riga in chat «risposto da …, perché simile a …», sempre cambiabile, e ogni cambio diventa un esempio. Prima servono settimane di registro.
- Ricette per somiglianza (14/11): con il modello di `meaning_local.rs` le ricette si confrontano anche per significato, non solo per radici («spegni la musica» ≈ «metti in pausa»); soglia alta e «Esegui»/«Chiedi al motore» come oggi. Prima misurare sul registro dei turni quante domande ripetute le radici non riconoscono.
