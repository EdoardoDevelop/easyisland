# Modalità terminale e strumenti
> sezione: Intelligenza artificiale
> in breve: Cosa può fare l'AI sul tuo PC, con quali permessi, e come lavorare come da terminale.

## Gli strumenti di EasyIsland
Con **Impostazioni → Chat → Può usare il PC** acceso (predefinito), i motori con strumenti (abbonamento Claude, chiave API Anthropic, opencode, Antigravity, e gli altri con la modalità terminale) possono agire sul PC **attraverso EasyIsland**:

| Area | Cosa può fare | Chiede conferma? |
|---|---|---|
| PC e app | Aprire programmi, cartelle e link; sapere l'app in primo piano | Sì |
| Azioni rapide | Elencarle ed eseguirle (anche gli script, di cui legge l'output) | Sì, per eseguire |
| Stato | Leggere PC, rete, meteo, posta, ticket, integrazioni | No |
| Appunti | Leggere e riempire gli appunti | Leggere no, scrivere sì |
| Musica | Stato e comandi del lettore | Comandi sì |
| Isola | Mostrare un avviso | No |
| File | Il Vassoio, la cartella di lavoro (leggere), spostare file nella cartella | Spostare sì |
| Profili e impostazioni | Leggere le impostazioni, cambiarne una, cambiare profilo | Cambiare sì |
| Automazioni | Elencarle, crearle, accenderle e spegnerle | Creare e cambiare sì |
| Notion | Mappa, ricerca, lettura, righe di database; aggiungere, cambiare, eliminare righe | Scrivere sì; eliminare solo dopo il sì in chat |
| Microsoft To Do | Elencare, aggiungere e aggiornare attività (Outlook classico) | Scrivere sì |
| Accesso remoto | Comandi sul PC del cliente collegato alla chat | Sempre, uno per uno |
| Memoria | Cercare, salvare note, scrivere pagine, leggere le fonti, controllare | No (scrive solo nella memoria, non cancella) |
| Compiti e abilità | Creare compiti, elencarli; leggere e salvare abilità | Salvare un'abilità sì |
| Integrazioni personali | Crearle, modificarle, leggere schede e fonti, aggiungere schede, chiamare le loro azioni | Creare, scrivere e chiamare sì |

Tutto ciò che apre, esegue o cambia qualcosa chiede **Consenti / Nega** nell'isola, con una descrizione chiara. Le regole che non cambiano mai:
- nessuno strumento esegue **comandi qualsiasi su questo PC** (per quello c'è la modalità terminale, con un permesso per ogni comando);
- nessuno strumento **invia email**;
- nessuno strumento **elimina**, tranne una riga di Notion nel cestino dopo il tuo sì in chat.

Puoi chiedere a parole: «apri Outlook e il portale fornitori», «com'è messo il PC?», «lancia il backup», «aggiungi a To Do: chiamare Rossi domani», «quanto ho speso a ottobre?» (da Notion).

## Ricette: impara con l'uso
Dopo una risposta riuscita, EasyIsland ricorda **quali strumenti** sono serviti per quel tipo di domanda. Alla domanda simile la chat va dritta agli strumenti giusti: più veloce e con meno token. In **Impostazioni → Chat → Ricette** vedi quante sono e le dimentichi con un clic.

## Modalità terminale
**Impostazioni → Chat → Modalità terminale**, insieme alla **cartella di lavoro**: la chat lavora come Claude Code o opencode da terminale.
- **Claude Code** usa i tuoi strumenti, server MCP, plugin, `CLAUDE.md`, skill, regole di permesso e hook, nella cartella scelta. Ogni domanda di permesso arriva all'isola.
- **opencode** lavora nella cartella scelta; «Sempre» vale per i comandi e le modifiche di cui propone la regola.
- **Gli altri motori** (API di Anthropic, OpenAI, OpenRouter, Gemini, Ollama, LM Studio) passano da opencode con lo stesso fornitore e modello.

Ogni comando compare **per intero** sulla card prima di partire.

### ⚡ Automatica
Il pulsante ⚡ nella testata della chat (solo con la modalità terminale) vale **per la conversazione in corso** e si spegne con «Nuova chat». Da acceso la chat ha il bordo ambra.
- **Claude Code**: la sua modalità automatica approva le azioni normali e blocca quelle rischiose.
- **opencode e gli altri**: passano da soli modifiche ai file, web e comandi non delicati. Restano sulla card i comandi delicati (cancellare, `git push` e `reset --hard`, installare, registro, servizi, rete, processi, codice scaricato), le cartelle fuori da quella di lavoro e gli strumenti dei connettori che cancellano.

La modalità che accetta tutto senza nessun controllo **non esiste** in EasyIsland, di proposito.

## La cartella di lavoro
Una cartella del PC scelta da te (in **File e schermo** o in Impostazioni → Chat) che la chat **legge senza chiedere** e in cui può spostare i file del Vassoio. Con la modalità terminale è la cartella in cui lavora. Da Telegram: `/cartella`. Dettagli in [File e schermo](17-file-e-schermo.md#cartella-di-lavoro).

## Impostazioni cambiate dalla chat
«Metti il personaggio in basso a destra», «spegni il meteo», «usa opencode come motore»: la chat legge le impostazioni e ne cambia una alla volta, con Consenti / Nega, salvando come la finestra delle Impostazioni.
