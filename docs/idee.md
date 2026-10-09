# Idee e progetti non ancora fatti

I dettagli che `HANDOFF.md` riassume in una riga. Le idee più vecchie e l'analisi di 3CX sono in `archivio/HANDOFF-fino-al-6-ottobre.md`, sezione 7.

## 3CX + Zammad: ticket del cliente sulla chiamata in arrivo
- Quando squilla, sotto il chiamante compaiono i suoi ticket Zammad aperti (titolo, stato, da quanto). Un clic apre il ticket.
- Dal numero normalizzato (`+39`, spazi, zeri) si cerca il cliente in Zammad, poi i ticket non chiusi suoi o della sua organizzazione.
- Da verificare sul server: `/api/v1/users/search` e `/api/v1/tickets/search` funzionano senza Elasticsearch?
- Regole: solo con entrambe le integrazioni accese, tutto in memoria, niente nomi né titoli davanti al cliente, nessuna azione senza un clic.
- Seguito possibile: «Nuovo ticket» dalla chiamata.

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
2. **Limiti del piano Claude** dalla `statusLine` di Claude Code, che riceve `rate_limits`: `--statusline` inoltra solo quelli e poi esegue la status line di prima (Git Bash su Windows, mai `cmd /C`). L'installazione tocca solo la chiave `statusLine`, con diff e backup. Funziona nel terminale, non nell'app desktop. Ci sono anche i limiti di Codex.
3. **Card del permesso «ripiegabile»:** il chevron o Esc la riducono all'isola compatta senza rispondere. La richiesta resta in attesa e ricompare riaprendo l'isola.
4. **Riepilogo settimanale** il lunedì (tempo, sessioni, file e righe, comandi, permessi), solo in locale, condivisibile come immagine.
5. **GitHub:** PR con CI e revisioni, avvisi CI rossa/verde, griglia dei contributi. Da noi «GitHub rinnovato» era escluso.

## Altro
- **Scheda esatta di Windows Terminal** per «Apri»: il relay legge il titolo della console e l'app seleziona la scheda con UI Automation. Da sperimentare con una sessione vera. Tolta dal Da fare il 9 ottobre: per ora non serve.
- **Azioni nel menu contestuale** (clic destro su file o testo in Windows): da valutare. Per i file serve una voce nel registro di Windows (`HKCU\Software\Classes\*\shell`) che passa il percorso all'app (scrittura solo dopo la conferma di Edoardo). Per il testo selezionato Windows non ha un menu comune: resta la scorciatoia.
- **Funzioni chieste da Edoardo:**
  - ricerca unica (integrazioni, azioni, programmi installati)
  - interfaccia ITA/ENG
  - cronologia delle sessioni di chat
  - personaggio trascinato su una cartella → ne aggiunge il percorso alla chat
- **Da decidere prima di farle**, perché vanno contro `decisioni.md`: file del Vassoio «permanenti» solo se deciso dal'utente tramite un flag; nuovi personaggi (polpo, rana, granchio, geco). Le prove dell'8 ottobre sono venute male: rimandati. Rimandate anche le pose di Goccia della tavola del 3 ottobre (saluto con la mano, salto, caduta, onda): oggi usa quelle comuni.
- **opencode, ancora aperti:**
  - nella **chat** lo strumento `question` è negato (`opencode.rs`): la card c'è già per l'agente (`opencode_agent.rs`, form), si può riusare;
  - nell'elenco dei modelli manca l'indicazione gratuito/a pagamento;
  - il menu dei motori non controlla se Ollama/LM Studio rispondono.
- **Decisioni aperte:**
  - quali integrazioni tenere (Stripe, Resend, Cal.com…)
  - firma del codice (Authenticode o Azure Trusted Signing)
  - tag `windows-latest` sul repo, creato per sbaglio
  - funzioni del Mac mai portate (invio di un file per email, personaggio trascinato su una finestra per allegarla)
- **Idee da valutare:** libreria di comandi PowerShell/cmd con conferma; casa (promemoria, Home Assistant); integrazioni proposte il 2 ottobre (Windows Update, stampanti bloccate, Teams, Docker, Git locali, WSL, IMAP, DNS/blacklist, pagine di stato, CISA KEV, RSS, ntfy/Telegram, Uptime Kuma, Proxmox, Synology/TrueNAS, UniFi, Pi-hole, GLPI).

## Pulizia del codice (solo quando si tocca quel file)
- `mmss` è duplicato in `src/views/integrations.ts` (secondi) e `src/views/threecx.ts` (millisecondi); anche il «Copiato ✓» temporaneo è ripetuto in più viste.
- File molto lunghi da spezzare solo se si lavora lì: `src/settings/main.ts` (~2.770 righe), `src/island/island.ts` (~2.060), `src/character/engine.ts`, `src-tauri/src/lib.rs`.
