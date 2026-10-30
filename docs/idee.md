# Idee e progetti non ancora fatti

I dettagli che `HANDOFF.md` riassume in una riga. Le idee più vecchie e l'analisi di 3CX sono in `archivio/HANDOFF-fino-al-6-ottobre.md`, sezione 7.

## EasyIsland agente personale — versione 1.0.0 (chiesto da Edoardo il 23 ottobre 2026)
Obiettivo di Edoardo: EasyIsland diventa il suo agente personale, programmabile come qualsiasi agente IA, e non meno degli altri ma di più. Oggi ha già i pezzi (chat con gli strumenti, memoria, ricette, automazioni, Telegram, Modalità terminale, connettori MCP); manca un agente che riceve un obiettivo, lavora da solo nel tempo e si muove per primo.

**Vincoli che restano** (`CLAUDE.md`): mai inviare email, approvare permessi o eliminare senza un clic (salvo «Automatica» accesa dall'utente); comandi solo con la Modalità terminale; CPU ~0 % a isola ritirata, quindi il lavoro dell'agente sta in Rust, svegliato da orari ed eventi, mai da un ciclo continuo. Nessun server in mezzo: gira sul PC, si raggiunge dall'isola e da Telegram.

### Passo 1 — Compiti (`tasks.rs`)
- **Fatto il 23 ottobre 2026** (come funziona: `docs/chat.md` → Compiti). Rispetto al piano qui sotto: niente vista nuova (il compito è una sessione della scheda Agenti); i permessi di un compito vanno solo nell'isola, Telegram riceve gli avvisi; niente riquadro nella Panoramica (c'è la sessione di Agenti). **Resta:** permessi e domande dei compiti anche come pulsanti in Telegram, costo stimato nella card, più compiti insieme.
Un compito è un obiettivo («prepara il resoconto mensile per Rossi entro venerdì», «segui il ticket 482 e avvisami se il cliente risponde») che l'agente scompone in passi e porta avanti da solo, anche a isola chiusa, finché è fatto, ha bisogno di te o finisce il tempo concesso.
- **Dati:** un file per compito in `%APPDATA%\EasyIsland\compiti\<id>.json` (scrittura con `settings::write_atomic`) e il suo registro leggibile `<id>.md`. Campi: titolo, obiettivo, motore e modello, stato, piano (passi con stato), quando (subito, a un'ora, ricorrente, a un evento), scadenza, limiti (turni, minuti, token), cartella di lavoro, sessione del motore per riprendere, risultato, registro delle azioni.
- **Stati:** da pianificare → in corso → attende te → in pausa → fatto / non riuscito / fermato. Un riavvio di EasyIsland mette in pausa quelli in corso, con «Riprendi».
- **Esecuzione:** un turno del compito è un `chat_turn` (`lib.rs`) con una `Chat` sua e il testo che va al registro, come fa Telegram. Il canale dei permessi oggi è isola o Telegram (`telegram: bool`): diventa un canale con tre valori (isola, Telegram, compito), e i permessi di un compito vanno nella card dell'isola (striscia a isola chiusa) e, se collegato, anche in Telegram. Dopo ogni turno, se il compito non ha detto «fatto» o «chiedo», ne parte un altro con «continua dal piano», fino ai limiti. Un compito alla volta all'inizio (coda), poi al massimo due.
- **Strumenti nuovi** (relay `hook/src/mcp.rs` e `tool_list.rs`, esecuzione in `agent.rs`): `task_plan` (scrive o corregge il piano), `task_step` (segna un passo), `task_ask` (domanda all'utente: card nell'isola e Telegram, il compito passa ad «attende te»), `task_done` (risultato e riassunto), `task_note` (nel registro). Per creare e vedere compiti dalla chat: `task_create` (con anteprima e conferma nella card, come `create_automation`) e `task_list`.
- **Come si avvia:** dalla chat (`/compito …`), dal campo in alto, da Telegram (`/compito`), da un'automazione (passo nuovo «Avvia un compito», con i dati dell'evento come `{file}` o `{chiamante}`), a un'ora o ricorrente (timer in Rust che dorme fino all'ora giusta).
- **Isola:** i compiti sono sessioni della scheda Agenti, con il personaggio che reagisce come per Claude Code (lavora, attende, ha finito, errore). La card mostra obiettivo, piano con le spunte, ultimo passo, tempo e costo usati, e Ferma / Riprendi / Rispondi / Registro. Nella Panoramica un riquadro «Compiti».
- **Impostazioni → Compiti:** motore e modello predefiniti (consigliato l'abbonamento via Claude Code), limiti per compito e al giorno, avvisi su Telegram, elenco dei compiti con il loro registro.
- **Costi:** nessun turno senza un compito o un evento; tetto di turni e minuti per compito e di compiti al giorno; il costo stimato nella card.
- **Prove:** test Rust su stati, limiti, orari e `validate`; scena `compiti` in `dev/scenes.ts` e `npm run smoke`; dal vivo un compito vero con Notion e Outlook.

### Confronto con gli altri agenti personali (23 ottobre 2026)
Studiati gli agenti personali più usati: quelli locali e open source con controllo periodico, abilità in Markdown e memoria a file; quelli che imparano dall'uso salvando procedure; i compiti programmati delle app di chat (ogni giorno, settimana, mese, a richiesta), dove ogni esecuzione è una sessione con connettori e abilità.
- **Già alla pari:** memoria a file (`MEMORIA.md` e diario mensile), abilità .md con intestazione e lettura a richiesta, compiti programmati con registro, connettori MCP, un canale di messaggi (Telegram), permessi con un clic.
- **Fatto il 23 ottobre:** Battito con `BATTITO.md` e «niente da segnalare»; ripetizioni ogni N minuti e ogni settimana; salvataggio delle procedure come abilità a fine compito.
- **In più rispetto a loro:** l'isola con il personaggio e i permessi a colpo d'occhio, più motori nello stesso compito (`task_delegate`), integrazioni locali (3CX, Zammad, Outlook, RDM, accesso remoto), nessun server in mezzo.
- **Fatto dopo, lo stesso giorno:** domande e permessi dei compiti anche su Telegram, riordino serale della memoria con conferma, abilità come comandi su Telegram (`docs/chat.md`).
- **Ancora da fare:** esecuzione con il PC spento (escluso per ora: servirebbe un server); un'abilità che limita davvero gli strumenti.

### Dopo i Compiti, verso la 1.0.0
- **Abilità programmabili:** fatte il 23 ottobre 2026 (`docs/chat.md` → Abilità), insieme al motore per compito e ai motori aiutanti (`task_delegate`). **Resta:** abilità come comandi anche su Telegram; un'abilità che limita davvero gli strumenti (oggi `strumenti` è un'indicazione).
- **Si muove per primo:** su ticket nuovo, fine chiamata 3CX, mail importante, scadenza di Notion prepara bozze e note da confermare con un clic (`docs/idee.md` → Proposte al momento giusto, Automazioni più intelligenti).
- **Permessi per livelli:** letture libere; scritture reversibili (bozze, note, attività) consentite una volta per strumento; invio, approvazioni, cancellazioni e comandi sempre con un clic. Registro «Cosa ho fatto» con Annulla dove si può.
- **Memoria per cliente e per progetto**, oltre a quella della chat (`memory.rs`): in parte fatta con le pagine collegate (`brain.rs`, 24 ottobre 2026). Resta: cartella della memoria a scelta (per aprirla anche in un editor di note a grafo), testo dai PDF senza dipendenze.
- **Più compiti insieme e sotto-agenti:** da valutare, perché `docs/decisioni.md` esclude per ora la squadra di agenti autonoma per tempi e costi.
- **Riepilogo della giornata** fatto dall'agente (la voce «La giornata di oggi e domani» qui sotto diventa un compito ricorrente).

