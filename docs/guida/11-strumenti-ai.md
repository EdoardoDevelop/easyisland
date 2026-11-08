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
| Documenti Word e PDF | Leggerli; creare documenti Word nuovi, anche dai tuoi modelli e con immagini; farne il PDF con Word; unire e dividere PDF | Creare, fare il PDF, unire e dividere sì |

Tutto ciò che apre, esegue o cambia qualcosa chiede **Consenti / Nega** nell'isola, con una descrizione chiara.

**Permessi per livelli.** Leggere è sempre libero. Le azioni che si possono annullare (aggiungere o cambiare righe di Notion e attività di To Do, mettere file nel Vassoio, spostarli nella cartella di lavoro) hanno anche **Sempre** sulla card: da lì in poi la chat le fa senza chiedere, finché non le togli in **Impostazioni → Chat → Permessi degli strumenti**. «Sempre» c'è anche nei pulsanti di Telegram. **Cosa ho fatto** elenca ogni azione che ha cambiato qualcosa, dalla chat, da Telegram o da un compito, con **Annulla** per quelle che si possono annullare: è in Impostazioni → Chat e nell'isola (scrivi «cosa ho fatto» nel campo in alto). Quando un'azione passa senza chiedere, l'isola te lo dice con **Annulla** a portata di clic. Inviare, eliminare, aprire, eseguire e cambiare le impostazioni chiedono ogni volta.

