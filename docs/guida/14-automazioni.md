# Automazioni
> sezione: Fare le cose
> in breve: Flussi «quando… allora…» con rami, domande e agenti, costruiti trascinando i blocchi nella finestra Flussi, a parole in chat o proposti dalle tue abitudini.

![Impostazioni, pagina Automazioni](../media/settings-automations.png)

## Quando
| Evento | Esempio |
|---|---|
| A un orario, nei giorni scelti | alle 9 dei giorni feriali apri Outlook e il gestionale |
| All'avvio del PC | dopo 30 secondi passa al profilo Lavoro |
| Allo sblocco del PC | un avviso con il promemoria del giorno |
| Al rientro dopo N minuti senza tastiera e mouse | riapri le app di lavoro |
| Collegandoti a una rete Wi-Fi | in ufficio apri la cartella condivisa |
| All'avvio di un programma | quando apri Teams esegui «Silenzia» |
| Un programma passa in primo piano | in Excel mostra l'avviso con le scorciatoie |
| Collegando una chiavetta o un disco | esegui lo script di backup |
| Un file arriva in una cartella | avvisami delle nuove scansioni |
| Un download finisce | apri la cartella dei PDF scaricati |
| Un'integrazione o un widget segnala un problema o una novità | se il sito del cliente va giù esegui lo script di controllo |
| Una chiamata 3CX in arrivo | apri la scheda del cliente |
| Una riunione Teams inizia o finisce | profilo Concentrazione durante la riunione |
| Un agente ha finito o aspetta un permesso | avviso quando Claude Code finisce |
| Un server di sviluppo parte | apri l'indirizzo nel browser |

**Solo se** (filtro): per cartelle, download, integrazioni, chiamate e agenti, parole o estensioni (`.pdf`) che l'evento deve contenere.

## Se
Condizioni, tutte vere (ognuna può diventare «se non»): fascia oraria e giorni (anche a cavallo della mezzanotte), rete Wi-Fi, programma aperto o in primo piano, a batteria o sotto una percentuale, assente da N minuti, in riunione (microfono o webcam in uso), davanti al cliente.

**Ripeti**: ogni volta, al massimo ogni N minuti, oppure una volta al giorno.