## 3CX + Zammad: ticket del cliente sulla chiamata in arrivo
- Quando squilla, sotto il chiamante compaiono i suoi ticket Zammad aperti (titolo, stato, da quanto). Un clic apre il ticket.
- Dal numero normalizzato (`+39`, spazi, zeri) si cerca il cliente in Zammad, poi i ticket non chiusi suoi o della sua organizzazione.
- Da verificare sul server: `/api/v1/users/search` e `/api/v1/tickets/search` funzionano senza Elasticsearch?
- Regole: solo con entrambe le integrazioni accese, tutto in memoria, niente nomi né titoli davanti al cliente, nessuna azione senza un clic.
- Seguito possibile: «Nuovo ticket» dalla chiamata.

## Account Microsoft: mail nuove e calendario (annotata il 14 ottobre 2026; predisposizione fatta il 16 ottobre, `integrazioni.md` → Account Microsoft)
- **Teams, secondo passo** (deciso con Edoardo il 16 ottobre 2026, dopo la parte locale in `integrazioni.md`): con lo stesso accesso, riunioni di oggi con «Partecipa» (`onlineMeeting.joinUrl`), chat non lette (`Chat.Read`), stato Disponibile/Occupato (`Presence.Read`, e `Presence.ReadWrite` per cambiarlo). Serve la registrazione dell'app su Azure; l'azienda può bloccare il consenso.
- **Via principale, Microsoft Graph:** «Accedi con Microsoft» nelle Impostazioni (browser, permessi di sola lettura `Mail.Read`, `Calendars.Read`, accesso con PKCE e indirizzo locale di ritorno). Vale per account di lavoro (Microsoft 365) e personali (Outlook.com), senza Outlook aperto e anche con il nuovo Outlook. Controllo circa ogni minuto (le notifiche push di Graph vogliono un server pubblico). Card «mail nuova» con mittente e oggetto, Apri e Chiedi alla chat (riassunto o bozza, mai inviata); card prima di un evento con «Partecipa» per Teams (`onlineMeeting.joinUrl`). Poi «quando» per le automazioni (idea 2 sotto).
- **Vincoli:** token di aggiornamento in Gestione credenziali; rete solo verso Microsoft e solo con l'integrazione accesa. Serve registrare una volta l'app in Microsoft Entra (gratis): ne esce un ID applicazione pubblico, non segreto.
- **Problema:** molte aziende bloccano il consenso degli utenti alle app esterne → serve l'ok dell'amministratore IT («Richiede l'approvazione dell'amministratore»). Mai aggirarlo (per esempio con l'ID di un'app di Microsoft già approvata).
- **Ripieghi senza consenso dell'IT:**
  1. Outlook classico (`outlook.rs`, c'è già): aggiungere l'avviso di mail nuova con mittente e oggetto. Solo con Outlook classico aperto.
  2. Notifiche di Windows (`UserNotificationListener`, permesso «Accesso alle notifiche» dato dall'utente): l'isola mostrerebbe quelle di nuovo Outlook, Outlook web e Teams. **Da provare prima:** potrebbe servire l'identità di pacchetto (pacchetto sparse).
  3. Link ICS pubblicato da Outlook web nel widget Calendario (c'è già); alcune aziende bloccano anche questo, e non copre le mail.
- Domande aperte per Edoardo: Outlook classico o nuovo; chi amministra il Microsoft 365 aziendale.

## Exchange in sede: posta, calendario e attività senza Entra ID (annotata il 29 ottobre 2026, ragionata con Edoardo in un'altra sessione)
Con un Exchange in sede la registrazione su Entra ID non serve, e non funzionerebbe nemmeno: Graph lavora solo sul cloud. Si fa come i programmi di posta: email e password una volta, poi l'app si configura da sola.
- **Primo accesso:**
  1. **Autodiscover:** dall'indirizzo (es. nome@cliente.it) l'app trova l'URL del server, del tipo `https://mail.cliente.it/EWS/Exchange.asmx`.
  2. **Login:** utente e password con NTLM o Negotiate/Kerberos, i metodi standard di Exchange in sede.
  3. **Salvataggio:** le credenziali vanno in Gestione credenziali di Windows (`keyring`, già usato da EasyIsland). Dalla volta dopo l'accesso parte da solo.
  4. **PC nel dominio:** con Kerberos si può usare l'utente Windows già collegato, senza alcun login.
- **Protocollo: EWS.** In sede è ancora pienamente supportato (la dismissione riguarda solo Exchange Online) e un solo indirizzo copre tutto:
  - posta: `FindItem` / `GetItem` sulla Posta in arrivo;
  - calendario: `FindItem` con `CalendarView` (intervallo di date);
  - attività: la cartella Tasks, le stesse di Outlook classico.
- **In Rust:**
  - HTTP con richieste SOAP fisse. Un crate EWS maturo non esiste, ma bastano poche richieste; la lettura dell'XML con `quick-xml`, che sarebbe una dipendenza nuova, da valutare contro una lettura a mano dei pochi campi che servono.
  - NTLM / Kerberos: `reqwest` non li gestisce da solo. Due strade:
    - il crate `sspi` (NTLM, Kerberos e Negotiate in puro Rust);
    - oppure **WinHTTP** tramite il crate `windows`, che gestisce anche il login con l'utente Windows. È già tra le dipendenze (`Win32_Networking_WinHttp`): da preferire.
  - Lato Tauri: tre comandi (`get_mail`, `get_calendar`, `get_tasks`) che restituiscono JSON al front end, come le integrazioni Microsoft di oggi (`integrazioni.md` → Account Microsoft).
- **Sconsigliati:** ActiveSync (il protocollo dei telefoni: complicato e soggetto a licenza) e IMAP (solo posta: niente calendario né attività).

## Menu dell'app in uso nella barra (chiesta da Edoardo il 29 ottobre 2026)
Pulsanti o menu che cambiano con il programma in primo piano, da poter mettere nella barra fissa.
- **Primo passo, facile:** la «Barra dell'app in uso» (le azioni rapide dell'utente con «Nella barra con») come elemento a sé della barra fissa; oggi ci arriva solo dentro la striscia.
- **Il menu vero del programma:** con UI Automation (accessibilità di Windows) si legge la barra dei menu della finestra in primo piano (File, Modifica, Visualizza…) e la si mostra nella barra; un clic apre le voci (menu nativo, come «…») e le esegue nel programma (`Invoke` / `ExpandCollapse`). Non sono voci predefinite di EasyIsland: sono quelle del programma.
- **Copertura:** bene con le app classiche con barra dei menu; in parte con Office (schede della barra multifunzione) e con le app fatte di pagine web, dove dipende da cosa espongono; quasi nulla con le app senza menu (browser). Dove non c'è un menu leggibile restano le azioni rapide per quel programma.
- **Da fare prima:** una prova che legge i menu dei programmi che Edoardo usa di più, in un branch suo.

## Elementi da aggiungere alla barra fissa (ragionata con Edoardo il 30 ottobre 2026)
**Fatti il 30 ottobre 2026 (branch `claude/widgetbar`), con il nome «Widget della barra»:** catalogo, opzioni comuni e `opts` (passo 1); orologio, volume, microfono, luminosità, batteria, velocità della rete e menu di spegnimento (passo 2). Restano: i pannelli come card dell'isola (oggi aprono quelli di Windows), dispositivo d'uscita, Wi-Fi e Bluetooth, il passo 3 e l'aspetto della barra (`docs/architettura.md` → Barra fissa).
Spunto da una barra per Windows open source con decine di widget configurabili. Edoardo vuole soprattutto **poter aggiungere elementi alla barra** da un catalogo, ognuno con le sue opzioni. Oggi la barra mostra solo integrazioni, widget, azioni rapide e la striscia (`fixedBarItems`, `docs/architettura.md` → Barra fissa).
- **Catalogo in Impostazioni → Aspetto → Barra fissa:** «+ Aggiungi» apre l'elenco per gruppi (Sistema, Lavoro, Agenti, Le mie azioni). Si sceglie l'area (sinistra, centro, destra), si cambia l'ordine, si apre «Opzioni» per l'elemento. Uno stesso elemento si può aggiungere più volte con opzioni diverse, per esempio due orologi con fusi diversi (`fixedBarItems` riceve `opts`). Tutto dalle Impostazioni, come deciso.
- **Nome:** «Widget» in EasyIsland vuol dire i controlli ripetibili (`docs/decisioni.md`). Nella barra conviene «Elementi della barra», così non si confondono. Da decidere.
- **Opzioni comuni a ogni elemento:**
  - cosa mostra: solo icona, icona e valore, oppure un formato con segnaposto (`{icona} {cpu}%`);
  - un secondo testo che compare con un clic (l'ora che diventa la data);
  - azioni per clic sinistro, centrale e destro e per la rotella: apri la card, esegui un'azione rapida, menu, cambia testo;
  - suggerimento al passaggio del mouse.
- **Pannelli:** un pannello (calendario, cursore del volume, dispositivi) è una card dell'isola, che si apre già contro la barra. Nessuna finestra in più.
- **Elementi nuovi di sistema** (a istanza singola, quindi né widget né integrazioni con una scheda):
  - orologio e data, con la card del calendario (Outlook, ICS);
  - volume (rotella, muto, dispositivo d'uscita) e microfono muto;
  - luminosità (rotella; schermi esterni con DDC/CI, dove rispondono);
  - batteria e piano energetico;
  - velocità della rete su e giù, Wi-Fi, Bluetooth;
  - CPU, RAM, disco, GPU e temperature, anche con un piccolo grafico;
  - lingua della tastiera, Non disturbare, cestino (svuotarlo solo con conferma);
  - menu di spegnimento (blocca, sospendi, riavvia, spegni, sempre con conferma);
  - aggiornamenti disponibili (winget, Windows);
  - consumo di Codex e Copilot accanto a quello di Claude;
  - progetti recenti di VS Code;
  - titolo della finestra in primo piano;
  - la «Barra dell'app in uso» come elemento a sé (sezione qui sopra).
- **Ci sono già, vanno portati bene nella barra:** meteo, musica, Stato del PC, rete, consumo Claude, GitHub, To Do, i controlli dei server.
- **Aspetto della barra** (dopo gli elementi): stile a isolette, dove ogni area è un'isoletta con lo sfondo del desktop in mezzo (un quarto valore di `fixedBarBackground`); sfocatura acrilica di Windows 11; angoli e bordo; margini dai lati per una barra sospesa; grandezza del testo e spazio tra gli elementi; nascondi da sola finché non arriva il mouse.
- **Vincoli:**
  - la barra è sempre visibile: ogni elemento si aggiorna su evento (volume con Core Audio, batteria e rete con le notifiche di Windows), CPU e rete con un giro lento di 2–5 s, l'orologio ai secondi solo se scelto;
  - niente dipendenze nuove: le API di Windows con il crate `windows`;
  - nessuna animazione continua.
- **Esclusi** (Edoardo, 30 ottobre 2026): barra su più schermi, CSS personale, systray, barra delle applicazioni sostitutiva, desktop virtuali, gestori di finestre a riquadri, visualizzatore audio (anima sempre), sfondi del desktop, Pomodoro e notifiche di sistema (già esclusi).
- **Ordine proposto:** 1) catalogo, opzioni comuni e `opts`; 2) orologio, volume e microfono, luminosità, batteria, rete, menu di spegnimento; 3) gli altri elementi; 4) aspetto della barra.