Le regole che non cambiano mai:
- nessuno strumento esegue **comandi qualsiasi su questo PC** (per quello c'è la modalità terminale, con un permesso per ogni comando);
- nessuno strumento **invia email**;
- nessuno strumento **elimina**, tranne una riga di Notion nel cestino dopo il tuo sì in chat.

Puoi chiedere a parole: «apri Outlook e il portale fornitori», «com'è messo il PC?», «lancia il backup», «aggiungi a To Do: chiamare Rossi domani», «quanto ho speso a ottobre?» (da Notion).

## Documenti Word e PDF
La chat legge i **documenti Word** (`.docx`) e i **PDF**: trascinali nella chat o nel Vassoio, oppure dì dove sono («leggi il contratto in Documenti\Rossi.pdf»). Dei Word legge anche intestazione, tabelle e piè di pagina; dei PDF il testo pagina per pagina. Le **scansioni** (fotografie di fogli) e i PDF protetti da password non si leggono. Lo stesso testo arriva a tutti i motori, anche quelli che da soli non aprono i documenti, e alla memoria quando metti un PDF o un Word in «da leggere».

Può anche **scrivere documenti Word nuovi**:
- **da zero:** «scrivimi una lettera per Rossi sul rinnovo del contratto, in Word»;
- **da un tuo modello:** prima di' «usa questo file come modello» (un `.docx` o `.dotx` nel Vassoio o sul PC). EasyIsland ne tiene una copia e non lo modifica mai. Nel modello scrivi tra graffe dove vanno i dati: `{cliente}`, `{data}`, `{numero}`, `{corpo}` per il testo, `{righe}` per la tabella, `{totale}`. I nomi li scegli tu: `{partita iva}`, `{scadenza}`, `{referente}`… la chat li compila con quello che le dici, e ti dice quali sono rimasti vuoti. Intestazione, logo, piè di pagina e stili restano i tuoi;
- **preventivi:** la chat passa solo le righe (descrizione, quantità, prezzo, IVA): **imponibile, IVA e totale li calcola EasyIsland**, mai l'AI, e `{numero}` diventa il progressivo dell'anno di quel modello (1/2026, 2/2026…).

Il documento va **sempre nel Vassoio** e nella cartella di lavoro, o nella cartella che chiedi; non sovrascrive mai un file. Con **Word installato** fa anche il **PDF** («…e fammi anche il PDF», o «trasforma questo Word in PDF»). Ogni documento nuovo chiede **Consenti / Nega**.

**Immagini:** «metti il logo che ho nel Vassoio in cima» o «aggiungi la foto del sopralluogo, larga 8 cm». PNG, JPEG e GIF, al massimo larghe quanto la pagina.

Può leggere anche **una cartella intera** di Word e PDF («analizza le offerte nella cartella Offerte PDF»), più rapido ed economico che estrarre il testo con altri programmi.

**Unire e dividere PDF:** «unisci questi tre PDF», «metti prima il preventivo, poi le pagine 1-2 delle condizioni», «estrai le pagine 3-5», «dividi il PDF in un file per pagina» o «in 1-2 e 3-fine». Anche un Word fra i file da unire: diventa PDF con Word. Gli originali non cambiano; i file nuovi vanno nel Vassoio e nella cartella di lavoro. I campi compilabili e i segnalibri non vengono copiati; i PDF protetti non si possono unire (aprili e stampali con «Microsoft Print to PDF», poi unisci quella copia).

## Ricette: impara con l'uso
Dopo una risposta riuscita, EasyIsland ricorda **quali strumenti** sono serviti per quel tipo di domanda. Alla domanda simile la chat va dritta agli strumenti giusti: più veloce e con meno token. In **Impostazioni → Chat → Ricette** vedi quante sono e le dimentichi con un clic.

## Modalità terminale
**Impostazioni → Chat → Modalità terminale**, insieme alla **cartella di lavoro**: la chat lavora come Claude Code o opencode da terminale.
- **Claude Code** usa i tuoi strumenti, server MCP, plugin, `CLAUDE.md`, skill, regole di permesso e hook, nella cartella scelta. Ogni domanda di permesso arriva all'isola.
- **opencode** lavora nella cartella scelta; «Sempre» vale per i comandi e le modifiche di cui propone la regola.
- **Gli altri motori** (API di Anthropic, OpenAI, OpenRouter, Gemini, Ollama, LM Studio) passano da opencode con lo stesso fornitore e modello.

Ogni comando compare **per intero** sulla card prima di partire.

**Impegno di Claude.** Nel menu del motore (il pulsante «Claude (abbonamento) ▾» sotto il campo) scegli quanto ragiona Claude: da **Basso** (veloce ed economico) a **Massimo**. Vale subito, anche a metà conversazione, e resta per le chat successive; **Predefinito di Claude Code** usa il suo.

**Lavori in background.** Per i lavori lunghi Claude può far lavorare più agenti insieme, o lasciare comandi in esecuzione. Sotto la conversazione compare **In background** con ogni lavoro: **✕** chiede di fermarne uno, **Ferma tutto** li ferma tutti. Intanto puoi continuare a scrivere. Quando finiscono, Claude scrive il risultato come in una risposta normale (vedi i passi mentre lavora) e l'isola ti avvisa, anche da chiusa.

### ⚡ Automatica
Il pulsante ⚡ nella testata della chat (solo con la modalità terminale) vale **per la conversazione in corso** e si spegne con «Nuova chat». Da acceso la chat ha il bordo ambra.
- **Claude Code**: la sua modalità automatica approva le azioni normali e blocca quelle rischiose.
- **opencode e gli altri**: passano da soli modifiche ai file, web e comandi non delicati. Restano sulla card i comandi delicati (cancellare, `git push` e `reset --hard`, installare, registro, servizi, rete, processi, codice scaricato), le cartelle fuori da quella di lavoro e gli strumenti dei connettori che cancellano.

**Le modalità di Claude Code**, come in Claude Desktop: con Claude Code lo stesso pulsante passa, a ogni clic, fra **Consenti / Nega** (ogni azione chiede), **Accetta modifiche** (le modifiche ai file vanno da sole, i comandi chiedono), **Piano** (Claude legge e prepara un piano senza cambiare niente; lo approvi dalla card e poi lavora, e la chat torna a Consenti / Nega) e **Automatica**.

**«Sempre» vale per tutta la conversazione**: un comando, un sito o le modifiche ai file consentiti con «Sempre» non chiedono più finché la conversazione continua, anche dopo una pausa lunga.

**Pull request.** Con la modalità terminale, se il progetto ha una pull request aperta e `gh` (la riga di comando di GitHub) è installato e collegato, accanto a **Progetto…** compare **#12 ✓** (o **✗ 2** con i controlli che non passano, **…** in corso). Un clic: **Apri la pull request** o **Correggi i controlli che non passano**, che chiede a Claude di leggere i log e correggere.

**Commenti sulle modifiche.** Nell'Anteprima, vista **Modifiche**, un clic su una riga apre un campo per un commento a Claude; **Manda alla chat** li manda tutti insieme e Claude corregge, come nel diff di Claude Desktop.

**Lavori a parte.** Claude può proporre di far partire un lavoro indipendente in una nuova conversazione (la card chiede Consenti / Nega): consentito, la conversazione si apre nella barra laterale e va avanti da sola accanto alla tua.

**Copia separata.** In **Progetto…**, **Copia separata (worktree)** crea una copia del progetto con un suo branch (`git worktree`, in `.claude\worktrees`), come Claude Desktop per ogni sessione: la chat lavora lì e non tocca i file delle altre chat. Serve git installato; la copia resta finché non la togli tu (`git worktree remove`).

La modalità che accetta tutto senza nessun controllo **non esiste** in EasyIsland, di proposito.

## La cartella di lavoro
Una cartella del PC scelta da te (in **File e schermo** o in Impostazioni → Chat) che la chat **legge senza chiedere** e in cui può spostare i file del Vassoio. Con la modalità terminale è la cartella in cui lavora. Da Telegram: `/cartella`. Dettagli in [File e schermo](17-file-e-schermo.md#cartella-di-lavoro).

## Impostazioni cambiate dalla chat
«Metti il personaggio in basso a destra», «spegni il meteo», «usa opencode come motore»: la chat legge le impostazioni e ne cambia una alla volta, con Consenti / Nega, salvando come la finestra delle Impostazioni.
