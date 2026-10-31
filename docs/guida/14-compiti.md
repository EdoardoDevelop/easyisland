# Compiti, Battito e Abilità
> sezione: Intelligenza artificiale
> in breve: Nella pagina Flussi, insieme alle automazioni. L'agente personale: obiettivi che EasyIsland porta avanti da sola, controlli periodici e procedure tue.

## Compiti
Un **compito** è un obiettivo che affidi a EasyIsland e che lei porta avanti **da sola**, anche mentre fai altro: scrive un piano, lo esegue con gli strumenti, ti chiede quello che solo tu sai e alla fine ti dà il risultato.

Esempi: «controlla i ticket aperti da più di 3 giorni e prepara un riepilogo», «ogni lunedì alle 8 fammi il punto delle scadenze di Notion», «cerca tre fornitori di NAS e confronta i prezzi».

### Come si crea
- **In chat**: `/compito …`, oppure chiedi «fallo come compito», «ogni giorno alle 9…»: la chat propone il compito e lo crei con Consenti.
- **Impostazioni → Flussi → Nuovo compito**: titolo, obiettivo, quando, motore.
- **Da Telegram**: `/compito …`.
- **Da un'automazione**: il passo «Compito».
- **Da un'integrazione personale**: un pulsante di tipo «compito».

### Quando
| Scelta | Esempio |
|---|---|
| Subito | Parte appena c'è posto in coda |
| Una volta, a un'ora | 24/10 alle 15:00 |
| Ogni giorno | alle 9:00 |
| Nei giorni feriali | alle 8:30 |
| Ogni settimana | il lunedì alle 8:00 |
| Ogni N minuti | ogni 60 minuti (almeno 15) |

### Come lavora
1. Scrive il **piano** (pochi passi concreti) e segna ogni passo fatto.
2. Usa gli [strumenti di EasyIsland](11-strumenti-ai.md) e del motore, con i soliti **Consenti / Nega** per ciò che cambia qualcosa.
3. Se gli serve una decisione o un dato, ti fa una **domanda**: una card nell'isola con le opzioni e la risposta libera, e anche su **Telegram** se è collegato. La prima risposta vince.
4. Chiude con il **risultato**, breve e utile. Se è un controllo senza niente da dire, chiude **in silenzio**.
5. Se il procedimento potrà servire di nuovo, propone di salvarlo come **abilità**.

Non invia email, non elimina e non approva niente da solo: prepara bozze e lascia a te l'ultimo clic.

Nell'isola ogni compito è una sessione dell'agente **Compiti** nella scheda Agenti, con piano, passi, domande e permessi come per Claude Code. Un compito alla volta; gli altri aspettano in coda.

### Stati e comandi
In attesa del suo orario, In coda, Al lavoro, Aspetta una risposta, In pausa, Fatto, Non riuscito, Fermato. Dalle Impostazioni (e dall'isola) puoi **avviare ora**, **mettere in pausa**, **riprendere**, **fermare**, **rispondere**, **eliminare** e leggere il **registro** del compito (un file `.md`).

**Limiti** (Impostazioni → Flussi): turni e minuti massimi per esecuzione (12 turni e 30 minuti di serie), poi il compito va in pausa e ti avvisa.

### Un motore per compito, e motori aiutanti
- Ogni compito può avere il **suo motore e modello** (per esempio opencode gratuito per i controlli, Claude per i testi).
- Puoi dargli dei **motori aiutanti**: il motore che guida può affidare a uno di loro un pezzo del lavoro (una ricerca, una revisione, una bozza) e riceverne il risultato, come fanno gli agenti con i sotto-agenti.
- **Senza chiedere** (in **Motori e permessi**, o detto alla chat quando lo crei: «… e può aggiungere righe a Notion senza chiedere»): le azioni che può fare da solo, anche di notte, scelte tra quelle che si annullano (righe di Notion, attività di To Do, file del Vassoio). Ognuna finisce in **Impostazioni → Chat → Cosa ho fatto**, con Annulla. Il resto chiede come sempre.

### Su Telegram
Con Telegram collegato ricevi un messaggio quando un compito finisce, non riesce, va in pausa o aspetta una risposta. Rispondi con i pulsanti o con `/rispondi …`. Anche i permessi dei compiti arrivano lì (mai approvati da soli, nemmeno con «Automatica»).

## Battito
Un **controllo periodico**: ogni N minuti l'agente guarda le cose che hai scritto in `BATTITO.md` e ti avvisa **solo se c'è qualcosa**.

```
- ticket urgenti non assegnati in Zammad
- mail da clienti senza risposta da più di un giorno
- scadenze di oggi in Notion
- spazio disco sotto il 10 %
```

**Impostazioni → Flussi → Battito**: scegli ogni quanto e apri l'elenco con **Cosa tenere d'occhio…**. Con l'elenco vuoto non parte e non costa niente.

## Riordino della memoria
Ogni sera alle 22:30 rilegge la giornata, ti propone cosa ricordare, impara dai file in `da-leggere` e la domenica controlla la memoria. Si accende in **Impostazioni → Flussi**; dettagli in [Memoria](12-memoria.md#il-riordino-della-sera).

## Abilità
Un'**abilità** è una procedura tua scritta in un file `.md`: come fai un preventivo, come chiudi un ticket, come prepari il report del mese. L'AI la legge **solo quando serve**, quindi puoi averne tante senza costi.

```
---
nome: Chiusura ticket
descrizione: Come chiudere un ticket Zammad con il riepilogo per il cliente
motore: subscription
strumenti: list_status, notion_add_row
---
1. Rileggi il ticket e le note interne.
2. Scrivi il riepilogo in tre righe, senza gergo.
3. Aggiungi la riga nel database «Interventi» di Notion.
4. Lascia a me l'invio della risposta.
```

- **Dove**: `%APPDATA%\EasyIsland\abilita\`. In **Impostazioni → Flussi → Abilità** le crei, modifichi, elimini e apri la cartella.
- **Come si usano**: la chat e i compiti vedono l'elenco (nome e descrizione) e leggono quella giusta quando serve. Ogni abilità è anche un **comando**: `/chiusura-ticket` in chat e su Telegram.
- **Motore**: un'abilità può indicare il motore preferito; un compito lo usa delegandogli quel passo.
- **Si migliorano da sole**: alla fine di un compito l'agente può proporti di salvare il procedimento come abilità nuova (con Consenti / Nega).