## Estensione per Chrome ed Edge (ragionata con Edoardo il 29 ottobre 2026)
Un'estensione che parla solo con EasyIsland sul PC (native messaging di Chrome: un canale locale, niente rete). Rivede la decisione dell'11 ottobre «niente estensione del browser» (`decisioni.md`, menu sul testo selezionato).
- **Prima di tutto (consigliati come inizio):**
  1. **Azioni per sito nella barra:** le azioni rapide legate a un sito, come «Nella barra con» per i programmi; si unisce al menu dell'app in uso qui sopra (la barra diventa per app e per sito).
  2. **La chat vede la pagina:** indirizzo, titolo, selezione e testo leggibile presi dall'estensione, al posto del Ctrl+A / Ctrl+C di `context::window_text`.
- **Poi:** le schede aperte nel campo di ricerca dell'isola; la card dell'integrazione che corrisponde alla pagina (ticket, PR, pagina di Notion) e «Manda a Notion» / «Salva nella memoria»; nuovi «quando» per i Flussi (apro un sito, notifica di una web app, che potrebbe arrivare nell'isola).
- **Per ultimo, delicato:** la chat che usa il browser dell'utente (moduli, clic) con Consenti / Nega a ogni passo.
- **Costi:** account e revisione sul Chrome Web Store (o caricamento a mano / criteri aziendali); l'installer registra il canale locale nel registro dell'utente; Firefox sarebbe un'estensione a parte; un secondo pezzo da tenere allineato. Nessuna dipendenza nuova (JavaScript semplice).

## Notion, seconda parte (annotata il 14 ottobre 2026)
Edoardo usa Notion per attività, note, documentazione e clienti. Fatti: attività, nota veloce, pagine fissate, ricerca, chat sulla pagina. Restano:
- **«Manda a Notion»** da una voce degli Appunti e dalla risposta della chat. Dal testo selezionato c'è dal 15 ottobre 2026.
- **Clienti:** un database clienti scelto nelle Impostazioni con la proprietà del telefono; su una chiamata 3CX in arrivo, e su un ticket Zammad, la scheda del cliente (nome, note, link) con «Apri in Notion». Numero normalizzato come per Zammad.
- Fatti il 15 ottobre 2026: gli avvisi delle scadenze con orario e dei commenti nuovi, la configurazione rapida, «+ Attività» e «Rimanda».
- **Viste legate ai profili:** con il profilo «Ufficio» la card apre da sola la vista «Ufficio» (le viste ci sono dal 15 ottobre 2026).
- Attività assegnate a me: serve scegliere la persona (l'API vede il bot, non l'utente).

## Remote Desktop Manager, dopo la prima versione
Preparata il 15 ottobre 2026 (`docs/integrazioni.md`). Da valutare dopo le prove sul PC con RDM:
- **Devolutions Server o Hub senza PowerShell:** l'API REST di DVLS (chiave applicativa, `Search-DSEntry`/`Get-DSEntry`) e quella di Hub (`Get-HubEntry`). Serve solo se il modulo non va bene in azienda, per esempio per le licenze o le policy.
- **Creare una voce** dall'isola (`New-RDMSession` e `Set-RDMSession`) con i campi base. Le modifiche complesse restano nella finestra di RDM («Modifica in RDM»).
- **Strumento per la chat:** «apri il server di Rossi» con le stesse regole di `run_quick_action` (Consenti / Nega).
- **Associazione esplicita** fra un cliente di 3CX o un'organizzazione di Zammad e una cartella di RDM, se la ricerca per nome non basta.
- Da non fare: legare RDM a «davanti al cliente»; leggere le password o i campi sensibili.

## Spunti dall'app originale (letta l'8 ottobre 2026, versione Windows/Linux 0.2.0)
1. Lo stesso schema del plugin di opencode vale per **Amp** e **Hermes**.
2. **Limiti di Codex** (fatti quelli di Claude il 9 ottobre): Coucou chiede `account/rateLimits/read` a `codex app-server` (`codex_plan.rs`).
3. **Riepilogo settimanale come immagine** da condividere (fatto il riepilogo il 9 ottobre): in Coucou `recap/share.ts`, con «Nascondi i nomi dei progetti».
4. **GitHub:** PR con CI e revisioni, avvisi CI rossa/verde, griglia dei contributi. Da noi «GitHub rinnovato» era escluso.

### Riletto il 15 ottobre 2026 (Windows/Linux 0.5.0, Mac 0.4.0): da scegliere con Edoardo
- **Nuovo aspetto delle Impostazioni:** è il consigliato. Coucou ha una finestra unica (`windows/src/hub/`):
  - in ogni pagina un'intestazione con titolo, sottotitolo e personaggi animati su nero con particelle (`hero.ts`), un colore per pagina;
  - sezioni a riquadri con righe «titolo + descrizione a sinistra, comando a destra».
  Le opzioni sono quasi le nostre: cambia la presentazione.
- **Note delle chiamate (Notetaker):** la registrazione c'è dal 16 ottobre 2026 (`integrazioni.md` → Registra); manca il resto. Registra il microfono e l'audio del PC, senza bot. Ne esce la trascrizione per persona, con riassunto, punti chiave e cose da fare; l'audio poi si cancella. Per noi: chiamate 3CX e riunioni, da allegare a un ticket Zammad o a Notion. Servono il riconoscimento vocale e l'avviso a chi è in chiamata.
- **Dettatura ovunque (Flow):** tieni premuto un tasto, parli, il testo si incolla. Con dizionario, testi rapidi, stili per programma e statistiche. Il riconoscimento è locale: Parakeet con sherpa-onnx, circa 700 MB, italiano compreso. Condivide il riconoscimento con le note. In alternativa c'è la dettatura di Windows (`Win+H`).
- **Opzioni piccole:**
  - quanto tenere la cronologia (7 giorni, 30, un anno, per sempre);
  - «ripristina i valori predefiniti» per pagina;
  - aprire le Impostazioni quando EasyIsland si avvia a mano.
- **Lasciati fuori per ora:**
  - «OK Coucou», i comandi a voce: c'è già la chat, e un microfono sempre in ascolto in ufficio è delicato;
  - l'app Android con un server in rete;
  - i suoni da file: i nostri sono sintetizzati per scelta.

## Proposte al momento giusto (annotate il 13 ottobre 2026)
Fatte il 14 ottobre 2026: download finito, errore copiato, server di sviluppo partito, password e chiavi tolte dagli appunti dopo 30 s (`strumenti.md`), riepilogo del mattino e di fine giornata, EasyIsland come server MCP per Claude Code (`agenti.md`). Possibili seguiti: «Chiudi il programma» sulla porta occupata (oggi solo chi la tiene), la cartella del progetto nella card del server di sviluppo (servirebbe leggere la riga di comando del processo).
- **Dettatura ripulita:** tieni premuta una scorciatoia, parli anche male, nel campo arriva la frase pulita. Vuole riconoscimento vocale: un modello locale da ~200 MB o un servizio esterno; per ora no.
- **Personaggio che cresce con l'uso:** gioco e timer sono esclusi (`decisioni.md`); resta solo la domanda già aperta del personaggio che esce dall'isola e vive sul desktop.

## Automazioni più intelligenti (ragionate il 14 ottobre 2026)
Fatti il 15 ottobre 2026 i punti 1, 2 e 3 (`integrazioni.md` → Automazioni); il 24 ottobre il 4 (aspetta, chiedi prima, ferma dopo un errore), il 5 c'era già (`create_automation`), il 6 sostituito dal passo «Avvia un compito», il 7 con le proposte solo a routine, «Prova ora», registro e «spegni». Restano fuori: «N minuti prima di un evento del calendario», «fine giornata» come evento a sé (oggi è un orario), «nessun agente al lavoro» come condizione (Rust non tiene lo stato delle sessioni), chiamata 3CX finita. Restano da fare 4–7. Il testo originale:
1. **Dati del «quando» nei passi:** `{file}`, `{cartella}`, `{rete}`, `{programma}`, `{ticket}`, `{chiamante}` dentro link, azioni rapide e domande alla chat (es. nuovo file in una cartella → «Chiedi alla chat di riassumere {file}»). Serve un segnaposto sicuro: nei link codificato, negli script solo come argomento, mai incollato nel comando.
2. **«Quando» nuovi**, dagli eventi che l'isola già vede: download finito, server di sviluppo partito, agente che ha finito o aspetta un permesso da N minuti, chiamata 3CX in arrivo o finita, N minuti prima di un evento del calendario, fine giornata (`eveningHour`), rientro dopo una pausa (inattività).
3. **«Se» più ricchi**, anche più d'uno insieme: fascia oraria e giorni, rete Wi-Fi, alimentazione o batteria, programma aperto, in riunione (microfono/webcam), davanti al cliente, nessun agente al lavoro. Più «al massimo una volta al giorno / ogni N minuti» contro le ripetizioni.
4. **Passi più flessibili:** «aspetta N minuti», «chiedi prima» (card con Esegui/Annulla e conto alla rovescia di pochi secondi per i passi che disturbano), «ferma se il passo prima non è riuscito».
5. **Crea a parole:** «ogni lunedì alle 9 apri Teams e la bacheca dei ticket» → la chat produce la regola, `automations::validate` la controlla, l'utente vede l'anteprima e la crea con un clic. Nessun passo nuovo per il modello: usa solo quelli esistenti.
6. **Decide la chat (passo «valuta»):** il modello legge l'evento (ticket, email, errore) e sceglie fra rami preparati dall'utente («se è urgente → avviso rosso e apri il ticket, altrimenti niente»). Solo scelte fra passi già approvati; mai inviare email, eseguire comandi o eliminare.
7. **Impara dall'uso:** le abitudini (`habits.rs`) propongono anche dai nuovi eventi (es. ogni PDF scaricato viene aperto subito); un'automazione annullata o ignorata spesso propone di spegnersi o cambiare orario; nel registro, quante volte è partita e quante annullata. «Prova ora» per vedere cosa farebbe senza aspettare il «quando».
Proposta di partenza: 1 + 2 + 3 (più utili, nessun modello coinvolto), poi 5, poi 6.

## La giornata di oggi e domani (chiesta da Edoardo il 18 ottobre 2026, priorità alta)
Un riassunto amichevole, fatto dall'IA, di tutte le integrazioni (Notion, Outlook, ticket, meteo…) per oggi o per domani: da solo al mattino e alla sera agli orari scelti nelle Impostazioni, e a richiesta dalla chat, dalla barra di ricerca, da Telegram e dalle azioni rapide.
- **Fatto (19 ottobre 2026):** `/oggi` e `/domani` su Telegram (`docs/integrazioni.md`). Dalla chat e dalle azioni rapide va già una domanda a parole («com'è la mia giornata?») con un motore che ha gli strumenti.
- **Da fare:** la stessa domanda dalla barra di ricerca e come voce delle azioni rapide; il riepilogo del giorno che c'è (`daily.rs`: repository, PR, tempo degli agenti, alle ore di `dailyRecap`) con in più il testo dell'IA sulle integrazioni, quando un motore con strumenti è pronto; la stessa cosa mandata su Telegram all'ora scelta. Attenzione al costo: un turno con strumenti a ogni riepilogo.

## Strumenti di EasyIsland per gli altri motori via API (valutato il 19 ottobre 2026)
Fatto per Anthropic con chiave (`docs/chat.md`); opencode li aveva già. Restano senza strumenti OpenRouter, OpenAI, Gemini, Ollama e LM Studio (`openai.rs`), salvo la Modalità terminale che li fa passare da opencode. Per farlo: stesso elenco (`hook/src/tool_list.rs`) come `tools`, le chiamate ricomposte dallo stream (`tool_calls`), il ciclo come in `claude.rs`; molti modelli locali o gratuiti non usano bene gli strumenti, quindi ripiego senza quando il modello li rifiuta (400) e un'opzione per spegnerli. Edoardo ha scelto il 19 ottobre 2026 di non farlo per ora.

## Resoconti e preventivi con carta intestata (annotata il 21 ottobre 2026)
- **Carta intestata = un Word dell'utente:** in Impostazioni uno o più `.docx`/`.dotx` (es. «Preventivo», «Resoconto intervento»), copiati in AppData e mai modificati. Si possono mettere segnaposto: `{cliente}`, `{data}`, `{numero}`, `{corpo}`.
- **Strumento `create_document`:** l'IA passa il modello, il titolo, il cliente e le sezioni. L'app copia il modello senza toccare intestazione e piè di pagina e riempie il corpo o i segnaposto. Il risultato va nella cartella di lavoro e nel Vassoio, con Consenti / Nega.
- **Il docx si fa senza nuove dipendenze:** è uno ZIP di XML, come per lo strumento ZIP.
- **Preventivi:** l'IA passa solo le righe (descrizione, quantità, prezzo, IVA). Totali e IVA li calcola l'app, così l'IA non sbaglia i conti. Il numero progressivo lo tiene l'app.
- **PDF:** con Word installato, conversione automatica senza aprirlo. Senza Word resta il `.docx`.
- **Esclusi:** un editor di documenti nell'app e un generatore PDF fatto in casa.

## Recapiti tra due EasyIsland (ragionata con Edoardo il 25 ottobre 2026, da valutare)
Edoardo usa due PC: casa (sempre acceso) e notebook di lavoro (acceso in ufficio e dai clienti), con **due account Claude diversi**. Vuole che uno lavori per l'altro senza mischiare le memorie. Esempio: di notte il PC di casa raccoglie schede tecniche e guide dei prodotti UniFi, e il risultato finisce nel notebook, non nella memoria di casa.
- **Idea:** un compito con «consegna a: l'altro PC». Chi lo esegue non scrive nella propria memoria ma in una cartella a parte, che diventa un **pacco** (pagine .md, PDF, riassunto). L'altro PC, appena raggiungibile, lo ritira nella sua `da-leggere`: lo impara il suo motore con il suo account («Leggi adesso» o di notte). Mai memoria, chat o chiavi condivise: solo documenti, come se li avesse trascinati l'utente. Avviso nell'isola: «Pacco da casa: UniFi, 143 documenti».
- **Bidirezionale** (scelta di Edoardo): ognuno dei due può chiedere un compito all'altro e riceverne il pacco. Il collegamento sa fare solo due cose: consegnare documenti in `da-leggere` e chiedere di avviare un compito (che l'altro PC mostra e, se non è tra quelli consentiti, chiede di approvare). Mai comandi, mai lettura dei dati dell'altro.
- **Vincoli di Edoardo:** **niente VPN e niente cloud.** Da ragionare come si raggiungono i due PC:
  - *Inoltro di una porta sul router di casa* (anche automatico con UPnP, se il router lo permette): casa fa da piccolo server con TLS e chiave dell'abbinamento; il notebook ritira da ovunque. Il notebook non è raggiungibile da fuori, quindi «casa → notebook» funziona come ritiro (il notebook chiede), «notebook → casa» come invio diretto. Serve un nome o l'IP pubblico di casa (DNS dinamico se cambia). Rischio: una porta aperta su internet, da tenere al minimo (solo i due endpoint, chiave obbligatoria, limiti di frequenza).
  - *Telegram come postino* (già configurato da Edoardo): segnali e pacchi piccoli attraverso il suo bot; passa da un servizio di terzi, e i file grandi vanno spezzati (limite 50 MB per file del bot). Da capire se per Edoardo conta come «cloud».
  - *Stessa rete*: quando il notebook è a casa, consegna diretta in LAN (scoperta automatica, nessuna configurazione). Copre i casi in cui il notebook torna a casa la sera.
  - Il «buco» nel NAT (hole punching) senza server non è affidabile: serve sempre un punto d'incontro, quindi escluso.
- **Sicurezza:** abbinamento una volta sola con un codice mostrato su un PC e scritto sull'altro; chiave in Gestione credenziali; pacchi firmati e cifrati; un pacco non può contenere eseguibili né finire fuori da `da-leggere`.
- **Costi e account:** il lavoro pesante lo paga l'account che lo esegue. Compiti lunghi (un catalogo intero) a passi e con un limite di pagine, meglio di notte e con un motore gratuito o locale.

## Flussi: automazioni e compiti in un solo sistema a nodi (decisa con Edoardo il 25 ottobre 2026, da fare)
Spunto dagli strumenti a nodi e dai costruttori di agenti a grafo: passi fissi dove bastano, il modello solo nei nodi dove serve giudizio. Edoardo ha scelto di **unire** automazioni e compiti e di avere un **editor visivo modificabile**.
- **Nodi:** Innesco (i «Quando» di oggi, Telegram, orario, a mano), Azione (l'elenco fisso di oggi: programmi, azioni rapide, tasti, integrazioni, Notion, To Do, card), Agente (un compito: obiettivo, motore, strumenti, limiti; il risultato va nello stato), Decisione (condizione, oppure il modello sceglie fra rami con un nome: riapre l'esclusione del passo «valuta» del 24 ottobre), Chiedi a me (card o Telegram, si riprende anche dopo un riavvio), Aspetta, Per ogni elemento.
- **Stato condiviso** fra i nodi con segnaposto (`{{agente1.risultato}}`), salvato a ogni nodo per riprendere; registro di ogni esecuzione con entrate e uscite di ogni nodo e «Riprendi da qui», in `%APPDATA%\EasyIslandlussi\`.
- **Creazione:** a parole in chat (`flow_create`, anteprima = conferma) e nell'editor visivo in Impostazioni, disegnato in Canvas senza librerie.
- **Sicurezza invariata:** niente nodi con codice; i nodi Agente hanno gli strumenti e i permessi della chat.
- **Migrazione:** automazioni e compiti esistenti diventano flussi automaticamente; niente si perde.
- **Ordine:** 1) motore in Rust (grafo, stato, ripresa) con la conversione; 2) creazione dalla chat e vista con le esecuzioni; 3) editor modificabile; 4) Decisione col modello e Per ogni elemento.
- **Rischi da tenere d'occhio:** le proposte dalle abitudini e i compiti «semplici» devono restare semplici (un flusso di un nodo non deve sembrare un diagramma); l'editor su schermi piccoli; non rompere le automazioni di chi aggiorna.

## Memoria: dopo riassunti, alias e secondo passo (26 ottobre 2026)
Fatti riassunto e alias delle pagine e il secondo passo sui legami forti (`docs/chat.md` → Ricerca che segue i collegamenti). Restano:
- **Pulizia proposta:** il controllo (`brain::check`) segnala anche le pagine doppie (stessi alias, titoli simili, molte parole in comune) e le relazioni ripetute con nomi diversi («usa UniFi» e «usa Ubiquiti»); il compito di controllo propone «unisci» con `task_ask` e fa solo ciò che l'utente approva (la pagina unita resta in archivio). Utile quando la memoria cresce.
- **Ricerca per significato:** embedding delle pagine e delle note, per trovare ciò che non ha parole in comune con la domanda. Vuole un modello locale (una dipendenza) o un servizio (costo, note fuori dal PC): solo se la memoria diventa grande (molti PDF), e con la scelta in Impostazioni come il motore per la memoria.

## Modello integrato: un modello locale senza Ollama né LM Studio (scelto da Edoardo il 27 ottobre 2026; accantonato lo stesso giorno)
**Stato:** fatto nel codice nel branch `claude/modello-integrato` (non unito; i passi e cosa manca sono in `docs/modello-integrato.md` di quel branch): manca la prova dal vivo. Differenza da quanto scritto qui sotto: il motore non sta nell'installer, si scarica con il primo modello. Per riprendere il lavoro: aggiornare il branch con `claude/sviluppo`, controllare che la build di llama.cpp e gli hash dei modelli siano ancora quelli giusti, fare la prova dal vivo. Valutato anche: gli strumenti di EasyIsland in `openai.rs`, per renderlo agentico.
Un motore della chat «Modello integrato» che fa girare un modello sul PC senza che l'utente installi altro.
- **Come:** `llama-server.exe` di llama.cpp nell'installer (versione CPU + Vulkan, ~10–30 MB), avviato nascosto dall'app su una porta locale solo quando la chat lo usa e spento dopo qualche minuto senza richieste. Parla l'API compatibile con OpenAI, quindi si riusa `openai.rs` (streaming, «Carica modelli», ragionamento nascosto) com'è. Ollama e LM Studio restano per chi li ha.
- **Perché non dentro il processo:** una libreria che compila llama.cpp in EasyIsland porterebbe la memoria del modello nell'isola e un crash del C++ la chiuderebbe; build MSVC più lenta. candle / mistral.rs (Rust puro) su Windows sono più lenti e reggono meno schede video. L'IA di Windows (Phi Silica) c'è solo sui PC Copilot+.
- **Modelli:** non nell'installer (1–5 GB, GGUF). In Impostazioni → Chat un elenco breve di modelli consigliati (3–8 miliardi di parametri, italiano compreso) con dimensione e «Scarica»: il download parte solo dopo il clic (regola sulle chiamate di rete), in `%LOCALAPPDATA%\EasyIsland\models`, con verifica dello SHA-256 e possibilità di eliminarlo. Anche un GGUF già sul disco scelto dall'utente.
- **Vincoli:** CPU ~0 % a isola ritirata (processo spento quando non serve); su CPU 5–15 parole al secondo, molto meglio con una scheda video; i modelli piccoli sbagliano spesso con gli strumenti e la Modalità terminale, quindi va presentato per chat e privacy («nulla esce dal PC»), non per l'agente. Il processo figlio si chiude con l'app (job object di Windows) anche se l'app cade.
- **Utile anche per:** il motore per la memoria e, in futuro, gli embedding della ricerca per significato (sezione Memoria qui sopra).

## Altro
- **Scheda esatta di Windows Terminal** per «Apri»: il relay legge il titolo della console e l'app seleziona la scheda con UI Automation. Da sperimentare con una sessione vera. Tolta dal Da fare il 9 ottobre: per ora non serve.
- **Clic destro sui file in Esplora file** (prossimo passo, deciso l'11 ottobre 2026): una voce nel registro di Windows (`HKCU\Software\Classes\*\shell`) che passa il percorso all'app, scritta solo dopo la conferma di Edoardo. In Windows 11 finisce sotto «Mostra altre opzioni» (il menu nuovo vuole un pacchetto MSIX con `IExplorerCommand`). Per il testo selezionato c'è già il menu di `Win+Alt+A`.
- **Da decidere prima di farle**, perché vanno contro `decisioni.md`: nuovi personaggi (polpo, rana, granchio, geco). Le prove dell'8 ottobre sono venute male: rimandati. Rimandate anche le pose di Goccia della tavola del 3 ottobre (saluto con la mano, salto, caduta, onda): oggi usa quelle comuni.
- **opencode, ancora aperti:**
  - nella **chat** lo strumento `question` è negato (`opencode.rs`): la card c'è già per l'agente (`opencode_agent.rs`, form), si può riusare;
  - il menu dei motori non controlla se Ollama/LM Studio rispondono.
- **Decisioni aperte:**
  - firma del codice (Authenticode o Azure Trusted Signing)
  - tag `windows-latest` sul repo, creato per sbaglio
  - funzioni del Mac mai portate (invio di un file per email, personaggio trascinato su una finestra per allegarla)
- **Idee da valutare:** TeamViewer come integrazione (annotata il 16 ottobre 2026, senza dettagli: da chiarire con Edoardo cosa serve); libreria di comandi PowerShell/cmd con conferma; casa (promemoria, Home Assistant); integrazioni proposte il 2 ottobre (Windows Update, stampanti bloccate, Teams, Docker, Git locali, WSL, IMAP, DNS/blacklist, pagine di stato, CISA KEV, RSS, ntfy (Telegram fatto: `docs/integrazioni.md`), Uptime Kuma, Proxmox, Synology/TrueNAS, UniFi, Pi-hole, GLPI).

## Pulizia del codice (solo quando si tocca quel file)
- `mmss` è duplicato in `src/views/integrations.ts` (secondi) e `src/views/threecx.ts` (millisecondi); anche il «Copiato ✓» temporaneo è ripetuto in più viste.
- File molto lunghi da spezzare solo se si lavora lì: `src/settings/main.ts` (~2.770 righe), `src/island/island.ts` (~2.060), `src/character/engine.ts`, `src-tauri/src/lib.rs`.
