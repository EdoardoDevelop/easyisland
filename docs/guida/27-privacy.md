# Privacy e sicurezza
> sezione: Riferimento
> in breve: Cosa resta sul PC, cosa esce, dove stanno i segreti e cosa EasyIsland non farà mai.

## Cosa non fa mai
- **Inviare un'email** o **approvare un permesso** senza il tuo clic. Unica eccezione: l'«Automatica» di Telegram accesa da te, che chiede comunque per le cancellazioni.
- **Eseguire comandi qualsiasi** su questo PC dagli strumenti dell'AI: solo le tue azioni rapide, o la modalità terminale con un permesso per ogni comando.
- **Eliminare**: gli strumenti non cancellano, tranne una riga di Notion nel suo cestino dopo il tuo sì in chat; la cartella di lavoro usa il Cestino di Windows; la memoria archivia e non cancella.
- **Sovrascrivere** le configurazioni degli agenti: prima un backup datato, il diff e la tua conferma.
- **Bloccare un agente**: se EasyIsland non risponde, l'agente continua da solo.
- Accettare tutto senza controllo: la modalità che salta ogni permesso non esiste.

## Segreti
Chiavi API, token, password e link segreti stanno in **Gestione credenziali di Windows**, mai su disco, mai nell'interfaccia, mai in git, mai nei backup. L'interfaccia può solo chiedere se una chiave esiste. Le password dell'Accesso remoto restano solo in memoria finché la connessione è aperta. Le mappe di Notion e di RDM sul disco sono cifrate con la protezione dati di Windows (DPAPI).

## Rete
**Nessuna telemetria.** Le richieste vanno solo:
- ai servizi che configuri tu (motori AI, integrazioni, widget, integrazioni personali verso gli host scritti nella loro descrizione);
- a GitHub per il **controllo degli aggiornamenti**, spegnibile in Impostazioni → Generale.

Gli aggiornamenti si installano **solo dopo un clic**, con la **firma verificata**. Nessuna porta viene aperta sul PC (Telegram usa il long polling).

## Cosa resta sul PC
| Dato | Dove | Note |
|---|---|---|
| Cronologia della chat | `%LOCALAPPDATA%\EasyIsland\chats.json` | Fino a 100 conversazioni; si svuota o si spegne |
| Memoria, diario, pagine | `%APPDATA%\EasyIsland\memoria` | File .md leggibili; si spegne con la cronologia |
| Compiti, abilità, integrazioni personali | `%APPDATA%\EasyIsland` | File leggibili |
| Appunti | Solo in memoria | Gli elementi privati dei gestori di password non vengono registrati |
| Modifiche degli agenti | Solo in memoria | 50 modifiche, un'ora al massimo |
| Riepiloghi degli agenti | `recap.json` | Solo numeri e nomi delle cartelle |
| Abitudini (se accese) | Sul PC | Solo nomi di programmi e orari, 45 giorni, si cancellano con un clic |
| Log | `%LOCALAPPDATA%\EasyIsland\easyisland.log` | Eventi tecnici, senza contenuti |

## Davanti al cliente
Durante chiamate, riunioni e assistenza remota il personaggio si nasconde e nessun nome, titolo o testo compare sullo schermo. Vedi [Profili e notifiche](06-profili.md#davanti-al-cliente).

## Modelli AI
Quello che scrivi in chat va al motore che scegli. Con i modelli gratuiti online i dati possono essere usati per l'addestramento: per i dati dei clienti usa un piano a pagamento o un modello locale (Ollama, LM Studio), che non esce dalla rete.