## Allora
Una sequenza di passi:
- eseguire un'**azione rapida**;
- mostrare un **avviso** nell'isola;
- **cambiare profilo**;
- aprire un **programma**, una **cartella** o un **link**;
- **chiedere alla chat** (si apre nell'isola con la risposta);
- avviare un **compito**;
- **aspettare** N minuti prima del passo dopo;
- **chiedere prima di continuare**: una card nell'isola con *Continua* / *Annulla* che elenca i passi seguenti; senza risposta in 3 minuti l'automazione si ferma.

Se un passo non riesce, i seguenti si saltano; con **Continua dopo un errore** vanno avanti lo stesso.

Nei passi puoi usare i dati dell'evento: `{file}`, `{percorso}`, `{cartella}`, `{rete}`, `{programma}`, `{unità}`, `{testo}`, `{fonte}`, `{chiamante}`, `{numero}`, `{agente}`, `{progetto}`, `{porta}`, `{link}`, `{minuti}`, e sempre `{ora}` e `{data}`. L'editor elenca quelli disponibili per l'evento scelto. Per sicurezza nei link sono codificati, negli argomenti di un programma sono un argomento solo, e negli script non entrano mai.

Ogni automazione si può limitare a un profilo e provare subito con **Prova ora**. Il **Registro** mostra le ultime esecuzioni. Le automazioni partono senza chiedere, perché le hai create tu, tranne gli script con «Chiedi conferma» e le domande alla chat. Con EasyIsland in pausa non parte niente.

## La finestra Flussi
Ogni automazione è un **flusso** e si costruisce nella finestra **Flussi** (Impostazioni → Flussi → **Modifica** o **Apri la finestra Flussi**).
- **A sinistra** i tuoi flussi, **+ Nuovo flusso** e **Descrivilo a parole**: scrivi cosa vuoi e la chat lo prepara (lo confermi nell'isola).
- **Al centro** il flusso dall'alto in basso: in cima la scheda **Quando**, poi i passi. Per aggiungere un passo **trascina un blocco** dalla barra in basso nel punto che vuoi, oppure premi il **+** fra due schede. Trascina una scheda per cambiarle posto. A flusso vuoto puoi partire da un modello: *Inizio giornata*, *File in arrivo*, *Ticket urgenti*.
- **A destra** il pannello della scheda scelta: i suoi campi e, in fondo, i **dati da usare** (`{file}`, `{leggi}`, `{leggi.urgente}`…): un clic e finiscono nel campo dove stavi scrivendo.
- Le schede dicono cosa manca (*da completare*) e dove vanno le strade; in alto **▶ Prova** lo fa partire subito e **Acceso** lo attiva. Si salva da solo.

**I blocchi**
- *Fai*: Avviso, Apri (programma, cartella, file), Link, Azione rapida, Profilo.
- *Intelligenza*: **Agente** (fa un lavoro con gli strumenti di EasyIsland e il motore che scegli; il flusso aspetta il risultato), Chat, Compito.
- *Decidi*: **Scelta** (strade secondo una regola, per esempio «se {leggi.urgente} contiene sì», oppure descritte a parole e scelte dal modello) e **Per ogni** (ripete dei passi per ogni riga di un elenco, con la voce in `{elemento}`).
- *Con te*: **Domanda** (fino a tre risposte; con Telegram collegato arriva anche lì, dove puoi rispondere a parole con /rispondi), Conferma, Attesa.

**Se un passo non riesce** può riprovare fino a tre volte (dopo 10, 30 e 90 secondi) e poi fermare il flusso, finirlo senza errore o andare a un altro passo, con il motivo in `{errore}`. Se un flusso non riesce e Telegram è collegato, ti arriva anche lì. Un **Agente** può darti delle risposte da usare dopo (per esempio `urgente, cliente` → `{leggi.urgente}`) e ha un tempo massimo (60 minuti di serie).

**Esecuzioni** (a destra, accanto a Modifica): le ultime volte che il flusso è partito, con cosa ha fatto ogni passo; le schede si colorano di verde o rosso. **Riprendi da qui** riparte da un passo con i dati di allora, **Prova da qui** (nel pannello del passo) con quelli dell'ultima volta. Se EasyIsland si chiude a metà, al riavvio il flusso riprende da dove era, senza rifare un passo che aveva già aperto un programma o mandato un avviso.

## A parole, in chat
«Ogni giorno feriale alle 9 apri Outlook e il gestionale», «quando colleghi una chiavetta lancia il backup», «se il sito del cliente va giù avvisami»: la chat prepara l'automazione e l'isola te la mostra (Quando… / Allora…) con **Consenti / Nega**. Confermando, viene creata e accesa.

## Proposte dalle tue abitudini
Se lo accendi (**Automazioni → Proponimi automazioni**, spento di serie), EasyIsland annota quando apri i programmi (solo il nome, mai titoli o contenuti), quando accendi o sblocchi il PC, la Wi-Fi, le chiavette, le azioni rapide e i profili scelti a mano. Tutto resta su questo PC, al massimo 45 giorni, e si cancella con un clic.

Dopo qualche settimana propone, al massimo una volta al giorno, solo **routine complete**, mai «apro un programma a un'ora»:
- *«Preparo il tuo Inizio giornata?»*: la prima volta che accendi o sblocchi il PC nella solita fascia, passa al profilo che scegli di solito, apre insieme i programmi che apri sempre a quell'ora e, al mattino, ti fa il punto della giornata (appuntamenti, posta, ticket, attività). Una volta al giorno;
- sulla rete di un luogo: il profilo di quel luogo e i programmi che apri appena arrivi;
- gruppi: *«Quando apri il gestionale, preparo anche Excel e Word?»* (solo se sono almeno due);
- un'azione rapida quando colleghi una chiavetta;
- di spegnere un'automazione che non usi più.

Rispondi **Crea**, **Non ora** (te la ripropone tra un mese) o **No, mai** (la ritrovi tra le *Proposte rifiutate*). In **Programmi da non osservare** indichi quelli da ignorare.

![Una proposta dalle abitudini](../media/suggestion.png)
