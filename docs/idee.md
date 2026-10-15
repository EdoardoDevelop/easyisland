# Idee e progetti non ancora fatti

I dettagli che `HANDOFF.md` riassume in una riga. Le idee più vecchie e l'analisi di 3CX sono in `archivio/HANDOFF-fino-al-6-ottobre.md`, sezione 7.

## 3CX + Zammad: ticket del cliente sulla chiamata in arrivo
- Quando squilla, sotto il chiamante compaiono i suoi ticket Zammad aperti (titolo, stato, da quanto). Un clic apre il ticket.
- Dal numero normalizzato (`+39`, spazi, zeri) si cerca il cliente in Zammad, poi i ticket non chiusi suoi o della sua organizzazione.
- Da verificare sul server: `/api/v1/users/search` e `/api/v1/tickets/search` funzionano senza Elasticsearch?
- Regole: solo con entrambe le integrazioni accese, tutto in memoria, niente nomi né titoli davanti al cliente, nessuna azione senza un clic.
- Seguito possibile: «Nuovo ticket» dalla chiamata.

## Account Microsoft: mail nuove e calendario (annotata il 14 ottobre 2026, da decidere)
- **Via principale, Microsoft Graph:** «Accedi con Microsoft» nelle Impostazioni (browser, permessi di sola lettura `Mail.Read`, `Calendars.Read`, accesso con PKCE e indirizzo locale di ritorno). Vale per account di lavoro (Microsoft 365) e personali (Outlook.com), senza Outlook aperto e anche con il nuovo Outlook. Controllo circa ogni minuto (le notifiche push di Graph vogliono un server pubblico). Card «mail nuova» con mittente e oggetto, Apri e Chiedi alla chat (riassunto o bozza, mai inviata); card prima di un evento con «Partecipa» per Teams (`onlineMeeting.joinUrl`). Poi «quando» per le automazioni (idea 2 sotto).
- **Vincoli:** token di aggiornamento in Gestione credenziali; rete solo verso Microsoft e solo con l'integrazione accesa. Serve registrare una volta l'app in Microsoft Entra (gratis): ne esce un ID applicazione pubblico, non segreto.
- **Problema:** molte aziende bloccano il consenso degli utenti alle app esterne → serve l'ok dell'amministratore IT («Richiede l'approvazione dell'amministratore»). Mai aggirarlo (per esempio con l'ID di un'app di Microsoft già approvata).
- **Ripieghi senza consenso dell'IT:**
  1. Outlook classico (`outlook.rs`, c'è già): aggiungere l'avviso di mail nuova con mittente e oggetto. Solo con Outlook classico aperto.
  2. Notifiche di Windows (`UserNotificationListener`, permesso «Accesso alle notifiche» dato dall'utente): l'isola mostrerebbe quelle di nuovo Outlook, Outlook web e Teams. **Da provare prima:** potrebbe servire l'identità di pacchetto (pacchetto sparse).
  3. Link ICS pubblicato da Outlook web nel widget Calendario (c'è già); alcune aziende bloccano anche questo, e non copre le mail.
- Domande aperte per Edoardo: Outlook classico o nuovo; chi amministra il Microsoft 365 aziendale.

## Notion, seconda parte (annotata il 14 ottobre 2026)
Edoardo usa Notion per attività, note, documentazione e clienti. Fatti: attività, nota veloce, pagine fissate, ricerca, chat sulla pagina. Restano:
- **«Manda a Notion»** da una voce degli Appunti e dalla risposta della chat. Dal testo selezionato c'è dal 15 ottobre 2026.
- **Clienti:** un database clienti scelto nelle Impostazioni con la proprietà del telefono; su una chiamata 3CX in arrivo, e su un ticket Zammad, la scheda del cliente (nome, note, link) con «Apri in Notion». Numero normalizzato come per Zammad.
- Fatti il 15 ottobre 2026: gli avvisi delle scadenze con orario e dei commenti nuovi, la configurazione rapida, «+ Attività» e «Rimanda».
- **Viste legate ai profili:** con il profilo «Ufficio» la card apre da sola la vista «Ufficio» (le viste ci sono dal 15 ottobre 2026).
- Attività assegnate a me: serve scegliere la persona (l'API vede il bot, non l'utente).

## Remote Desktop Manager (Devolutions), come integrazione
- **Prima di tutto:** capire dove sta la fonte dati delle voci (Devolutions Server, Hub, database SQL o file locale).
- Cosa offre RDM: `rdm://open?Filter=<testo>`, `RemoteDesktopManager.exe /DataSource:<id> /Session:<id>` e il modulo PowerShell Devolutions.PowerShell (`Get-RDMSession`, PowerShell 7.2+).
- Passi:
  1. cerca e apri dall'isola con `rdm://open?Filter=…`;
  2. «Apri in RDM» sulla chiamata 3CX e sui ticket Zammad;
  3. suggerimento ⚡ «Cerca in RDM» su un nome di server o un IP selezionato;
  4. solo se serve, l'elenco delle voci dentro l'isola.
- Oggi, senza codice: azione rapida «Programma» con gli id. Da non fare: legare RDM a «davanti al cliente».

## Spunti da Coucou (letto l'8 ottobre 2026, `louis-cfm/coucou` Windows/Linux 0.2.0)
1. Lo stesso schema del plugin di opencode vale per **Amp** e **Hermes**.
2. **Limiti di Codex** (fatti quelli di Claude il 9 ottobre): Coucou chiede `account/rateLimits/read` a `codex app-server` (`codex_plan.rs`).
3. **Riepilogo settimanale come immagine** da condividere (fatto il riepilogo il 9 ottobre): in Coucou `recap/share.ts`, con «Nascondi i nomi dei progetti».
4. **GitHub:** PR con CI e revisioni, avvisi CI rossa/verde, griglia dei contributi. Da noi «GitHub rinnovato» era escluso.

## Proposte al momento giusto (annotate il 13 ottobre 2026)
Fatte il 14 ottobre 2026: download finito, errore copiato, server di sviluppo partito, password e chiavi tolte dagli appunti dopo 30 s (`strumenti.md`), riepilogo del mattino e di fine giornata, EasyIsland come server MCP per Claude Code (`agenti.md`). Possibili seguiti: «Chiudi il programma» sulla porta occupata (oggi solo chi la tiene), la cartella del progetto nella card del server di sviluppo (servirebbe leggere la riga di comando del processo).
- **Dettatura ripulita:** tieni premuta una scorciatoia, parli anche male, nel campo arriva la frase pulita. Vuole riconoscimento vocale: un modello locale da ~200 MB o un servizio esterno; per ora no.
- **Personaggio che cresce con l'uso:** gioco e timer sono esclusi (`decisioni.md`); resta solo la domanda già aperta del personaggio che esce dall'isola e vive sul desktop.

## Automazioni più intelligenti (ragionate il 14 ottobre 2026, da decidere con Edoardo)
Oggi un'automazione è «quando → (solo nel profilo) → passi fissi». Possibili passi avanti, dal più utile:
1. **Dati del «quando» nei passi:** `{file}`, `{cartella}`, `{rete}`, `{programma}`, `{ticket}`, `{chiamante}` dentro link, azioni rapide e domande alla chat (es. nuovo file in una cartella → «Chiedi alla chat di riassumere {file}»). Serve un segnaposto sicuro: nei link codificato, negli script solo come argomento, mai incollato nel comando.
2. **«Quando» nuovi**, dagli eventi che l'isola già vede: download finito, server di sviluppo partito, agente che ha finito o aspetta un permesso da N minuti, chiamata 3CX in arrivo o finita, N minuti prima di un evento del calendario, fine giornata (`eveningHour`), rientro dopo una pausa (inattività).
3. **«Se» più ricchi**, anche più d'uno insieme: fascia oraria e giorni, rete Wi-Fi, alimentazione o batteria, programma aperto, in riunione (microfono/webcam), davanti al cliente, nessun agente al lavoro. Più «al massimo una volta al giorno / ogni N minuti» contro le ripetizioni.
4. **Passi più flessibili:** «aspetta N minuti», «chiedi prima» (card con Esegui/Annulla e conto alla rovescia di pochi secondi per i passi che disturbano), «ferma se il passo prima non è riuscito».
5. **Crea a parole:** «ogni lunedì alle 9 apri Teams e la bacheca dei ticket» → la chat produce la regola, `automations::validate` la controlla, l'utente vede l'anteprima e la crea con un clic. Nessun passo nuovo per il modello: usa solo quelli esistenti.
6. **Decide la chat (passo «valuta»):** il modello legge l'evento (ticket, email, errore) e sceglie fra rami preparati dall'utente («se è urgente → avviso rosso e apri il ticket, altrimenti niente»). Solo scelte fra passi già approvati; mai inviare email, eseguire comandi o eliminare.
7. **Impara dall'uso:** le abitudini (`habits.rs`) propongono anche dai nuovi eventi (es. ogni PDF scaricato viene aperto subito); un'automazione annullata o ignorata spesso propone di spegnersi o cambiare orario; nel registro, quante volte è partita e quante annullata. «Prova ora» per vedere cosa farebbe senza aspettare il «quando».
Proposta di partenza: 1 + 2 + 3 (più utili, nessun modello coinvolto), poi 5, poi 6.

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
- **Idee da valutare:** libreria di comandi PowerShell/cmd con conferma; casa (promemoria, Home Assistant); integrazioni proposte il 2 ottobre (Windows Update, stampanti bloccate, Teams, Docker, Git locali, WSL, IMAP, DNS/blacklist, pagine di stato, CISA KEV, RSS, ntfy/Telegram, Uptime Kuma, Proxmox, Synology/TrueNAS, UniFi, Pi-hole, GLPI).

## Pulizia del codice (solo quando si tocca quel file)
- `mmss` è duplicato in `src/views/integrations.ts` (secondi) e `src/views/threecx.ts` (millisecondi); anche il «Copiato ✓» temporaneo è ripetuto in più viste.
- File molto lunghi da spezzare solo se si lavora lì: `src/settings/main.ts` (~2.770 righe), `src/island/island.ts` (~2.060), `src/character/engine.ts`, `src-tauri/src/lib.rs`.
