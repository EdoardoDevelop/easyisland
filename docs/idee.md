# Idee e progetti non ancora fatti

Dettagli di ciò che `HANDOFF.md` riassume in una riga; per ogni voce solo ciò che resta. Idee più vecchie e analisi di 3CX: `archivio/HANDOFF-fino-al-6-ottobre.md`, sezione 7.

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
- Viste legate ai profili (profilo «Ufficio» → vista «Ufficio»).
- Attività assegnate a me: serve scegliere la persona (l'API vede il bot).

## Remote Desktop Manager, dopo le prove
- API REST di DVLS (`Search-DSEntry`/`Get-DSEntry`) o Hub (`Get-HubEntry`) se il modulo non va bene in azienda.
- Creare una voce (`New-RDMSession`, `Set-RDMSession`) con i campi base.
- Strumento per la chat «apri il server di Rossi» con le regole di `run_quick_action`.
- Associazione esplicita cliente 3CX/organizzazione Zammad ↔ cartella RDM.
- Da non fare: legarlo a «davanti al cliente»; leggere password.

### Devolutions Cloud (03/11, dal PC lavoro, da sviluppare)
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

## Resoconti e preventivi con carta intestata (21/10)
- Modelli `.docx`/`.dotx` dell'utente copiati in AppData, mai modificati; segnaposto `{cliente}`, `{data}`, `{numero}`, `{corpo}`.
- `create_document`: modello, titolo, cliente, sezioni → copia con intestazione e piè intatti, nella cartella di lavoro e nel Vassoio, con Consenti/Nega. Docx = ZIP di XML, niente dipendenze.
- Preventivi: l'IA passa solo righe (descrizione, quantità, prezzo, IVA); totali, IVA e numero progressivo li calcola l'app.
- PDF con Word installato, altrimenti `.docx`. Esclusi editor di documenti e generatore PDF.

## Recapiti tra due EasyIsland (25/10, da valutare)
Casa (sempre acceso) e notebook, due account Claude: uno lavora per l'altro senza mischiare le memorie.
- Compito con «consegna a: l'altro PC»: il risultato è un **pacco** (.md, PDF, riassunto) che l'altro ritira in `da-leggere` e impara col suo motore. Mai memoria, chat o chiavi condivise.
- Bidirezionale; il collegamento sa solo consegnare documenti e chiedere un compito (approvato se non consentito). Mai comandi o lettura dei dati altrui.
- **Niente VPN né cloud.** Opzioni: porta inoltrata a casa (UPnP, TLS, chiave, limiti; DNS dinamico), Telegram come postino (50 MB per file; conta come cloud?), consegna diretta in LAN. Hole punching escluso.
- Sicurezza: abbinamento con codice, chiave in Gestione credenziali, pacchi firmati e cifrati, niente eseguibili, solo in `da-leggere`. Costi a carico di chi esegue; compiti lunghi a passi, di notte, motore gratuito o locale.

## Memoria, seguiti
- **Pulizia proposta:** `brain::check` segnala pagine doppie (alias, titoli, parole in comune) e relazioni ripetute con nomi diversi; il compito propone «unisci» con `task_ask` (la pagina unita va in archivio).
- **Ricerca per significato:** embedding solo se la memoria diventa grande, con modello locale o servizio scelto in Impostazioni.

## Modello integrato (27/10, accantonato)
Fatto nel branch `claude/modello-integrato` (non unito; passi in `docs/modello-integrato.md` del branch), manca la prova dal vivo. Per riprendere: aggiornare il branch con `claude/sviluppo`, verificare build di llama.cpp e hash dei modelli, provare.
- `llama-server.exe` (CPU + Vulkan) scaricato con il primo modello, avviato nascosto solo quando serve e spento dopo minuti senza richieste; API compatibile OpenAI → riusa `openai.rs`. Processo separato (un crash del C++ non chiude l'isola); job object lo chiude con l'app.
- Modelli GGUF 3–8B consigliati in Impostazioni → Chat, «Scarica» dopo clic in `%LOCALAPPDATA%\EasyIsland\models` con SHA-256, eliminabili; anche un GGUF già sul disco.
- Presentarlo per chat e privacy, non per l'agente (i modelli piccoli sbagliano gli strumenti). Utile anche per memoria ed embedding.

## EasyIsland collegati: memoria condivisa (31/10, da decidere)
Notebook spesso spento; VPS con Windows 11 in Docker sempre accesa con un secondo EasyIsland usato da Telegram. Si condivide solo la memoria, anche con due EasyIsland al lavoro insieme (nessun custode). (Agent Chat ha poi aggiunto una memoria condivisa via server: `memshare.rs`.)
- **Collegamento:** un indirizzo raggiungibile, scelta **Tailscale** (nel Windows del container); vale anche VPN aziendale, LAN, porta aperta. Sul notebook DNS di Tailscale spento, indirizzo `100.x.y.z`, niente exit node; sulla VPS chiave senza scadenza. Prima qualche giorno di prova con le VPN dei clienti.
- **Abbinamento** (Impostazioni → «EasyIsland collegati»): codice temporaneo, scambio di chiave (Gestione credenziali), nome per EasyIsland, ascolto solo sull'indirizzo scelto, alla pari e per più di due; stato e «Scollega».
- **Cosa condividere** per collegato e verso: all'inizio la memoria (`MEMORIA.md`, `pagine/`, `diario/`, `da-leggere/`, `fonti/`, archivio); poi promemoria, abilità, automazioni. Impostazioni, chiavi, chat restano locali.
- **Sincronizzazione:** base per file, al collegamento solo il cambiato, poi subito (`brain_watch.rs`); recupero dopo giorni; gli spostamenti in archivio passano.
- **Unione** riga per riga sulla base comune: note e diario uniscono sempre; pagine con stesse righe cambiate tengono anche la copia dell'altro e `check` propone l'unione. `memory_page_write` con versione: scrittura solo se è ancora quella letta.
- **Turni:** riordino, lettura di `da-leggere/` (per file) e pulizia li prende chi arriva prima, con scadenza se si spegne.
- **Telegram:** un bot per EasyIsland.
- Da decidere: protocollo (HTTPS o WebSocket con TLS e chiave), frequenza massima per file, come mostrare le pagine arrivate. Ordine: prova Tailscale, abbinamento, sincronizzazione, turni, altro.

## File e cartelle cliccabili nelle risposte della chat (03/11)
Nelle risposte della chat di EasyIsland i riferimenti a file e cartelle diventano link.
- **Clic:** se il tipo è compatibile, anteprima nella finestra Anteprima accanto alla chat; se non lo è, si comporta come «Apri».
- **Clic destro:** menu con «Apri», «Scarica» e «Apri percorso» (la cartella in Esplora file, col file selezionato).
- Da decidere: quali percorsi riconoscere (assoluti, relativi alla cartella di lavoro o al progetto, `file:riga`), cosa fare se il file non esiste più, cosa fa «Scarica» per un file già sul PC, se vale anche in Agent Chat.

## Altro
- **Scheda esatta di Windows Terminal** per «Apri» (titolo della console + UI Automation): per ora non serve.
- **Clic destro in Esplora file** (deciso l'11/10): voce in `HKCU\Software\Classes\*\shell` scritta dopo conferma; in Windows 11 sotto «Mostra altre opzioni» (il menu nuovo vuole MSIX con `IExplorerCommand`).
- **Personaggi rimandati:** polpo, rana, granchio (prove dell'8/10 venute male); pose di Goccia (saluto con la mano, salto, caduta, onda).
- **opencode:** nella chat `question` è negato (`opencode.rs`): riusare la card dell'agente (`opencode_agent.rs`); il menu dei motori non controlla se Ollama/LM Studio rispondono.
- **Decisioni aperte:** firma del codice (Authenticode o Azure Trusted Signing); tag `windows-latest` creato per sbaglio; funzioni del Mac mai portate (invio di un file per email).
- **Da valutare:** TeamViewer (cosa serve, da chiarire); libreria di comandi PowerShell/cmd con conferma; casa (promemoria, Home Assistant); integrazioni proposte il 2/10: Windows Update, stampanti bloccate, Docker, Git locali, WSL, IMAP, DNS/blacklist, pagine di stato, CISA KEV, RSS, ntfy, Uptime Kuma, Proxmox, Synology/TrueNAS, UniFi, Pi-hole, GLPI.

## Pulizia del codice (solo quando si tocca quel file)
- `mmss` duplicato in `src/views/integrations.ts` (secondi) e `src/views/threecx.ts` (ms); «Copiato ✓» ripetuto in più viste.
- File lunghi: `src/settings/main.ts`, `src/island/island.ts`, `src/character/engine.ts`, `src-tauri/src/lib.rs`.
