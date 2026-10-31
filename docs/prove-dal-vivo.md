# Da provare dal vivo

Funzioni verificate finora solo con i test o nell'anteprima del browser. Togli una voce quando è provata, e annota in `HANDOFF.md` ciò che non va.

- [ ] **La giornata con l'IA e su Telegram (31 ottobre 2026):** scegliere «Riassunto dell'IA» (il motore della chat) e «Anche su Telegram», poi:
  1. alle 8 (o mettendo «Fine giornata alle» all'ora dopo): la card con «La giornata di oggi» scritta dal motore e il messaggio su Telegram con il tempo degli agenti, anche a isola chiusa;
  2. riavviare l'app dopo l'ora: niente secondo messaggio;
  3. PC sospeso alle 8 e riacceso alle 9: il riepilogo arriva entro mezz'ora;
  4. un motore senza strumenti (Ollama senza modalità terminale): cosa scrive, e «Riprova» se fallisce;
  5. «Mostra ora» senza riassunto: «Chiedi il riassunto all'IA».
- [ ] **Ricerca ovunque nel campo in alto (31 ottobre 2026):**
  1. il nome di un cliente: la sua pagina della memoria (clic: la mappa si apre con la pagina scelta, anche se era già aperta), una conversazione passata (clic: torna nella chat), i suoi ticket Zammad (clic: il ticket nel browser);
  2. Zammad: dire se il vostro server ha Elasticsearch, e se senza trova solo per titolo e numero;
  3. scrivere veloce non deve bloccare il campo; con Zammad spento non parte nessuna chiamata.
- [ ] **Permessi per livelli (31 ottobre 2026):** con l'app vera e Notion / Outlook classico:
  1. in chat «aggiungi a To Do: chiamare Rossi»: card leggibile con «Sempre»; scelto «Sempre», la volta dopo nessuna card, e la voce in Impostazioni → Chat → Permessi degli strumenti (✕ la toglie);
  2. «Cosa ho fatto»: la voce con «senza chiedere», poi Annulla (l'attività sparisce da To Do, va in Posta eliminata);
  3. Notion: una riga aggiunta e annullata (nel cestino), una riga cambiata e annullata (valori di prima, anche select e date);
  4. Vassoio e cartella di lavoro: un file spostato e annullato torna nel Vassoio, una copia annullata va nel Cestino;
  5. un compito con «Senza chiedere: Aggiungere attività a To Do» che lo fa di notte senza card, e un altro senza che chiede;
  6. Telegram: un reversibile consentito passa senza pulsanti, `notion_delete_row` chiede anche con «Automatica»;
  7. Telegram: un reversibile non ancora consentito ha ♾ Sempre; toccato, passa e la volta dopo non chiede più (voce in Impostazioni → Chat);
  8. nell'isola: dopo un'azione senza chiedere compare «Fatto senza chiedere» con Annulla; «cosa ho fatto» nel campo in alto apre l'elenco, e Annulla lì aggiorna anche quello delle Impostazioni.
- Motore per la memoria: scegliere un motore gratuito (OpenRouter) e uno locale (Ollama), «Collega con l'IA» nella mappa, controllare le pagine-argomento create e che nessuna nota sia cambiata; che scriva `riassunto:` e `alias:` sensati e che la chat trovi una pagina dal suo alias.
- [ ] **Integrazioni personali (23 ottobre 2026):** provati nell'anteprima modulo, righe, calcoli e modello compilato. Restano con l'app vera:
  1. in chat «crea un'integrazione per i preventivi…»: la card di Consenti con la descrizione, poi la voce nel menu;
  2. Salva, poi la scheda in «Salvate», Duplica, Elimina;
  3. «Crea il documento»: l'HTML nel Vassoio, aperto e stampato in PDF;
  4. un'azione «chiedi alla chat», una Notion e una con un'azione rapida;
  5. in chat «aggiungi un campo …» (custom_update) e «quanti preventivi ho fatto a ottobre?» (custom_records);
  6. numerazione: due preventivi salvati di fila (001, 002), poi un duplicato che prende il numero nuovo;
  7. «Compila con l'IA» da una mail vera di un cliente; «Esporta CSV» aperto in Excel; un campo `link` verso un'integrazione «Clienti»;
  8. provato qui il 23 ottobre: una fonte letta da sola dal ciclo in Rust (API pubblica di GitHub, HTTP 200). Restano: un'integrazione con chiave (`{{secret:token}}` inserito nelle Impostazioni) verso un servizio vero, un'azione `http` POST con `store`, un avviso di una fonte, `custom_call` dalla chat.

- [ ] **Compiti (23 ottobre 2026):** provato qui un compito da cima a fondo con l'abbonamento (piano, strumenti, passi, risultato). Restano:
  1. una domanda (`task_ask`) con la card vera: risposta a un pulsante, risposta scritta, e nessuna risposta (il compito va in «Attende te», poi Rispondi in Impostazioni → Flussi);
  2. un permesso (es. `notion_add_row`) chiesto da un compito con l'isola chiusa;
  3. Pausa, Ferma e Riprendi mentre lavora; un compito a orario e uno ogni giorno;
  4. `/compito` dalla chat e da Telegram, l'avviso su Telegram alla fine; il passo «Avvia un compito» di un'automazione;
  5. un compito con opencode e uno con la chiave API;
  6. il Battito acceso dalle Impostazioni con un elenco vero in BATTITO.md (ticket, mail): una volta con qualcosa da segnalare, una senza;
  7. un compito che a fine lavoro propone una nuova abilità (Consenti / Nega di `skill_save`);
  8. con Telegram collegato: un permesso di un compito risposto da Telegram (la card dell'isola deve sparire), una domanda risposta con il pulsante e una con `/rispondi`;
  9. il Riordino della memoria acceso, una sera con conversazioni: la domanda con le note proposte e le note salvate in MEMORIA.md;
  10. un'abilità usata su Telegram con `/nome …`.

- [ ] **Secondo cervello (24 ottobre 2026):**
  1. Impostazioni → Chat → Memoria → «Mappa»: la finestra si apre (non bianca), le quattro viste con la memoria vera.
  2. Un .txt e un .html in `memoria\da-leggere`, «Leggi adesso»: pagine scritte con `fonte:` e `[[collegamenti]]`, file spostati in `fonti`.
  3. Una pagina modificata a mano mentre l'agente lavora: la sua scrittura rifiutata e ripetuta dopo averla riletta.
  4. «Controlla»: proposte nell'isola, fatte solo quelle approvate, niente cancellato.
  5. In chat una domanda su un cliente con una pagina: la risposta usa anche le pagine collegate.
- [ ] **Chat nuova e memoria (21 ottobre 2026):**
  1. Ctrl+V di un'immagine e di un file copiato in Esplora file a conversazione avviata (chip 📎, il motore lo legge).
  2. Un file trascinato sull'isola durante una conversazione non la ricomincia.
  3. Modifica e ↻ Rigenera con Claude Code, opencode e l'API.
  4. `/oggi`, `/ricorda …`, `/esporta`, un'azione rapida da `/`.
  5. «Istruzioni» diverse in due profili.
  6. `/riprendi` su Telegram.
  7. Del 22 ottobre:
     - 🎤 con e senza servizio dei Vocali: il microfono nella finestra di WebView2 può chiedere il permesso;
     - `@appunti`, `@finestra`, `@vassoio`;
     - un'azione «prompt» con `{{campi}}`;
     - ⑂ Dirama da qui;
     - un assistente con un motore diverso.
  8. Dopo qualche giorno: `diario/` con le righe, note salvate da sole con `memory_note`, e una domanda «come avevamo fatto con…» che usa `memory_search`.

- [ ] **Proposte al momento giusto (0.7.9):** provati qui dal vivo il 14 ottobre, dal log e con le card di MCP sullo schermo: download (rinomina da `.crdownload`), server Python sulla porta 8765, traceback copiato, chiave `ghp_` tolta dopo 30 s, `show_card` con e senza pulsanti, `add_to_tray`. Da provare: download veri da Edge, Chrome e Firefox (anche grandi), «Spiega e correggi» fino alla risposta, «Apri nel browser» su `npm run dev`, una password da un gestore di password; riepilogo del mattino dalle 8 e di fine giornata dalle 18 con pull request vere; Impostazioni → Agenti → «Strumenti di EasyIsland in Claude Code» → Aggiungi, poi `show_card` da una sessione nel terminale.
- [ ] **Rinnovo dell'accesso di Claude Code (14 ottobre 2026):** alla scadenza di `.credentials.json` (ogni ~8 ore) con la card Consumo accesa, il log deve dire «limiti del piano: accesso di Claude Code rinnovato» e poi «limiti del piano da Anthropic: ok», senza finestre e senza processi `claude` rimasti; «Aggiorna» con l'accesso scaduto deve rinnovare subito.
- [ ] **Rete: ping e impostazioni (14 ottobre 2026):** Ping continuo su Gateway, 8.8.8.8 e un nome scritto (si apre un terminale con `ping -t`); «Modifica rete…»: passare una scheda a indirizzo manuale e tornare a DHCP, DNS manuali e automatici, «No» sulla richiesta di amministratore (messaggio «Annullato»), un gateway fuori rete (errore prima di Windows). Dopo «Applica» la card deve mostrare i dati nuovi.
- [ ] **Azioni rapide:** «Programma» con `chrome`, `regedit`, un percorso tra virgolette e `%ProgramFiles%`; Salva / Annulla e ordine delle cartelle nella finestra vera.
- [ ] **Selezione e suggerimenti ⚡:** Ctrl+C reale in Excel, Outlook e browser, con il ripristino degli appunti: un'immagine o dei file copiati prima tornano negli appunti.
- [ ] **Avvio (0.7.5):** su un altro PC, aggiornamento dalla 0.7.4 col clic nell'isola (l'app riparte da sola) e avvio automatico subito dopo un riavvio di Windows; nel log nessuna riga `panic:`.
- [ ] **Trascinamento del personaggio della chat (0.7.4):** un trascinamento veloce e uno lento oltre il tempo di chiusura: l'isola resta aperta finché lo lasci. Aprendo una scheda di integrazione e chiudendo l'isola, il personaggio compatto ha il suo colore.
- [ ] **Tempo sui permessi:** la card di un permesso vero di Claude Code dice «attende ancora 1:47» e scende; dopo «Più tardi» e riapertura il tempo è andato avanti; a zero la card sparisce e si risponde nel terminale.
- [ ] **Consumo Claude:** il messaggio di limite raggiunto non è mai comparso.
- [ ] **Automazioni con contesto (0.8.4):** un download di un PDF con «Solo se .pdf» e «Chiedi alla chat: Riassumi {percorso}»; «Quando torni al PC dopo una pausa» di 5 minuti; «agente ha finito» con un progetto nel filtro; «se non in riunione» con Teams in chiamata (non deve partire); «al massimo ogni 30 minuti». Un download di un `.exe` con «Apri {percorso}» deve dare errore nel registro, non aprirlo.
- [ ] **Impostazioni sopra l'isola (0.8.4):** con l'isola aperta in alto, le Impostazioni le stanno sopra mentre sono attive; cliccando un altro programma tornano normali e l'isola resta sopra di loro.
- [ ] **Barra dell'app in uso:** senza azioni «Nella barra con» non compare nulla; un'azione Tasti «Ctrl+T» per chrome.exe apre una scheda; «Ctrl+L, "https://example.com", Invio» apre il sito; «Riassumi la pagina» (tutto il testo della finestra) arriva alla chat; Solo icona / Solo testo; con un agente al lavoro e Chrome davanti si vede la barra; «Solo nella barra» toglie l'azione dalla scheda ⚡.
- [ ] **Menu contestuale dell'isola:** clic destro su un'integrazione nel menu e su un riquadro della Panoramica → «Impostazioni «nome»» apre le Impostazioni su quella riga, aperta; nessun menu di WebView2 da nessuna parte; nei campi di testo resta Incolla; il menu vicino al bordo dell'isola resta cliccabile.
- [ ] **Teams (locale):** in una riunione vera la card dice «In riunione» entro pochi secondi; Microfono, Video, Alza la mano, Condividi ed Esci dalla card e dalla striscia arrivano a Teams anche con un altro programma davanti; con Teams in un'altra finestra (chat) i tasti vanno a quella della riunione; «Partecipa dal link copiato» con un link di invito; automazione «inizia una riunione» → avviso.
- [ ] **Account Microsoft (API):** registrare l'app in Entra come dice la guida nelle Impostazioni; «Accedi con Microsoft» torna con «Collegato: nome»; la card di Outlook mostra non lette e appuntamenti anche con Outlook chiuso; la card di Teams mostra lo stato e «Partecipa» su una riunione di oggi; con un account aziendale che blocca il consenso, il messaggio dice di chiedere all'IT; «Esci» e riavvio: niente più dati da Graph.
- [ ] **Registra:** una chiamata Teams o 3CX con microfono e audio del PC (si sentono entrambe le parti, in sincrono); lo schermo con audio per qualche minuto (video fluido, cursore visibile, audio allineato); il punto rosso con Stop sempre accanto al personaggio; la card alla fine con Nel Vassoio; durante la registrazione «davanti al cliente» non scatta per colpa nostra; uno schermo 4K esce a 1920 px. In File e schermo: trascinare il personaggio su una finestra la sceglie; «Registra la finestra» con la finestra poi coperta da un'altra (il video la mostra comunque); spostarla durante la registrazione; chiuderla (il file resta); «Foto nel Vassoio».
- [ ] **Agente e automazioni:** card Consenti/Nega in una chat vera; ogni tipo di «Quando» e «Prova ora»; proposte dalle abitudini (servono settimane con `habitsEnabled`).
- [ ] **Altri motori della chat** con chiavi vere e Ollama/LM Studio; markdown (Copia, link).
- [ ] **Appunti e Media** (Ctrl+V, immagini da varie app, Spotify/browser), **Riquadra e chiedi** (vedi sotto), **calcolatrice**, **ZIP** veri.
- [ ] **Widget:** script del certificato TLS, calendario ICS reale. **«Davanti al cliente»** con Teams e assistenza remota veri.
- [ ] **Isola:** Start aperto con «Sopra la barra» (il personaggio deve tornare davanti).
- [ ] **Limiti del piano:** con la card Consumo attiva e solo l'app desktop di Claude, le percentuali arrivano entro 5 minuti (log «limiti del piano da Anthropic: ok») e compaiono nell'intestazione dell'isola; il clic apre la card; «Solo nella card» le toglie. Dopo «Aggiorna» degli hook, una status line propria resta uguale nel terminale e torna disinstallando.
- [ ] **Riepilogo settimanale:** lunedì 12 ottobre dalle 8 la card si apre da sola una volta; «Mostra ora» dalle Impostazioni e dal menu dell'area di notifica.
- [ ] **Lingua inglese:** Generale → Lingua → English, «Riavvia ora»: isola, impostazioni, menu dell'icona, card delle integrazioni e risposte della chat in inglese.
- [ ] **📌 «Tieni aperta» come finestra normale:** icona nella barra e in Alt+Tab, un'altra finestra le va sopra, clic sull'icona riduce e riporta; permesso con l'isola coperta → l'icona lampeggia; togliendo il 📌 o con ✕/Esc torna sempre davanti e sparisce dalla barra. Anche con «Sopra la barra» acceso.
- [ ] **«Continua» dalla card «finito»:** Claude Code in Windows Terminal e nel terminale di VS Code (il testo arriva e parte); estensione di VS Code (si apre la sessione con il testo scritto); opencode 2 (il messaggio parte dal servizio). Testo con accenti.
- [ ] **«Chiedi a questa sessione»** su una sessione vera di terminale e una dell'app Claude: la risposta conosce la sessione e la sessione non cambia.
- [ ] **«Sempre» di sessione** su un comando senza proposta di Claude Code: lo stesso comando non chiede più fino alla fine della sessione; **«Più tardi»/Esc** sulla card e riapertura.
- [ ] **Geco, Fiamma, Magma, Pietra, Roccia e Foglia** (Impostazioni → Aspetto): isola ritirata e aperta, la Fiamma che tremola a isola visibile e CPU a riposo a isola ritirata (Gestione attività), icona a riposo, saluto all'avvio, rilascio di un file, schermo con scala 125–150 %.
- [ ] **Standby con l'integrazione Rete** (notebook): dopo il risveglio nessun avviso «Nessuna connessione»; staccando davvero la rete l'avviso arriva entro 15–20 s.
- [ ] **Claude Code solo con gli hook:** sul notebook senza Claude Code nessuna card Claude Code; con «Collega opencode» la scheda Agenti mostra opencode. Qui, installando o togliendo gli hook dalle Impostazioni, la card compare o sparisce senza riavviare.
- [ ] **Saluto all'avvio:** al centro dello schermo (anche su un secondo monitor scelto in «Schermo»), poi il personaggio torna al suo posto; «Dove sta il personaggio»; spento, il personaggio compare senza animazione.
- [ ] **`Ctrl+Space`:** apre e chiude l'isola; controllare che non serva in VS Code (suggerimenti), Excel (seleziona la colonna) o per cambiare lingua della tastiera.
- [ ] **Prezzi dei modelli:** «Carica modelli» con opencode e con OpenRouter, «solo gratuiti».
- [ ] **Cronologia delle chat:** una conversazione per motore (abbonamento, API, opencode, uno compatibile OpenAI) riaperta dall'orologio continua con il contesto di prima; dopo un riavvio dell'app; «Cancella la cronologia» e l'interruttore spento.
- [ ] **Personaggio lasciato su una cartella:** su una riga di Esplora file (anche con più schede), sullo sfondo, su un'icona del desktop; il percorso compare nel campo della chat dopo il testo già scritto e il personaggio torna al suo posto. Lasciato su un'altra app o sul desktop vuoto si sposta come prima.
- [ ] **Personaggio della chat lasciato su una finestra:** dalla scheda Chat su Chrome, Outlook, Excel, VS Code, Esplora file e una finestra coperta in parte: il personaggio diventa il puntatore (anche fuori dall'isola) e cambia faccia (sorpreso, contento sopra una finestra), il chip dice la finestra giusta, al rilascio compare la miniatura e la risposta parla della finestra, con ogni motore. Esc e rilascio sull'isola non allegano niente; l'isola non si chiude durante il trascinamento. Schermo con scala 125–150 % e secondo monitor.
- [ ] **Menu sul testo selezionato (`Win+Alt+A`):** in Outlook (mail in scrittura), Chrome/Edge (campo di testo e pagina), Word, Blocco note: il menu compare al mouse, si chiude cliccando fuori, la voce scelta arriva all'isola. `Win+Alt+A` non è già preso da Windows o da altre app.
- [ ] **Notion (14 ottobre 2026):** scelta del database delle attività (con stato e con casella), spunta «fatto» e riga che sparisce anche in Notion; «+ Nota» in una pagina e in un database; pagine fissate; clic su una pagina della card e della barra in alto → si apre nell'app Notion, non nel browser; ricerca nella card e nella barra; «Chiedi alla chat» su una pagina lunga (testo tagliato a 30.000 caratteri) e su una non condivisa con l'integrazione (messaggio chiaro).
- [ ] **«Sostituisci»:** in Word, Outlook e Gmail una selezione con grassetti, un link e due paragrafi resta formattata con «Sostituisci» e diventa testo semplice con «Senza formattazione»; in Blocco note incolla il testo; il testo nuovo prende il posto della selezione con accenti e a capo giusti; gli appunti tornano come prima; cliccando altrove prima di «Sostituisci» non incolla niente e lo dice. Con ogni motore della chat; con opencode la sessione non resta nella sua cronologia.
- [ ] **Reazioni del personaggio:** sul notebook Rete su «Resta tranquillo»: staccando la rete il personaggio non cambia faccia né suona, la pillola Rete mostra il problema; su «Cambia faccia, in silenzio» cambia faccia senza suono e senza aprirsi. Un agente che finisce con «Ha finito» su «Resta tranquillo»: niente card né suono.
- [ ] **Cartella rilasciata sull'isola:** una o più cartelle da Esplora file; il percorso compare nel campo della chat. Un file continua a entrare nella sequenza del file.
- [ ] **Nuovo impianto dell'isola:** apertura e chiusura (animazione, personaggio che va in cima al menu e torna), menu con molte integrazioni (scorre), trascinamento delle voci, campo in alto con risultati e «Chiedi alla chat», permesso e card «finito» accanto al menu, rilascio file e saluto senza menu, isola sopra la barra e su un secondo schermo, «Personaggio nel menu» e «Fumetto» da Impostazioni.
- [ ] **Personaggio che torna al suo colore:** una risposta di Claude Code interrotta con Esc (dopo circa un minuto torna normale), una sessione di opencode finita, un permesso negato.
- [ ] **Card del Meteo:** dati veri (ore e giorni del posto giusto, alba e tramonto), cielo animato di giorno e di notte, nessun fotogramma a isola chiusa.
- [ ] **Risposte rapide a isola chiusa:** un permesso di Claude Code con l'isola nascosta (compare la striscia, Consenti e Nega arrivano all'agente, l'isola non si apre al passaggio del mouse), una chiamata 3CX su «Questo PC» (Rispondi, poi Muto e Riaggancia), una chiamata su un altro dispositivo (Rifiuta), «A sinistra» con l'isola ancorata a destra, «Spente».
- [ ] **Riquadra e chiedi:** scorciatoia e «File e schermo»; con l'isola aperta (si chiude prima di congelare); su un secondo schermo con un'altra scala; con l'isola sopra la barra delle applicazioni; Esc e tasto destro; domanda con Invio, un'azione rapida, Copia immagine (incollata in Paint), Copia testo, Nel Vassoio; dopo la chiusura l'isola torna al suo posto e lascia passare i clic sul desktop.
- [ ] **3CX «Questo PC» (telefono nel PC):** scelto «Questo PC», il pallino diventa verde (`3cx: webrtc registered true` nel log); chiamata uscente con audio nei due sensi, Muto, toni del tastierino in un risponditore; chiamata in arrivo che squilla sul PC (suoneria predefinita e un MP3), Rispondi, Riaggancia, Rifiuta; risposta da un altro dispositivo che ferma la suoneria; Trasferisci; «Rispondi al suo posto» dal PC; tornando a un altro dispositivo il PC non squilla più. Avviso nell'isola spento: solo il pallino. Durante la chiamata, con «Davanti al cliente» per le riunioni acceso, il personaggio resta (nel log nessun «davanti al cliente: sì (… usa il microfono)»). Se l'audio non passa, il log del centralino e la console della pagina (`softphone:`) dicono a che passo si ferma.
- [ ] **3CX team e chat** (accesso «Interno e password»): elenco dei colleghi e cambi di stato in tempo reale (`3cx: team of N colleagues` nel log); chat con un collega (apertura, invio, messaggio in arrivo con l'isola chiusa e con l'isola aperta, «sta scrivendo», non letti che si azzerano anche leggendo dal telefono); elenco delle chat con gruppi e conversazioni esterne; segreteria con trascrizione e «Ascolta»; In coda / Fuori coda; Trasferisci, Devia (a un collega e in segreteria), Rispondi al suo posto.
- [ ] **Modalità terminale della chat (15 ottobre 2026):** accesa, con la cartella di un progetto.
  - **Claude Code:** «che file ci sono qui?», poi «crea prova.txt con scritto ciao». La card mostra il comando o il file con Consenti/Nega e «Sempre»; i passi «> ⚙ …» compaiono mentre lavora. Il turno dopo continua la conversazione. Nega: la risposta lo dice. Un server MCP dei plugin, per esempio Notion, risponde. Un comando interattivo non resta appeso.
  - **opencode:** lavora nella cartella; «Sempre» su un comando che non è di sola lettura. Aggiungendo un server MCP a `opencode.json`, il turno dopo lo vede (log «opencode: server restarted»).
  - **Altri motori** (API, OpenRouter, Ollama): rispondono con i comandi tramite opencode. Con opencode disinstallato, il messaggio è chiaro.
  - **Spegnendo la modalità** la chat torna come prima, in una conversazione nuova.
  - **⚡ «Automatica»:**
    - Con Claude Code, «crea prova.txt e mostrami git status» va senza card; «cancella la cartella build» si ferma o chiede.
    - Con opencode, `npm run build` va da solo; `Remove-Item` e `git push` mostrano la card.
    - «Nuova chat» lo spegne.
- [ ] **Antigravity (18 ottobre 2026):** installare agy con il comando delle Impostazioni e fare il login; Impostazioni → Chat → Antigravity dice «trovato», «Carica modelli» elenca i modelli. Agenti di codice → Antigravity → Installa: il diff aggiunge solo il gruppo «easyisland». Una sessione di agy: compare la scheda Antigravity, un comando chiede Consenti / Nega nell'isola (Nega lo blocca), una modifica mostra il diff, la fine dà la card «finito». La chat con Antigravity: risposta con i passi, un comando chiede nell'isola, il turno dopo ricorda la conversazione. Controllare i nomi degli argomenti degli strumenti nel log se un passo è senza dettaglio.
- [ ] **Mini Notion (18 ottobre 2026):** con una pagina vera scelta nelle Impostazioni: il riquadro la apre nell'isola con titoli, elenchi, toggle, callout e immagini; scrivere, Invio, «/» → Titolo 2, `- ` all'inizio, Ctrl+B; casella; «Elimina» → «Sicuro?» e il blocco è nel cestino di Notion; ricaricando (↻) tutto è come in Notion. Un database: Bacheca per stato, trascinare una scheda, «+ Nuovo» in una colonna, Tabella con stato e data cambiati, una riga aperta come pagina. Una pagina con un'immagine caricata e con una menzione (sola lettura).
- [ ] **Viste delle attività di Notion (15 ottobre 2026):** in Impostazioni → Notion «+ Oggi», «+ Settimana» e una vista con Contesto «Ufficio» e Priorità «Alta». Nella card i pulsanti cambiano l'elenco subito; la vista scelta resta dopo un riavvio; il pallino ha il colore della priorità; rinominando la vista scelta resta scelta; un filtro su Progetto (relazione) funziona; togliendo tutte le viste tornano tutte le non fatte.
- [ ] **Notion: avvisi e uso semplice (15 ottobre 2026):**
  - Un'attività con orario fra 15 minuti: l'avviso arriva 10 minuti prima (o come scelto), una volta sola, e il clic apre Notion.
  - Un commento nuovo, scritto dal telefono, su una pagina fissata: l'avviso arriva entro 5 minuti.
  - Il mattino dopo le 8, il riepilogo ha «Oggi in Notion».
  - Nella card, «+ Attività» con Oggi e con una vista con Contesto Ufficio: la riga compare in quella vista. «Rimanda a domani» tiene l'ora.
  - `Win+Alt+A` su un testo, «Nota in Notion» e «Attività in Notion».
  - Configurazione rapida togliendo e rimettendo il database delle attività.
- [ ] **Impostazioni → Integrazioni:** gruppi, stato «Manca: chiave», apertura di una sola alla volta, ricerca, «Solo attive», 3CX con i campi che cambiano secondo il tipo di accesso.
- [ ] **Remote Desktop Manager** (predisposto il 15 ottobre 2026), sul PC con RDM:
  1. **Diagnosi:** `cargo test --lib rdm::tests::live -- --ignored --nocapture` dice exe, `rdm://`, pwsh, versione del modulo, origini, numero di connessioni e i tipi trovati. Se un tipo da tenere fuori (credenziali, cartelle) compare con un altro nome, va aggiunto a `is_connection`.
  2. **Impostazioni → Integrazioni → Remote Desktop Manager:** i quattro stati. Senza PowerShell 7 o senza modulo, i comandi da copiare; installarli e premere «Sincronizza». Con l'Hub: le 883 voci del vault utente; chiusa e riaperta l'app, l'elenco c'è ancora senza RDM avviato; il pallino segue RDM aperto o chiuso. Aprire una voce di prova (non un cliente) dal vault utente.
  3. **Origine dati:**
     - «Carica le origini» elenca quelle di RDM; sceglierne un'altra rilegge.
     - Con Devolutions Server o Hub che chiede l'accesso: dopo 120 s il messaggio «non ha risposto in tempo», l'app non si blocca.
     - Il modulo della stessa versione di RDM.
  4. **Card:** ricerca per nome, cliente (cartella) e IP; Invio apre la prima; «Apri» apre in RDM la connessione giusta, nell'origine giusta; Modifica in RDM; Copia indirizzo; puntina; Recenti dopo un'apertura (anche dopo un riavvio).
  5. **Barra in alto:** «rossi» mostra le connessioni RDM e le apre.
  6. **3CX:** chiamata da un cliente con una cartella in RDM → «Connessioni in RDM» → la card con le sue connessioni (anche col nome e cognome di chi chiama).
  7. **Zammad:** un ticket da assegnare mostra « — Organizzazione» e il pulsante RDM. Se `ticket_overviews` non dà Organization/User negli assets, il cliente manca: da vedere nel log.
  8. **`Win+Alt+A`:** su un IP, «Connetti con RDP/SSH» apre una connessione al volo, che non viene salvata; su un nome, «Cerca in Remote Desktop Manager».
  9. **Senza modulo:** la ricerca della card apre RDM con il campo di ricerca già compilato.
  10. **Con un collega su un altro PC:** vede solo le connessioni che vede in RDM.
- [ ] **Telegram** (fatto il 17 ottobre 2026), con un bot vero:
  1. Token da @BotFather salvato, integrazione accesa: le Impostazioni dicono «@bot in ascolto». Token sbagliato: «Token del bot non valido».
  2. «Collega», `/start <codice>` dal telefono: «Collegato». Da un altro account o con il codice scaduto: nessuna risposta o «Codice non valido».
  3. Una domanda: «…» che si aggiorna mentre scrive, poi la risposta formattata; una risposta lunga in più messaggi. Avviso «Telegram» nell'isola, conversazione «Telegram · …» nella cronologia, chat dell'isola intatta.
  4. `/motore` e `/modello` con i pulsanti, `/modello nome`, `/nuova`, `/stato`.
  5. Modalità terminale con Claude Code e con opencode: Consenti / Nega arrivano in Telegram e non nell'isola; senza risposta per 100 s, negato.
  6. Foto e PDF con e senza didascalia: nel Vassoio e letti dal motore.
  7. App chiusa, messaggio, app riaperta: una sola risposta «Ero spento».
  8. «Mandami lo screenshot / il file X»: arriva in Telegram (foto, documento, video); `/vassoio` e un pulsante.
  9. Con un profilo automatico attivo che non ha Telegram acceso, il bot risponde lo stesso.
  14. Mappa di Notion (19 ottobre 2026), in chat con Claude Code e il connettore Notion: «aggiungi un'attività …» va senza ricerche né fetch del database; «che stati ha Progetti?» usa `notion_map`. Impostazioni → Notion → Sincronizza dice i numeri.
  13. Ferma (19 ottobre 2026): durante una risposta lunga in modalità terminale, «⏹ Ferma» e poi `/stop`: il messaggio dice «Fermato.», il processo del motore sparisce, la domanda dopo va. Nella chat dell'isola il pulsante ■ fa lo stesso.
  10. `/cartella`: aprire una sottocartella, «Su», farsi mandare un file; un file ricevuto spostato nella cartella di lavoro.
  12. Vocali (18 ottobre 2026): con «Vocali» su Gemini o OpenRouter e la chiave messa, un vocale in italiano torna come «🎙 …» e la chat risponde; un vocale muto; un file mp3; senza chiave il messaggio lo dice.
  11. `/automatica` in modalità terminale: un comando normale e una modifica vanno senza messaggi; `rm`/`Remove-Item` di un file di prova chiede Consenti / Nega; `/stato` lo dice; `/automatica off` torna a chiedere tutto.
- [ ] **Notion per tutti i motori** (19 ottobre 2026), dopo aver sincronizzato la mappa:
  1. Con Claude Code, opencode e Antigravity: «aggiungi in Notion pranzo 6,40 €»: chiama `notion_add_row` (card Consenti / Nega), la riga è nel database giusto con importo e data; nessuna pagina vuota.
  2. Un nome di proprietà o un'opzione sbagliati: torna l'errore con quelli giusti e il modello corregge da solo.
  3. «Quali sono le ultime spese?» usa `notion_query` senza chiedere permessi.
  5. Motore Claude con chiave API, «Strumenti di EasyIsland» acceso: «com'è messo il PC?» usa `list_status` senza chiedere; l'aggiunta in Notion chiede Consenti / Nega (anche da Telegram); «> ⚙ …» sopra la risposta; ■ durante un passo e poi una domanda nuova: nessun errore dell'API.
  4. Antigravity: Impostazioni → Chat → Antigravity → «Aggiungi…», copia di `mcp_config.json` (se c'era), stato «Aggiunti»; `agy mcp list` mostra `easyisland`. Poi da Telegram la stessa richiesta del punto 1.
- [ ] **Microsoft To Do (20 ottobre 2026), sul PC con Outlook classico** (su quello di sviluppo Outlook non c'è; provati solo i test, la sintassi dello script e le sue funzioni su un'attività finta): `cargo test --lib todo::tests::live -- --ignored --nocapture` con Outlook aperto (aggiunge «Prova EasyIsland», la cambia e la segna fatta); dalla chat «cosa ho da fare in To Do?», «aggiungi in To Do: pagare il bollo entro venerdì, importante», «segna fatto il bollo»; controllare che compaiano in To Do, che le liste personalizzate si vedano e che `/oggi` le citi.
- [ ] **Velocità e ricette (20 ottobre 2026):** dall'isola e da Telegram con Claude, due o tre messaggi di fila: nel log «chat: turno subscription in …» con il secondo più veloce del primo e un solo processo `claude` con `--input-format stream-json` per conversazione; «quanto ho speso questo mese» due volte in giorni diversi: la seconda volta «con ricetta» nel log e niente `notion_map`; Impostazioni → Chat → «Ricette» conta e «Dimentica» azzera; chiudendo l'app non restano processi `claude`.
- [ ] **`/oggi` e `/domani` su Telegram** (19 ottobre 2026): con Claude Code o opencode e gli strumenti di EasyIsland, il punto della giornata con appuntamenti, posta, attività di Notion in scadenza; nessuna modifica; con un motore senza strumenti dice cosa non può vedere.
- [ ] **Seconda opinione** (19 ottobre 2026): nell'isola, sotto una risposta, «⇄ Seconda opinione» elenca gli altri motori; la revisione compare col suo titolo, ■ la ferma; la domanda dopo tiene conto della revisione. Su Telegram il pulsante sotto la risposta, la scelta del motore, il pulsante che resta solo sotto l'ultima risposta; `/nuova` lo toglie.
- [ ] **Impostazioni dagli agenti** (17 ottobre 2026): nella chat «usa opencode come motore predefinito», «metti il Geco», «spegni il Meteo»: card Consenti / Nega, poi le Impostazioni aperte cambiano subito; «accendi la modalità terminale» viene rifiutato.
- [ ] **Permessi e chiamate spento** (17 ottobre 2026): un permesso di Claude Code e una chiamata 3CX con l'isola chiusa non la aprono; striscia o pallino, scorciatoia «Vai alla richiesta in attesa».
- [ ] **Cartella di lavoro** (17 ottobre 2026): «Scegli…» in «File e schermo» e nelle Impostazioni; doppio clic su cartelle e file; Rinomina, Sposta… e «Sposta qui», Nel Vassoio, Copia percorso, Cestino (il file è nel Cestino di Windows); trascinare un file e una cartella in Esplora file; dal Vassoio l'icona verde. Chat con Claude e con opencode: «cosa c'è nella cartella di lavoro?», «leggi il file X», «sposta nella cartella di lavoro il file del Vassoio».
- `notion_delete_row`: chiedere in chat di eliminare una riga di prova; deve chiedere conferma, poi la riga va nel cestino di Notion.
- **Accesso remoto:** collegarsi con WinRM a un PC fuori dal dominio (con «Aggiungi a TrustedHosts»: UAC, poi alla chiusura l'indirizzo tolto), con SSH a un Windows e a un Linux con password (SSH_ASKPASS) e con chiave; «Collega alla chat», chiedere un controllo (spazio su disco, servizi) e vedere Consenti / Nega per ogni comando; «Chiudi connessione».
- **Telegram a PC spento:** chiudere EasyIsland, scrivere al bot due messaggi (uno «ricordati che…»), riaprire: riga «Ero spento…», poi le due risposte in ordine e la nota in memoria.
- **Isola che passa dietro:** isola aperta → Vassoio → «Scegli…» della cartella di lavoro: la finestra di scelta sta sopra l'isola; un clic sull'isola la riporta davanti; un permesso la riporta davanti; Start e barra delle applicazioni non la spostano.
- **Automazioni, passi nuovi:** un'automazione con «Chiedi prima di continuare» e «Aspetta 1 minuto»: card con Continua / Annulla, Annulla ferma; un passo che fallisce salta i seguenti.
- **Isola come un'app:** con «Come un'app» l'icona resta nella barra a isola chiusa e un clic la apre; aperta compare in Alt+Tab; — riduce, ▢ schermo intero e ritorno; con «Resta aperta» non si chiude da sola. Con «Scegli…» del Vassoio la finestra resta sopra anche passando col mouse sull'isola.
- **Menu della barra:** con EasyIsland aggiunta alla barra, tasto destro sull'icona: azioni rapide e Apri l'isola / Chiedi alla chat / Riquadra e chiedi / Impostazioni funzionano, anche a isola chiusa.
- **Backup completo:** Esporta, poi Importa lo stesso file: le cartelle attuali finiscono in `.prima-del-ripristino-<data>`, EasyIsland si riavvia e memoria, chat e compiti ci sono.
- **Anteprime:** immagini nel Vassoio e nella cartella di lavoro mostrano la miniatura, in elenco e in griglia.
- **Impostazioni ferme:** in fondo ad Azioni rapide cambia «Chiedi alla chat» in «Tasti nel programma in uso», e in Integrazioni accendi e spegni un interruttore: la pagina resta dov'è.
- **File sull'isola a riposo:** con la vista compatta tornata a riposo (anche «Nessuna», la striscia invisibile), trascina un file sul bordo dov'è l'isola: si apre il pannello di rilascio.
- **Logo al posto del personaggio:** Tema → Nell'isola → Il mio logo, Carica PNG…: il logo compare nell'icona a riposo, nella vista compatta e nell'isola aperta, fermo, senza saluto all'avvio; Il meteo mostra cielo e temperatura con Meteo attiva; un backup esportato contiene `logo.png`.
- Anteprima (26 ottobre 2026): aprire un link e un file dalla chat, un server di sviluppo dalla card e da «+»; pagina web con Desktop/Tablet/Telefono, ☀/☾, console con un errore, Strumenti per sviluppatori; HTML e PDF nel browser; un file modificato dalla Modalità terminale che si apre da solo con «Modifiche»; trascinare un file sulla finestra; chiudere e riaprire (schede uguali, niente processi rimasti); dalla chat `preview_read`, `preview_screenshot`, `preview_console`, `preview_click` con Consenti / Nega.
- Anteprima nell'isola (26 ottobre 2026; pannello, bordo, angolo, icone, ✕, chiusura e riapertura, isola a destra provati il 27): pagine web cliccabili e scrivibili dentro il pannello. Dalla chat: preview_snapshot su un sito vero, clic per ref, preview_wait, preview_network con una 404, riga di contesto quando l'Anteprima è aperta.
