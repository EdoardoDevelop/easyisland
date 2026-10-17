# Registro archiviato

Voci tolte da `HANDOFF.md` quando il Registro supera le 5 voci, la più recente in alto. Le voci fino al 6 ottobre 2026 sono anche in `HANDOFF-fino-al-6-ottobre.md`. Da leggere solo per ricostruire la storia di una modifica.

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

### 14 ottobre 2026 — Notion nell'app, attività, note e pagine; pulizia del disco
- Card di Notion rifatta su richiesta di Edoardo (le «recenti» erano collegamenti a caso): attività da un database con la spunta «fatto», «+ Nota» in una pagina o database, pagine fissate, scelti in Impostazioni (`notion.rs`, `docs/integrazioni.md`); seconda parte in `docs/idee.md`. Provati con i test e nell'anteprima, non con il suo Notion. Notion: le pagine si aprono nell'app installata (`notion://`, `notion.rs`), ricerca nella card e nella barra in alto, «Chiedi alla chat» con il testo della pagina allegato; card con 6 pagine recenti. Provato con i test e nell'anteprima (`notion`), non ancora con l'account vero. Link `app.notion.com/p/…` (quelli che l'API dà ora) aperti anch'essi nell'app. Connettori della chat: anche i server MCP dei plugin di Claude Code (Notion), provato che `claude -p` li carica. `cargo clean` su richiesta di Edoardo (48 GB): dopo, `cargo build --release -p easyisland-hook` prima dei test, perché l'app include il relay come risorsa.

### 14 ottobre 2026 — «Sostituisci» con la formattazione, zona nuova nel Vassoio, versione 0.8.2
- Versione **0.8.2** con queste voci. «Sostituisci» tiene grassetti, link e paragrafi: l'HTML copiato dall'app va al modello con segni `⟦n⟧` e torna con gli stessi tag (`richtext.rs`, test); «Senza formattazione» incolla il solo testo. Provato con i test e la card nell'anteprima (`rewrite`, `&lost`), non ancora in Word e Outlook veri. Vassoio: la zona appena aggiunta da Cerchia e chiedi è evidenziata con «Chiedi» e «Copia» (`files&fresh`). Edoardo: grassetto e sottolineato restano, un titolo no in un suo caso; con Word automatizzato qui Titolo e Titolo 1 restano, caso da capire. L'integrazione «Musica» ora si chiama «Media» (icona ⏯️): comprende video e podcast.

### 14 ottobre 2026 — logo nuovo, rete con tutte le schede, versione 0.8.0
- Versione **0.8.0** con le voci di oggi; schermate di Musica e Rete rifatte nel README e nella homepage. Logo scelto da Edoardo fra 12 proposte (la 10): tre pillole a «E» dal viola all'azzurro, in `scripts/gen-icons.mjs` (icone dell'app, area di notifica, `site/media/icon.png`). Rete: tutte le schede attive con i loro IPv4, gateway e DNS della principale (`probes::network`, `docs/integrazioni.md`); provato su questo PC (Ethernet e vEthernet). 3CX: scheda Rubrica nella barra (cerca dal display), provata nell'anteprima. Rete: ping continuo in un terminale (gateway, 8.8.8.8, indirizzo scritto) e «Modifica rete…» (DHCP/manuale, maschera, gateway, DNS) con `netsh` e la richiesta di amministratore di Windows (`netconfig.rs`); comandi provati con i test e il modulo nell'anteprima, mai applicati a una scheda vera da qui. Versione **0.8.1**: scelta della scheda con pulsanti (il `<select>` non funzionava nell'isola) e un pulsante di ping per il gateway di ogni scheda. Cerchia e chiedi → «Nel Vassoio» apre l'isola sul Vassoio invece di chiuderla con un messaggio, e la riapertura entro 5 minuti torna lì (`openingView` in `island.ts`).

### 14 ottobre 2026 — Impostazioni in finestra, schede centrate, copertina della Musica
- Su richiesta di Edoardo: tolta la vista «Impostazioni rapide» dell'isola; il pulsante della barra (icona nuova a cursori, `ICONS.sliders`) apre subito la finestra delle Impostazioni, come la voce del menu dell'area di notifica. Contenuti delle schede centrati in altezza (`.left-body`, `.qa-card`, `.files-body` con `justify-content: safe center`: un contenuto più alto parte dall'alto come prima). Musica: la copertina riempie la card, chiara in alto e sfumata verso il centro, con brano, avanzamento e comandi al centro (`.media-backdrop`; senza copertina un alone del colore della scheda; scena `media`, `&nocover`). Automazioni più intelligenti ragionate in `docs/idee.md`. Consumo Claude: con l'accesso scaduto, o con «Aggiorna», EasyIsland lo fa rinnovare a Claude Code avviato in una console invisibile con `/usage` e poi chiuso (`renew.rs`, scelta di Edoardo; `docs/decisioni.md`). Provato qui l'avvio e la chiusura; il rinnovo vero alla prossima scadenza.

### 14 ottobre 2026 — proposte al momento giusto, riepilogo del giorno, EasyIsland in Claude Code
- Su richiesta di Edoardo, le sei idee di `docs/idee.md`: card per un download finito (`downloads.rs`), un errore copiato con «Spiega e correggi» e chi tiene la porta (`moments.rs`), un server di sviluppo partito con «Apri nel browser» (`devservers.rs`), password e chiavi tolte dagli appunti dopo 30 s; riepilogo del mattino e di fine giornata con repository non salvati e pull request (`daily.rs`, `src/island/daily.ts`); il server MCP aggiungibile a Claude Code con `show_card` e `add_to_tray` (`mcp_setup.rs`). Ognuna si spegne nelle Impostazioni. Dettagli in `docs/strumenti.md` e `docs/agenti.md`; scene `moment` e `daily`, anche nel fuzz del collaudo. Provati dal vivo qui (log e card di MCP) download, server, errore, chiave, `show_card`, `add_to_tray`. Versione **0.7.9** con la scansione di stabilità; schermate nuove nel README e nella homepage.

### 13 ottobre 2026 — scansione di stabilità
- Su richiesta di Edoardo: clippy, ricerca dei panic in Rust, collaudo automatico nuovo (`npm run smoke`: tutte le scene, le Impostazioni e un fuzz di eventi e dati malformati). Corretti: isola che si congelava per sempre dopo un'eccezione in una card (`guard`, `safeCard`), eventi degli agenti con campi del tipo sbagliato (`sanitize`), dati 3CX e Meteo malformati, impostazioni perse se il salvataggio veniva interrotto (`write_atomic`, copia di riserva), panic su caratteri accentati in calendari ICS e WHOIS, copia di file grandi che bloccava l'isola. Dettagli in `docs/architettura.md` → Robustezza. Tutto verde: 172 + 36 test Rust, 45 scene e pagine del collaudo.

### 13 ottobre 2026 — versione 0.7.8 e homepage
- Unione in `main` e tag `v0.7.8`: nuovo impianto dell'isola, risposte rapide a isola chiusa, card del Meteo, angolo e colore del personaggio (voci sotto). Schermate del README rifatte (scene nuove `files`, `strip`; `overview` con le righe dei riquadri), parole «pillola» tolte da README e Impostazioni. Homepage (`site/`, GitHub Pages, arrivata in `main` da `claude/homepage`) aggiornata al nuovo impianto con le stesse schermate.

### 13 ottobre 2026 — Panoramica, card del Meteo, angolo e colore del personaggio
- Dopo la prova di Edoardo: «Oggi» torna a chiamarsi Panoramica; loghi del menu larghi quanto un'emoji; numeri e pallini del menu nascosti con la voce aperta. Card del Meteo nuova (`src/views/weather.ts`, dati `forecast_of` in `probes.rs`): cielo di adesso animato che sfuma in basso, riquadri, 12 ore e 7 giorni. Angolo di ridimensionamento senza scatto e fermo all'altezza minima (si salvava la posizione del mouse). Il personaggio torna al suo colore anche quando l'agente non manda `Stop` (`armStale`, `idle_prompt` in `hooks.ts`). Provato nell'anteprima (scena `meteo`, anche `&night`).

### 13 ottobre 2026 — risposte rapide a isola chiusa
- Seconda tappa del nuovo impianto: accanto al personaggio della vista compatta una striscia (`src/views/strip.ts`) con chi lavora e, a isola chiusa, Nega / Consenti sui permessi semplici e Rispondi / Rifiuta, Muto / Riaggancia sulle chiamate 3CX, senza aprire l'isola. Impostazioni → Posizione e aspetto → «Risposte rapide»: a destra, a sinistra o spente (spente = come prima). Provata nell'anteprima (scena `strip`, tutte le varianti e i due lati).

### 13 ottobre 2026 — nuovo impianto dell'isola aperta
- Dopo un prototipo approvato da Edoardo: menu a sinistra con il personaggio in cima (`rail.ts`), barra in alto con il suo fumetto, il campo unico (cerca e «Chiedi alla chat», Ctrl+Invio) e i pulsanti di prima, «Oggi» a riquadri al posto della Panoramica, niente più schede in alto né pillole. Personaggi e animazioni invariati, impostazioni di prima tutte valide (`integrationTabs` non serve più), nuove «Personaggio nel menu» e «Fumetto». Personalizzazione solo in Impostazioni (`docs/decisioni.md`). Provato nell'anteprima (scene overview, approval, chat, threecx, agenti, actions, drop). Dopo la prima prova di Edoardo: l'isola cresceva fino all'altezza dello schermo e, ancorata in basso, perdeva la barra in alto (misura del menu e finestra corrette, `docs/architettura.md`); 8 px sotto la barra; «File e schermo» come nel prototipo (titolo, riquadri Rilascia e Cerchia e chiedi, Vassoio).

### 13 ottobre 2026 — versione 0.7.7
- Unione in `main` e tag `v0.7.7`: «Cerchia e chiedi» con OCR al posto dello Strumento di cattura, personaggio visibile durante le chiamate 3CX, suoneria predefinita come WAV, colore per ogni integrazione (voci sotto). README con novità e tabella delle versioni.

### 13 ottobre 2026 — «Cerchia e chiedi» al posto di «Cattura una zona»
- Lo Strumento di cattura di Windows è sostituito dal nostro velo: lo schermo sotto il mouse si ferma nella finestra dell'isola stessa, si cerchia o riquadra la zona e accanto ci sono domanda alla chat, azioni rapide, Copia immagine, Copia testo (OCR di Windows) e Nel Vassoio (`screenshot.rs`, `capture.ts`, `docs/strumenti.md`). Provati nell'anteprima (scena `capture`) e dal vivo congelamento e OCR (`screenshot::live`); il velo vero va provato (`docs/prove-dal-vivo.md`). Proposte «al momento giusto» annotate in `docs/idee.md`.

### 13 ottobre 2026 — 3CX: personaggio che spariva in chiamata, suoneria predefinita muta, colore delle integrazioni
- In chiamata col telefono «Questo PC» l'isola usa il microfono e «Davanti al cliente» la prendeva per una riunione, nascondendo il personaggio: ora durante una chiamata 3CX il microfono non conta (`threecx::in_call` in `presence.rs`).
- La suoneria predefinita era un `AudioContext` aperto senza clic, che WebView2 può lasciare sospeso: ora è un WAV generato una volta e suonato da `<audio>` come il file dell'utente (provato nell'anteprima: suona senza clic). Da riprovare sul centralino vero.
- Impostazioni → Integrazioni → Colore per ogni integrazione (`integrationColors`): pallino, card e personaggio con la scheda aperta. Provato nell'anteprima (scena `threecx`).

### 13 ottobre 2026 — versione 0.7.6
- Unione in `main` e tag `v0.7.6`: limiti del piano vecchi in grigio con il motivo, richiesta subito quando l'accesso di Claude Code cambia, «Aggiorna» della card Consumo che chiede subito (voce sotto). README con novità e tabella delle versioni.

### 13 ottobre 2026 — limiti del piano fermi a un numero vecchio
- L'isola diceva «7g 85%» con `/usage` al 94%: l'accesso in `.credentials.json` era scaduto (l'app desktop di Claude non lo rinnova) e restavano i numeri vecchi. Ora i numeri di oltre 15 minuti sono grigi nell'intestazione, con il motivo nel suggerimento e nella card (scena `usage&stale`); quando il file cambia si richiede subito (provato: rinnovo alle 06:10:24, numeri alle 06:11:13); «Aggiorna» della card chiede ad Anthropic senza aspettare il turno. Provato e tolto il rinnovo con `claude auth status`, che non rinnova (`docs/decisioni.md`).

### 12 ottobre 2026 — versione 0.7.5
- Unione in `main` e tag `v0.7.5`: 3CX «Questo PC» con suoneria e scheda da telefono, avvio sicuro dopo un aggiornamento (profilo WebView2) e dopo un riavvio del PC (timer senza `Instant - Duration`), campanella 3CX che cambia icona (voci sotto). README con novità e tabella delle versioni.

### 12 ottobre 2026 — EasyIsland che non partiva dopo un riavvio del PC
- Nelle prime ~6 ore dopo l'accensione l'app si chiudeva all'avvio: `habits.rs` e `automations.rs` calcolavano `Instant::now() - durata`, e su Windows l'`Instant` conta dall'accensione, quindi andava sotto zero (panic «overflow when subtracting duration from instant», visto nel log grazie all'hook dei panic). Ora i timer sono `Option<Instant>`; non usare mai `Instant - Duration` senza `checked_sub`. Provato qui 15 minuti dopo un riavvio.
- Campanella dell'intestazione 3CX che non cambiava icona: la card si ridisegna solo se cambia la sua chiave in `views.ts`, che ora include `threecxAlert` e `threecxRing`. Provato nell'anteprima (scena `threecx`).

### 12 ottobre 2026 — EasyIsland che non partiva dopo l'aggiornamento
- Su due PC la 0.7.4 si chiudeva al primo avvio dopo l'aggiornamento: i WebView2 della versione vecchia tenevano occupato il profilo (0x800700AA → panic nel setup). Ora l'avvio aspetta e chiude gli avanzi e, se serve, usa un profilo di riserva per quella volta (`webview_profile.rs`, `docs/sviluppo.md`); i panic finiscono nel log. Provato qui con tre aggiornamenti sopra un'istanza in esecuzione.

### 12 ottobre 2026 — 3CX: telefono nel PC, suoneria, scheda da telefono
- «Questo PC» tra i dispositivi della scheda 3CX: EasyIsland si registra come telefono WebRTC dell'interno, come il web client V20 (messaggi 163, 164/228, 227 ricavati dal suo codice, `myphone.rs`; audio in `src/core/softphone.ts`), con muto, toni e microfono concesso solo all'isola. Suoneria sintetizzata o file MP3/WAV/OGG/M4A dell'utente, silenziabile; avviso della chiamata nell'isola disattivabile (Impostazioni e intestazione della scheda). Scheda ridisegnata come un telefono: tastierino a sinistra, chiamate ed elenchi a destra, barra di icone Team/Chat/Segreteria/Recenti/Perse. Test Rust dei messaggi e anteprima (scena `threecx`); l'audio vero è da provare dal vivo (`docs/integrazioni.md`).

### 12 ottobre 2026 — versione 0.7.4
- Unione in `main` e tag `v0.7.4`. A isola chiusa il personaggio torna al suo colore (quello della scheda vale solo aperta, `drawBot`); trascinando il personaggio della chat l'isola tiene il mouse dalla pressione e il timer di chiusura ricontrolla quando scade (`fsm.ts`); schede e pulsanti dell'intestazione allargano l'isola aperta se non ci stanno (`measureHeader`, `openWidth`). Allargamento provato nell'anteprima; colore e trascinamento da provare dal vivo.

### 12 ottobre 2026 — versione 0.7.3
- Unione in `main` e tag `v0.7.3`: limiti del piano chiesti ad Anthropic e mostrati nell'intestazione, tempo rimasto sui permessi, appunti rimessi in tutti i formati (voce sotto). README con novità e tabella delle versioni.

### 12 ottobre 2026 — piano da Anthropic, tempo sui permessi, appunti interi
- I limiti del piano arrivano anche usando solo l'app desktop di Claude: la card Consumo li chiede ad Anthropic con l'accesso di Claude Code (`ask_anthropic` in `usage.rs`; decisione del 9 ottobre cambiata con Edoardo, `docs/decisioni.md`), con la settimana Opus, e li mostra anche nell'intestazione dell'isola. Provato dal vivo (risposta vera) e nell'anteprima (scena `usage`).
- Le card del permesso e della domanda dicono quanto manca ai 108 s (scena `approval`). Copia della selezione e «Sostituisci» rimettono gli appunti in tutti i formati: provati dal vivo testo, file e immagine (test `clipboard_round_trip`).

### 11 ottobre 2026 — versione 0.7.2
- Unione in `main` e tag `v0.7.2`: il personaggio della chat trascinato su una finestra la allega come contesto, con la faccia che cambia mentre lo porti (voce sotto). README con novità e tabella delle versioni.

### 11 ottobre 2026 — il personaggio della chat allega una finestra
- Nella scheda Chat il personaggio si trascina su una finestra di un'altra app: al rilascio ne prende un'immagine (`PrintWindow`), con app e titolo, e la allega alla chat come contesto per tutti i motori (`window_drop.rs`, `ChatContext::Window` con `image`, `docs/strumenti.md`). Funzione di Coucou che mancava. Mentre lo porti il personaggio segue il puntatore in una finestra sua (`carry.rs`) e cambia faccia: sorpreso, contento sopra una finestra, cuori al rilascio. Provati nell'anteprima chip, ✕ e rilascio sull'isola (scene `chat&window`, `chat&pick`) e dal vivo la cattura nativa (test `live`); il gesto intero è da provare (`docs/prove-dal-vivo.md`).

### 11 ottobre 2026 — versione 0.7.1
- Unione in `main` e tag `v0.7.1`: 3CX con team, chat, segreteria, code, trasferimento e deviazione; cielo del Meteo grande dietro il personaggio; immagine di tutti i personaggi nel README (`dev/characters.html`). README con novità e tabella delle versioni.

### 11 ottobre 2026 — 3CX: team, chat, segreteria, code e trasferimento
- Con «Interno e password» la scheda 3CX ha Team (colleghi con lo stato in tempo reale, Chiama, Scrivi, Rispondi al suo posto), Chat (elenco, conversazione, invio, non letti, «sta scrivendo», avviso con suono e isola aperta), Segreteria (con trascrizione, «Ascolta» sul telefono), In coda / Fuori coda, Trasferisci e Devia. Protocollo ricavato dal web client del centralino di Edoardo (`myphone.rs`, `docs/integrazioni.md`). Provato con i test e nell'anteprima (scena `threecx`); dal vivo da provare.

### 11 ottobre 2026 — il cielo del Meteo in grande dietro il personaggio
- Sole, luna, nuvole, pioggia, neve e temporale sono circa il doppio e stanno dietro la testa, spostati a destra (`weather.ts`, `docs/architettura.md`). Gocce e fiocchi cadono solo sotto la nuvola, sole e luna più in basso perché i raggi non vengano tagliati, fulmine spostato fuori dal corpo. L'anteprima del personaggio mostra anche il cielo piccolo di prima, per confronto. Provato nell'anteprima e nella scena `meteo`.

### 11 ottobre 2026 — versione 0.7.0
- Unione in `main` e tag `v0.7.0`: Fiamma animata, Geco con bordo fine e sguardo fino all'orbita, Roccia, Magma e Pietra dal foglio personaggi, Foglia nuova (voci sotto). README con novità e tabella delle versioni.

### 11 ottobre 2026 — Roccia, Magma e Pietra dal foglio personaggi, Foglia nuova
- Dopo vari tentativi, Roccia, Magma e Pietra sono ricalcati dal foglio personaggi di Edoardo: contorno, occhi e zone di colore misurati sulle viste frontali e salvati come curve (`blobs.ts`, `docs/architettura.md`). Foglia (`leaf.ts`) ha la sagoma misurata sulla foglia di Edoardo, senza il ricciolo, e l'interno a sfumature continue. Contorni ammorbiditi e bordo fine. Confrontati affiancati all'originale e provati nell'anteprima con tutti gli stati.

### 11 ottobre 2026 — Geco: bordo più fine e sguardo fino all'orbita
- Contorno visibile circa la metà di prima. Guardando il mouse la pupilla va dalla posizione di riposo fino al bordo del globo dalla parte del mouse, in orizzontale e in verticale (`GAZE` in `gecko.ts`); prima ne seguiva solo il 35 % e restava quasi ferma. Provato nell'anteprima con lo sguardo simulato nelle quattro direzioni.

### 11 ottobre 2026 — la Fiamma si muove
- La Fiamma ondeggia e tremola di continuo: la punta si muove di più, la base resta ferma, gli strati interni seguono con un ritardo e le scintille salgono (`flame.ts`). Nuovo campo `animated` nel contratto dei personaggi: tiene vivo il ciclo a 30 fps solo a isola visibile (`engine.busy`; `docs/architettura.md`). Provato nell'anteprima; CPU a isola ritirata da verificare dal vivo.

### 11 ottobre 2026 — versione 0.6.9
- Unione in `main` e tag `v0.6.9`: sei nuovi personaggi, Geco, Fiamma, Magma, Pietra, Roccia e Foglia (voce sotto). README con novità, elenco dei personaggi e tabella delle versioni.

### 11 ottobre 2026 — nuovi personaggi: Geco, Fiamma e quattro gelatine
- `src/character/gecko.ts`: testa di geco con due cupole, grandi occhi ambrati e mento crema, ricalcata da un disegno di Edoardo (134×92 px) misurando contorno, occhi e macchie; in anteprima la differenza col disegno resta entro 1–2 px. Pupille che guardano dentro il globo, palpebra che scende nel battito, occhi chiusi sul verde, occhi dentro la scatola del rilascio file (`docs/architettura.md`). Provato in `dev/character-preview.html`, `upload-preview.html` e `greeting-preview.html`; dal vivo da provare.
- `src/character/flame.ts`: fiamma rossa con strati arancione e giallo, base scura, goccia e scintille, ricalcata allo stesso modo da un disegno ma con la faccia comune del motore.
- `src/character/blobs.ts`: Magma, Pietra, Roccia e Foglia, gelatine disegnate da zero nello stile di immagini di slime (poi rifatte con l'elmo, voce sopra).

### 11 ottobre 2026 — versione 0.6.8
- Unione in `main` e tag `v0.6.8`: menu sul testo selezionato con `Win+Alt+A` (azioni rapide con icone e cartelle), «Sostituisci» con anteprima, «Lavora su» nell'editor delle azioni, reazioni del personaggio, isola senza salti d'altezza (voci sotto). README con novità e tabella delle versioni.

### 11 ottobre 2026 — l'isola saltava scrivendo in «Continua»
- Sulla card «ha finito», con l'isola più alta della vista, ogni lettera faceva saltare il messaggio tra 150 e 267 px: `fitHeight` misurava il riquadro già allungato da `--extra-h`, e l'altezza tornava nel calcolo. Ora `measureFit` misura con `--extra-h` a 0; vale per tutte le viste (piano del permesso, modifiche, liste). Riprodotto e verificato con la scena `finished&islandHeight=440`.

### 11 ottobre 2026 — reazioni del personaggio
- Impostazioni → Notifiche → **Reazioni del personaggio**: per agente finito, in errore o al limite, e per ogni controllo o integrazione accesa (Rete, widget…) si sceglie «Si fa vedere e suona», «Cambia faccia, in silenzio» o «Resta tranquillo» (`settings.reactions`, nei profili; `docs/architettura.md`). Nato dal notebook con la rete instabile che faceva lamentare il personaggio. Logica provata nell'anteprima; dal vivo da provare.

### 11 ottobre 2026 — «Sostituisci» sul testo selezionato e menu con Win+Alt+A
- **Sostituisci con anteprima:** «Riscrivi», «Correggi», «Più formale»… riscrivono la selezione con il motore della chat (`rewrite_text`, una risposta a parte, fuori dalla cronologia) e mostrano prima e dopo (`src/views/rewrite.ts`). Con «Sostituisci» `context::replace` ricopia la selezione, incolla solo se è ancora la stessa, poi rimette gli appunti.
- **Menu sul testo selezionato** in qualunque app, browser compresi: `Win+Alt+A` copia la selezione e apre un menu nativo al mouse (`selection-menu.ts`, `tray::popup_entries`) con **solo le azioni rapide** sul testo selezionato, con le loro icone e le cartelle come sottomenu. Nell'editor «Lavora su» sceglie anche «lo sostituisce»; un pulsante crea quattro azioni di partenza. Anteprima provata (scena `rewrite`, Impostazioni); le app vere sono da provare dal vivo.

### 10 ottobre 2026 — versione 0.6.7
- Unione in `main` e tag `v0.6.7`: markdown e «Continua» sulla card «finito», «Chiedi a questa sessione», «Più tardi» sul permesso, «Sempre» di sessione, 📌 come finestra normale (voci sotto). README con novità e tabella delle versioni.

### 10 ottobre 2026 — 📌 «Tieni aperta» come finestra normale
- Con il 📌 l'isola aperta ha l'icona nella barra e in Alt+Tab, non è più sempre in primo piano, si riduce con un clic sull'icona; un permesso fa solo lampeggiare l'icona. Togliendo il 📌 o chiudendo torna com'era (`set_app_mode`, `flash_if_behind` in `island.rs`, `docs/architettura.md`). Compila e passa i test; il comportamento della finestra è da provare dal vivo.

### 10 ottobre 2026 — scatti dell'isola con il contenuto che scorre
- Aprendo l'isola o trascinandone l'angolo, una vista con barra di scorrimento faceva scattare l'altezza: il contenuto si reimpaginava a ogni fotogramma con la larghezza che si animava. Ora è impaginato subito alla larghezza finale (`--view-w`, `animateGeometry`; `docs/architettura.md`). Riprodotto nell'anteprima facendo avanzare i fotogrammi a mano: prima l'altezza misurata passava da 336 a 271 a metà apertura, ora resta 271.

### 10 ottobre 2026 — sessioni: «Continua», «Chiedi», card ripiegabile, «Sempre» di sessione
- **Card «finito»:** risposta in markdown e campo **«Continua»** (`session_reply.rs`): nel terminale scrive nella console della sessione (`easyisland-hook type`, provato con `cmd` e Python veri), in VS Code/Cursor precompila con il link dell'estensione, opencode lo riceve dal servizio.
- **«Chiedi a questa sessione»:** la chat interroga una copia in sola lettura (`--fork-session`, `session_ask` in `claude_cli.rs`); provato dal vivo con una mini-sessione.
- **Card del permesso ripiegabile** («Più tardi» o Esc) e **«Sempre» sempre presente**: senza proposta di Claude Code vale per la sessione e per ciò che si approva (`session_rule`, `docs/decisioni.md`). Anteprima: tutte le card provate; la console di Windows Terminal e VS Code sono da provare dal vivo.

### 10 ottobre 2026 — versione 0.6.6
- Unione in `main` e tag `v0.6.6`: saluto al centro, `Ctrl+Space` che chiude, Claude Code solo con i suoi hook, «Collega opencode», controlli dopo lo standby, passi della sessione (voci sotto). README con novità e tabella delle versioni.

### 10 ottobre 2026 — passi sovrapposti, controlli dopo lo standby
- **Card della sessione:** il passo completato (grigio) finiva una riga sotto, sopra quello in corso. Il testo grigio di ogni riga del ticker era assoluto senza `top` (`src/views/ticker.ts`); ora sta in alto e `.tick-text` è un blocco, così anche i puntini di troppo-lungo funzionano. Il passo con l'ultimo messaggio di Claude passa da `plainText` (ora in `src/core/markdown.ts`, come la card «ha finito»): niente `**`, corsivi, backtick né link in markdown.
- **Controlli e standby** (`widgets.rs`): un controllo che inizia a fallire si mostra solo se lo conferma un secondo controllo 15 s dopo. Dopo il risveglio (salto dell'orologio tra due giri dello scheduler) per 90 s i nuovi errori si riprovano soltanto; un controllo a cavallo dello standby si scarta. Vale per Rete e per ogni widget o integrazione-controllo.

### 10 ottobre 2026 — Claude Code facoltativo, saluto al centro, «Apri l'isola» chiude anche
- **Claude Code solo con i suoi hook:** senza hook installati niente card Claude Code. Con «Collega opencode» (prima «Segui opencode 2») la scheda Agenti parte da opencode «In attesa»; senza agenti la scheda non c'è. `hooksInstalled` lo scrivono solo `boot` e `hooks_apply` (il salvataggio delle Impostazioni non lo tocca più). Nell'anteprima del browser gli hook contano come installati (`?hooksInstalled=false` per provarne l'assenza).
- **Saluto all'avvio** al centro dello schermo di predefinito. In Posizione e aspetto: acceso/spento (`greeting`; spento, il personaggio compare al suo posto senza suono) e dove (`greetingPlace`: centro o dove sta il personaggio). La finestra va al centro con `set_expanded(…, place)` → `gate.open_place`, che vale solo per quell'apertura. Provato nell'anteprima; la finestra vera è da provare dal vivo.
- La scorciatoia «Apri l'isola» (`Ctrl+Space`) premuta con l'isola aperta la chiude (`onHotkey` in `island.ts`). Con una richiesta in attesa resta sulla card, come con Esc o il clic fuori (`collapse`).

### 9 ottobre 2026 — versione 0.6.5
- Unione in `main` e tag `v0.6.5`: cartella nella chat, menu col clic destro, saluto senza isola, `Ctrl+Space` sulla Panoramica, angoli dell'isola staccata (voci sotto). README con novità e tabella delle versioni.

### 9 ottobre 2026 — cartella nella chat, scorciatoia «Apri» sulla Panoramica
- **Cartella rilasciata sull'isola:** finiva nella sequenza del file («Rilascia», poi errore); ora i percorsi vanno nel campo della chat.
- **Scorciatoia «Apri l'isola»** (`Ctrl+Space`): apre la Panoramica invece di ⚡ o della chat; con una richiesta in attesa apre quella.
- **Personaggio lasciato su una cartella:** trascinando il personaggio (a riposo o compatto) su Esplora file o su un'icona del desktop, il percorso va nel campo della chat e il personaggio torna al suo posto (`folder_drop.rs`, `docs/strumenti.md`). Provata la ricerca su Esplora file vero (sfondo, barra degli indirizzi, righe); il desktop e il gesto intero sono da provare dal vivo.
- Feature `Win32_System_Variant` e `Win32_UI_Shell_Common` del crate `windows` già presente.

### 9 ottobre 2026 — saluto all'avvio senza isola
- Il saluto è solo il personaggio con alone e particelle, sul desktop: niente card scura, distintivo o mini personaggi (`Greeting.bare`, classe `greeting` sull'isola). Anteprima ripetuta: `/dev/greeting-preview.html`.

### 9 ottobre 2026 — menu col clic destro sul personaggio a riposo, angoli dell'isola staccata
- Clic destro sull'icona a riposo: lo stesso menu dell'area di notifica (Apri, Profilo, Riepilogo, Davanti al cliente, Impostazioni, Pausa, Esci) dove sta il cursore (`show_island_menu` in `lib.rs`, `tray::popup`). Le voci passano dallo stesso gestore del menu dell'area di notifica.
- La finestra a riposo non prende il fuoco (`WS_EX_NOACTIVATE`): per la durata del menu lo prende, sennò un clic fuori non lo chiude. Provato dal vivo il 9 ottobre.
- **Angoli:** l'isola aperta trascinata via dal bordo restava squadrata verso il bordo; ora `end_drag` restituisce lo spostamento (agganciato entro 16 px, riportato dentro lo schermo) e gli angoli si arrotondano. Mentre la si trascina, in ogni stato, è arrotondata tutta. Provato dal vivo.

### 9 ottobre 2026 — versione 0.6.4: Goccia predefinita, cronologia delle chat, isola grande, dove si apre
- **Goccia** è il personaggio predefinito (nuove installazioni; chi ne aveva scelto uno lo tiene). README con schermate nuove (`node scripts/screenshots.mjs`, aggiunte `chat-history`, `agenti`, `recap`), sezione Novità e tabella delle versioni.
- **Cronologia delle chat** (`chat_log.rs`, orologio in alto nella chat): fino a 100 conversazioni in `chats.json`, riaperte sul loro motore. Claude Code e opencode ricevono la conversazione di prima come testo. Si spegne e si cancella in Impostazioni → Chat.
- **Isola fino ai bordi dello schermo:** la finestra non è più fissa a 720×560 ma segue la misura scelta (`set_panel_size`, limiti da `panel_limits`).
- **«L'isola si apre»** (Posizione e aspetto): dove sta il personaggio, oppure in alto, al centro o in basso nello schermo (`islandPlace`). Provato nell'anteprima; la finestra vera si sposta solo nell'app.
- Testi rimasti in italiano tradotti (motore «abbonamento», «Pannello aperto», widget, Vassoio, errori degli hook). Il controllo delle traduzioni saltava il resto di un file Rust dopo il primo `#[cfg(test)]`.

### 9 ottobre 2026 — interfaccia in inglese, Ctrl+Space
- **Lingua** (Generale → Lingua: come Windows, italiano, inglese): 1.312 testi in `src/i18n/en.json`, condiviso da isola, impostazioni e Rust (menu, card delle integrazioni, errori). La chat risponde nella lingua scelta. Il cambio vale dal riavvio, offerto con «Riavvia ora». `npm run build` controlla che ogni testo abbia l'inglese. Provata nell'anteprima con `?lang=en`.
- **`Ctrl+Space` apre l'isola** di predefinito (schema 6: chi aveva ancora `Ctrl+Alt+Shift+M` passa a `Ctrl+Space`; una scorciatoia scelta a mano resta).

### 9 ottobre 2026 — prezzi dei modelli, limiti del piano, riepilogo settimanale
- **Modelli di opencode e OpenRouter:** «Carica modelli» dice gratuito, locale o a pagamento (dollari per milione di token), con «solo gratuiti» e il prezzo sotto il campo. opencode lo legge da `cost` di `/api/model`, OpenRouter da `pricing`.
- **Limiti del piano (Pro / Max)** nella card Consumo, presi da Coucou: il relay diventa la `statusLine` di Claude Code (`easyisland-hook statusline`), passa all'app solo `rate_limits` ed esegue la status line di prima, salvata in `statusline-previous.json`. Avviso dall'80 %.
- **Riepilogo settimanale** (`recap.rs`, `src/island/recap.ts`, preso da Coucou): il lunedì dalle 8 la settimana prima degli agenti; anche dal menu dell'area di notifica e da Impostazioni → Agenti. Prova: `/?scene=recap`. Manca l'immagine da condividere.

### 9 ottobre 2026 — versione 0.6.2: ricerca, Vassoio, azioni senza selezione
- **Barra di ricerca** in fondo all'isola aperta (`src/views/search.ts`, `start_apps.rs`): integrazioni, sessioni, azioni ⚡ e programmi del menu Start, anche dello Store. Si spegne in Posizione e aspetto. Provata nell'anteprima; i programmi veri solo nell'app installata.
- **Vassoio:** la puntina fissa un file, che resta dopo il riavvio e con «Svuota» (`inbox-kept.json`).
- **Cielo del Meteo dopo un avvio:** il primo giro dei controlli parte con l'app, spesso prima che l'isola ascolti `widget-update`, e il Meteo (ogni 15 min) restava senza cielo fino al giro dopo. Ora l'isola chiede gli ultimi risultati quando è pronta (`widget_results`, `catchUpWidgets`).
- **Fuoco nella barra di ricerca** quando apri tu l'isola; non per gli avvisi.
- **Azioni ⚡:** «Chiedi a Claude» ora è «Chiedi alla chat». Senza selezione o con appunti vuoti l'azione apre la chat con la domanda già scritta, invece di «Nessun testo selezionato in Browser».

### 9 ottobre 2026 — fine della risposta da un altro programma
- La card «finito» compariva solo se nell'isola era in primo piano la scheda della sessione: con un'altra scheda c'era solo il segno sulla pillola (il `Stop` arrivava, si vede nel log). Ora compare sempre, tranne quando in primo piano c'è l'app della sessione stessa (Claude, opencode, terminale, VS Code). Provato nell'anteprima (`/?scene=agenti`) con Claude Code (terminale e app Claude) e opencode, simulando il programma in primo piano. Da provare dal vivo.

### 8 ottobre 2026 — cielo del Meteo sul personaggio
- Le «gocce che salgono» erano il sudore dello stato `ratelimit`, che il Meteo usava per la pioggia probabile. Ora il sudore cade lungo la testa.
- Il Meteo manda il tipo di cielo (`sky_kind` in `probes.rs`). Il personaggio lo porta sopra la testa (`character/weather.ts`) sulla pillola Meteo e, con «Cielo sul personaggio: anche quando è inattivo», da inattivo. Prova: `/?scene=meteo`, provato dal vivo il 9 ottobre.
- Nelle pillole e nella Panoramica, Meteo, Appunti, Musica e Consumo mostrano l'icona della loro scheda al posto del pallino.
- Appunti lunghi allargavano la card oltre l'isola quando era da sola (`.overview.solo > .left` senza `min-width: 0`). Ora si troncano con i puntini.

### 8 ottobre 2026 — domande di opencode nell'isola
- «EasyIsland dice fallito»: il modello aveva chiamato `question` con argomenti sbagliati, poi ha riprovato e opencode aspettava la risposta, invisibile nell'isola.
- Ora le domande di opencode 2 (form) sono la card «ask» e si risponde dall'isola; lo step di errore dice strumento e motivo. Aperta: la prova dal vivo.

### 8 ottobre 2026 — scena con due agenti
- `/?scene=agenti` in `dev/scenes.ts`: Claude Code e opencode (eventi come da `opencode_agent.rs`) nella scheda Agenti, con la barra dei pulsanti. `&claude` seleziona Claude Code. L'isola resta fissata.

### 8 ottobre 2026 — documentazione divisa in `docs/`
- `CLAUDE.md` diventa un indice con le regole. I dettagli sono in `docs/`. L'HANDOFF tiene solo lo stato. Archivio e registro vecchio sono in `docs/archivio/`.
- Tolto `OPTIMIZATIONS.md`: le sue segnalazioni (panici, rebuild per frame) non erano vere nel codice e la CPU non è un problema; le due pulizie reali sono in `docs/idee.md`.

### 8 ottobre 2026 — scheda Agenti per tutti gli agenti
- Gli eventi di opencode arrivavano, ma la scheda Agenti era legata a Claude: ora vale per ogni agente, con la barra dei pulsanti e «In attesa».
- «Apri opencode» porta a Desktop o al terminale, mai a VS Code. Ogni evento di opencode è nel log.
- Aperta: la prova dal vivo.

### 8 ottobre 2026 — «Claude e opencode non funzionano»
- Claude: il login di Claude Code su questo PC è scaduto; la chat ora lo spiega.
- opencode: mancava il modello salvato. Ora si salva mentre si scrive e un avviso lo segnala. Le sessioni di EasyIsland si cancellano da sole.

### 8 ottobre 2026 — opencode 2: motore della chat e agente dal servizio
- `opencode.rs` (server privato, permessi nell'isola) e `opencode_agent.rs` (segue il servizio in background). Il plugin resta solo per la 1.x. Dettagli in `docs/chat.md` e `docs/agenti.md`.

### 8 ottobre 2026 — versione 0.6.0
- Correzioni di layout, scheda attiva sulla ⌂, Azioni rapide (bozze con Salva/Annulla, ordine delle cartelle, «Programma» con ShellExecute), plugin di opencode 1.x.

### 8 ottobre 2026 — Impostazioni riordinate e revisione
- **«Agenti e chat» diviso in due pagine.** **Chat** (`claudeChatSection`): «Predefinito» con i soli nomi dei motori e una riga che dice cos'è quello scelto (`ENGINE_HINTS`), poi solo le impostazioni di quel motore; la guida a Claude Code compare solo se manca; i **Connettori** (`connectorsBlock`) stanno dentro il blocco dell'abbonamento Claude, l'unico che li usa. **Agenti** (`agentsSection`, `agentRow`, id di pagina ancora `claude`): una riga per agente con stato («Collegato», «Da aggiornare»…), una frase e un pulsante; il relay una volta sola in cima; l'anteprima con il diff si apre sotto la riga; opencode ha sulla stessa riga «Segui opencode 2» e il plugin 1.x; «Scheda nell'isola» in una sezione a parte. Corretto il testo di opencode che mostrava `.configopencodeplugins` (barre perse). Rimandi a «Agenti e chat» aggiornati (messaggi di `claude_cli.rs`, README).
- **Revisione:** il server privato di opencode ora si ferma con tutto l'albero dei processi (`actions::kill_tree`, anche le shell aperte), all'uscita anche senza il lock (`SERVER_PID`); il timer d'inattività di un server vecchio non tocca quello nuovo (`generation`); se opencode non conosce più la sessione della chat se ne apre una nuova e si riprova una volta (`SESSION_GONE`); passi `execute` e `skill` con un nome italiano; l'agente opencode accorcia le stringhe a 2.000 caratteri come il relay; «Programma» usa `ShellExecuteExW` con `SEE_MASK_FLAG_NO_UI` (un nome sbagliato è un errore nell'isola, non una finestra di Windows). Test dal vivo ripassati, nessun opencode orfano dopo `shutdown`.
- Schermate `settings*.png` e `drop.png` rifatte (`scripts/screenshots.mjs`; l'errore EPERM finale è solo la pulizia della cartella temporanea di Edge).

### 8 ottobre 2026 — opencode 2: motore della chat e agente dal servizio
- **Scoperto sul PC:** opencode installato è la **2.0.24** (`@opencode/cli` da npm, `%APPDATA%
pm
ode_modules\@opencode\cliin\opencode.exe`), con un servizio in background già acceso (`opencode service status` → `http://127.0.0.1:49374`, password in `~/.config/opencode/service.json`). API e plugin diversi dalla 1.x: vedi sezione 4. Provato dal vivo con un server privato e il modello gratuito `opencode/big-pickle`.
- **Motore della chat `opencode`** (`src-tauri/src/opencode.rs`): `find_exe` (prima l'exe vero dietro gli shim di npm, che passando da cmd non si potrebbero fermare), server privato su porta libera con password casuale, spento dopo 10 minuti senza messaggi e all'uscita (`RunEvent::Exit` → `opencode::shutdown`); sessione con `rules()`; un turno apre `/api/event`, manda `/prompt`, porta il testo con `chat-stream` e i passi come righe `> ⚙ Esegue · \`…\``; permessi con `pipe::request_decision` (estratta da `handle`), «Sempre» solo per `read_only()`, nessuna risposta = `reject`; un rifiuto diventa la risposta «Permesso negato» invece di un errore; nessun evento per 3 minuti = turno interrotto; chiamate brevi con timeout 60 s. Test dal vivo (`#[ignore]`): `cargo test --lib opencode::tests::live -- --ignored` (comando, seguito, rifiuto). Il trait `Ask` esiste perché i test non colleghino la webview: un test che raggiunge `AppHandle::emit_to` fa fallire l'avvio del binario dei test con `STATUS_ENTRYPOINT_NOT_FOUND`.
- **Impostazioni → Chat:** «Motore predefinito»; blocco opencode senza chiave né indirizzo, modello `fornitore/modello`, avviso sulla privacy per i modelli `opencode/…` (Zen). **Nella chat** il menu dei motori sceglie solo per la conversazione (`State.chatEngineOverride`, `chat_send` riceve `engine`), mostra «(predefinito)» e solo i motori pronti (Claude Code solo con il login, chiesto una volta).
- **Agente opencode 2** (`src-tauri/src/opencode_agent.rs`, interruttore «Segui opencode 2» = `opencodeWatch`, spento di serie): segue lo stream del servizio e lo traduce negli eventi di Claude Code con `easyisland_agent` opencode; diff, esito dei test e patch con il codice del relay incluso via `#[path]` (`hook_diff`, `hook_testrun`, `hook_agents`); permessi con `pipe::request_decision_as` (id scelto da noi) e risposta al servizio, `permission.replied` libera l'attesa con `pipe::decline`. Provato dal vivo che trova il servizio e legge lo stream; una sessione vera del TUI non ancora.
- Card dei permessi della chat: per opencode mostra il comando così com'è e «Sempre» quando offerto.

### 8 ottobre 2026 — versione 0.6.0: opencode e correzioni dalla prova
- **Layout:** la griglia della Panoramica e quella delle pillole usano `minmax(0, 1fr)` e il nome si tronca con i puntini (un titolo di canzone lungo allargava la colonna oltre l'isola); l'etichetta delle pillole ha un margine simmetrico di 32 px, quindi non passa più sotto il mini personaggio; la bolla dei messaggi in chat va a capo anche su un percorso o un link senza spazi (`overflow-wrap: anywhere`). Scene di prova: `?scene=clipboard&long`, `?scene=media&long&summary`, `?scene=chat&long`.
- **Scheda attiva sulla ⌂:** la scheda dell'ultima integrazione aperta restava accesa insieme alla casa (in `buildHeader` mancava `!showsSummary()`).
- **Azioni rapide (Impostazioni):** ogni modifica resta una bozza (`drafts` in `actionsSection`) con bordo ambra e Salva / Annulla; una nuova azione esiste solo come bozza finché non la salvi («Scarta»). Spostare ed eliminare valgono subito, come l'icona della cartella. **Ordine delle cartelle:** riga con ‹ › che scambia i gruppi di azioni delle due cartelle nella lista (nessun campo nuovo nelle impostazioni: la ⚡ ordina le cartelle per prima azione).
- **«Programma» che non partiva:** `open_app` (`actions.rs`) toglie le virgolette («Copia come percorso»), espande `%VARIABILI%` e, se CreateProcess fallisce, usa ShellExecute (App Paths: chrome, winword…; `shell:`/`ms-settings:`; richiesta di elevazione per regedit e simili).
- **«Nessun testo selezionato in Browser»:** le azioni rapide dell'utente su «Testo selezionato» non usano più l'etichetta della regola di contesto: messaggi ed etichetta valgono per qualsiasi app (i suggerimenti ⚡ la tengono).
- **opencode** come agente: plugin `~/.config/opencode/plugins/easyisland.js` (sorgente `src-tauri/src/opencode-plugin.js`, `Target::OpenCode` in `hooks.rs`, con backup, diff e conferma; un file con lo stesso nome non di EasyIsland non viene toccato), traduzione in `agents.rs` (`opencode`): eventi, nomi degli strumenti e argomenti camelCase; `permission.asked` → PermissionRequest con «Sempre» sui pattern `always` di opencode (sessione). Il plugin non aspetta mai negli hook; per un permesso aspetta l'isola in parallelo e risponde al server di opencode; se rispondi in opencode (`permission.replied`) chiude il relay. Provato con un relay finto e un client finto; con opencode vero ancora no.
- Versione 0.6.0 su `claude/sviluppo`, installata su questo PC. Unione in `main` e tag da fare con la conferma di Edoardo. Rimandati: personaggi e multilingua.

### 8 ottobre 2026 — segnalazioni dalla prova
- Il tag `v0.5.9` era già pubblicato (su `origin/main`); il `main` locale era fermo alla 0.5.8.
- In sezione 4 le segnalazioni di Edoardo dalla prova (layout, scheda attiva, azioni rapide, funzioni nuove, richieste da decidere).
- Aperti: tutte le segnalazioni di layout e delle azioni, nessuna toccata nel codice.

### 7 ottobre 2026 — opencode studiato, scheda Agenti
- Piano per opencode (motore della chat con strumenti + permessi nell'isola, poi agente) in sezione 4, con le prove fatte sul server di opencode.
- La scheda «Claude Code» diventa **Agenti** (icona del terminale `ICONS.terminal`, di serie): potrebbe servire anche solo per opencode. In Impostazioni → Claude → «Scheda nell'isola»: icona del terminale, logo di Claude (`@logo`), nome «Agenti» (`@name`) o emoji.
- Tag `v0.5.9` non creato da qui: il proxy dell'ambiente rifiuta l'invio dei tag; va creato da Edoardo (`git tag -a v0.5.9 origin/main` + push, o una release su GitHub).

### 7 ottobre 2026 — versione 0.5.9
- README aggiornato (Panoramica, scheda Claude Code, larghezza/altezza, schermi, Vassoio, cartelle delle azioni, ciao al passaggio) e schermate rifatte con `scripts/screenshots.mjs` (qui con Chromium su Linux: i caratteri possono differire leggermente da Edge).
- Versione 0.5.9 in `package.json`, `Cargo.toml`, `tauri.conf.json`, lock; unita in `main`. Rust non compilato in questa sessione: la CI su Windows è il primo controllo.

### 6 ottobre 2026 — correzioni dalla prova di Edoardo
- **EasyTech** prende il colore del tema e quello dell'integrazione in primo piano (`wearsIntegrationColor: true`); senza, resta il logo.
- **Panoramica (⌂)** = riepilogo di tutte le integrazioni (`State.summary`, `renderSummary` in `views.ts`; clic su una riga → la sua card; le righe si riordinano trascinandole, stesso ordine delle pillole `pillOrder`, bloccabile con `lockOrder`). **Claude Code** ha una scheda fissa sua (`tab:claude`) e non è più una pillola (aspetto: icona ✳ di serie, nome o emoji in Impostazioni → Claude → "Scheda nell'isola", salvato in `integrationTabIcons.integration_claude`, `@name` = nome); "VS Code" rinominato "Claude Code" ovunque.
- **Schermi secondari:** trascinando il personaggio su un altro schermo `screen` diventa `monitor:<nome>` (`island::screen_for_drop`, `end_drag`); torna al principale se lo schermo manca. Trascinamento ancorato al cursore in pixel fisici (`drag_grab` in `PollGate`, `drag_island`): sommare i delta della pagina faceva scivolare il personaggio via dal cursore tra schermi con scala diversa. Al cambio di scala (`watchScale` in `island.ts`, `matchMedia resolution`) le tele si ridisegnano e, finito il trascinamento, `reposition` ridimensiona la finestra: prima serviva aprire e chiudere l'isola.
- **3CX:** Recenti/Perse hanno un titolo con ✕, e lo stesso link richiude l'elenco.
- **«Apri»:** destinazioni per PC (Gestione attività), Sicurezza, Rete, Appunti, Meteo, Outlook, 3CX (`open_integration` in `lib.rs`, solo bersagli fissi); dove non c'è nulla da aprire il pulsante non compare (`canOpen`).
- **«Annulla» su un file rilasciato** ora annulla davvero: toglie la copia dal vassoio e torna indietro (`cancelDrop`, `dropSeq` per la copia che arriva dopo).
- **Vassoio:** pulsante «Vassoio» su «Cosa vuoi farne?» (canvas e vista DOM: il file resta, si apre il vassoio); pulsante griglia/elenco (ricordato in `localStorage`).
- **Larghezza e altezza dell'isola aperta** (lo zoom della prima versione è stato tolto, non era richiesto): `islandWidth` (560–704 px, di serie 640) e `islandHeight` (altezza minima, 0 = quella di ogni vista), del PC. Si trascina l'angolo libero dell'isola aperta (`wireResize`, `#island-resize`; doppio clic = predefinite) o si regolano in Impostazioni → Posizione. Saluto e sequenza del file restano alla loro misura (`FIXED_SIZE_VIEWS`). Il contenuto si adatta: `--extra-h` (altezza in più rispetto a quella naturale della vista) allunga i `max-height` delle liste (3CX, Appunti, Vassoio, ZIP, diff, piano, domande, dettagli), `--extra-w` allarga la card sinistra della panoramica; nuove liste a scorrimento vanno scritte con `calc(Npx + var(--extra-h, 0px))`. Il limite è la finestra 720×560 (`PANEL_W/H`): per andare oltre va ingrandita anche in Rust.
- **Loghi dei marchi** (3CX, Claude, GitHub, n8n, Notion, Outlook, Resend, Stripe, Vercel, Zammad): copiati da `brand/` in `src/views/brands.ts` come SVG nel codice (`scripts/gen-brands.mjs`, viewBox ritagliati, nero → `currentColor`); l'app non legge mai `brand/`. Usati da `brandOrDot` nelle intestazioni delle card, nelle schede, nella Panoramica e come icona della scheda Claude Code, e a destra nelle pillole. Le schede in alto possono mostrare solo il logo: "Scheda in alto, con il logo" (`integrationTabIcons[id] = "@logo"`).
- **Colori del personaggio sulla Panoramica:** prima restava col colore e lo stato dell'ultima integrazione aperta (es. 3CX blu e "inattivo" mentre Claude lavorava). Ora sulla ⌂ (`State.characterTask` = null) tiene il colore del tema e mostra lo stato più urgente di tutte (`URGENCY` in `state.ts`: permesso > domanda > errore > limite > lavoro > … > riposo).
- **Ciao al passaggio del mouse** sul personaggio a riposo: balzo verso di te, occhi felici, una mano alzata con un piccolo dondolio (`BotEngine.hello()`, `waveCalm`; diverso dal saluto d'avvio che sventola e suona). Al passaggio l'icona a riposo lascia subito il posto alla vista compatta (fsm hidden → petit), quindi il ciao lo fa il personaggio compatto: `hoverHello()` in `island.ts` (icona, striscia, isola compatta; una volta ogni 1,5 s, guarda il cursore intanto). Prima versione rotta: animava l'icona a riposo, già nascosta.
- **Cartelle nelle Azioni rapide:** campo «Cartella» su ogni azione (`QuickAction.folder` = "i:<icona> Nome", o "🖥 Nome", o "Nome"; `folderLook`/`folderValue` in `state.ts`; l'icona si sceglie dalla stessa griglia delle azioni e vale per tutte le azioni con quel nome; raggruppate per nome); nella scheda ⚡ prima le cartelle (bordo tratteggiato, numero di azioni), poi le azioni sciolte; dentro una cartella ‹ per tornare. Oltre 8 azioni compare «Cerca un'azione» (tutte, cartelle comprese; Invio esegue la prima, Esc svuota). Le azioni sui file rilasciati non hanno cartella.
- Aperti: prova dal vivo di schermi secondari, Start, ridimensionamento.

### 6 ottobre 2026 — handoff ridotto
- `HANDOFF.md` ridotto al minimo per riprendere il lavoro; la versione completa (roadmap 6.1–6.6, analisi 3CX, idee del 2 ottobre, registro dal 1° al 6 ottobre) era in `HANDOFF-archivio.md` (ora `docs/archivio/HANDOFF-fino-al-6-ottobre.md`), non più aggiornata.
