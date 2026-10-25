# Flussi: piano di lavoro

Automazioni e compiti diventano un solo sistema a nodi, con un editor visivo modificabile (deciso con Edoardo il 25 ottobre 2026; l'idea completa è in `docs/idee.md` → «Flussi»). Si lavora sul branch `claude/flussi`. Questo file tiene il punto: cosa è fatto, cosa manca, le scelte prese strada facendo.

## Scelte di fondo
- **Un flusso è un'automazione con i passi collegati.** Niente formato nuovo né conversione: `settings.automations` resta dov'è, ogni passo ha un `id` e può dire dove andare dopo (`next`) o scegliere fra rami (`branches`). Senza collegamenti si va al passo seguente, quindi le automazioni di oggi sono già flussi lineari. Edoardo non usa ancora automazioni e compiti: la compatibilità è gratuita, non si spende altro tempo in migrazioni.
- **I compiti restano il motore dei nodi Agente.** `tasks.rs` non cambia: il nodo crea un compito e ne aspetta il risultato. I compiti da soli (Impostazioni → Compiti, `/compito`, Telegram) continuano a funzionare; nella tappa 3 la pagina diventa una sola.
- **Sicurezza invariata:** niente nodi con codice; i nodi Agente hanno gli strumenti e i permessi della chat.

## Tappa 1: motore (Rust)
- [x] Passi con un nome (`node`: `id` era già l'azione rapida), `next` (id, `"end"` o vuoto = il seguente) e `branches` (`if` su un dato + `to`); un limite di passi per giro contro i cicli infiniti.
- [x] Nodo **Agente** (`agent`): crea un compito con obiettivo, motore e modello, aspetta che finisca (anche se chiede qualcosa all'utente) e mette il risultato in `{<id>}` e `{risultato}`.
- [x] Nodo **Decisione** (`decide`): rami su un dato (contiene, è uguale, è vuoto, altrimenti).
- [x] Nodo **Chiedi a me** (`ask`): card con 1–3 scelte (la risposta libera arriva con Telegram, tappa 4); la scelta va in `{<id>}`.
- [x] Ogni passo scrive il suo risultato nei dati del giro (`{<id>}`), usabili dai passi dopo.
- [x] **Esecuzioni salvate** in `%APPDATA%\EasyIsland\flussi\<giro>.json` dopo ogni passo (passo corrente, dati, esiti); al riavvio un giro interrotto riprende dal passo dove era (un'attesa con il tempo che resta, un nodo Agente ritrova il suo compito).
- [x] Validazione (`validate`) dei collegamenti: id unici, destinazioni esistenti.
- [x] Test Rust del percorso (rami, fine, ciclo fermato).
- [x] Documentazione: `docs/integrazioni.md` → Automazioni (HANDOFF all'unione in main).

## Tappa 2: chat e vista delle esecuzioni
- [x] `create_automation` dalla chat con nodi, rami e agenti (anteprima = conferma): descrizione e schema in `hook/src/tool_list.rs`, anteprima numerata con le destinazioni in `describeAutomation` (`src/island/hooks.ts`), riassunto in `automations::describe`.
- [x] Impostazioni: il flusso disegnato in sola lettura (`src/settings/flows.ts`, SVG fatto a mano: colonna dei passi, salti e rami come curve a destra con la condizione), l'elenco dei giri (le ultime 50, su disco) con l'esito di ogni passo e «Riprendi da qui» (nuovo giro dal passo scelto con i dati del vecchio). Un'automazione con collegamenti o passi agent/decide/ask in Impostazioni si vede disegnata e non si modifica: così i collegamenti non si perdono. Il vecchio registro in memoria non si mostra più (resta `automations_log` per ora).

## Tappa 3: editor visivo modificabile
- [x] Editor sul disegno SVG (`flowEditor` in `src/settings/flows.ts`): clic su un passo → pannello con nome (rinominare aggiorna i collegamenti), tipo, campi (gli stessi della lista, `stepFields` in `main.ts`), «Poi» e i rami della Scelta; «+ Passo dopo», ↑ ↓, «Togli» (i collegamenti al passo tolto tornano «il passo seguente»). Al posto del trascinamento libero: la colonna si ordina con ↑ ↓ e i fili si scelgono nel pannello, più semplice e senza disegni che si accavallano. Il trascinamento resta un'idea se servirà.
- [x] Un'automazione semplice resta la lista di passi; diventa disegno con «Apri come flusso» o da sola appena ha un collegamento, un ramo, un agente o una domanda (`isLinked`).
- [x] Automazioni e compiti in una sola pagina «Flussi» (id `compiti`, che l'isola apre da un compito); i testi «Impostazioni → Compiti / Automazioni» ora dicono «Impostazioni → Flussi». Guida: 14-automazioni (sezione Flussi) e 12-compiti.

## Tappa 4
- [x] Decisione presa dal modello: rami con `op: "model"`, `toMatch` = cosa significa la strada; il motore (quello del passo o della chat, `Channel::Helper`, senza strumenti) legge `text` e risponde col numero (`by_model`, `first_number`). Nell'editor: «Lascia scegliere al modello» / «Decido io con delle regole».
- [x] «Per ogni elemento» (`foreach`): `text` diviso in righe (al massimo 30, i trattini tolti), ogni voce in `{elemento}` va a `body`; i passi del giro tornano al foreach con `next`; dopo l'ultima si segue il `next` del foreach. Lo stato del giro è in `Run.loops`, quindi sopravvive a un riavvio. Il limite per giro è salito a 200 passi.
- [x] Chiedi a me anche su Telegram: con Telegram collegato la domanda va anche lì con i pulsanti (`telegram::ask_flow`, chiave `flow-<giro>`), vale la prima risposta (`tasks::first_some`) e la card dell'isola sparisce (`moments::expire_card`); su Telegram si può rispondere anche a parole con /rispondi (`flows::answer_latest`, prima dei compiti).

## Tappa 5: affidabilità e costruzione (dalle ricerche del 25 ottobre 2026)
Ricerca sugli strumenti a nodi e sull'esecuzione durevole degli agenti. Cosa fanno i migliori e cosa prendiamo:
- **Riprovare un passo** con attese crescenti e un massimo (n8n «Retry On Fail»: tentativi e attesa per nodo; Temporal/Diagrid: backoff esponenziale con tetto). → `retries` per passo (0–3; attese 10 s, 30 s, 90 s), mai per domande e conferme.
- **Strada d'errore** invece di fermarsi (n8n: uscita d'errore del nodo e «error workflow»). → `onError`: il passo a cui andare se questo non riesce, con il motivo in `{errore}`. Se il giro fallisce del tutto e Telegram è collegato, arriva anche lì un messaggio.
- **Niente azioni ripetute dopo un riavvio** (esecuzione durevole: si riprova solo ciò che è idempotente, il resto ha bisogno di una ricevuta). → il giro segna il passo «in corso»; al riavvio un passo con effetti (programmi, link, azioni rapide, avvisi, chat, compiti) rimasto a metà non si ripete: va nella strada d'errore come «interrotto dal riavvio». Attese, agenti (ritrovano il loro compito), domande, scelte e giri si riprendono.
- **Tempo massimo** per ogni attività e per le pause umane (Diagrid). → un agente ha un limite (`minutes`, predefinito 60): oltre, il compito si ferma e il passo non riesce. Le domande hanno già 10 minuti.
- **Uscita strutturata dagli agenti** quando guida le scelte (OpenAI Agent Builder: uscita JSON con schema; Foundry: conta soprattutto per instradare). → `fields` su un agente: l'agente chiude con un oggetto JSON con quei campi, che diventano `{nome.campo}`; se manca il JSON il passo non riesce (e può riprovare o andare in `onError`).
- **Limiti di spesa per giro** (tetto di passi e di chiamate ai modelli). → oltre ai 200 passi, al massimo 20 passi con un motore (agenti e scelte del modello) per giro.
- **Provare da un passo** (n8n: eseguire un nodo da solo e ripetere un'esecuzione). → nell'editor «Prova da qui» parte dal passo scelto, con i dati dell'ultima esecuzione se c'è.

- [x] `retries` con attese crescenti.
- [x] `onError` e `{errore}`; avviso su Telegram se il giro fallisce.
- [x] Passi con effetti non ripetuti dopo un riavvio (`inflight`).
- [x] Tempo massimo degli agenti (`minutes`).
- [x] `fields`: uscita JSON degli agenti in `{nome.campo}`.
- [x] Tetto di 20 passi con un motore per giro.
- [x] «Prova da qui» nell'editor (`flow_try_from`, `flows::try_from`).
- [x] Chat (descrizione di `create_automation`), anteprima, editor, guida, test.

## Tappa 6: rifatta l'esperienza (Edoardo, 25 ottobre 2026: «un bel casino… non è intuitivo»)
Cosa non andava: due modi per la stessa cosa (lista di passi e «Apri come flusso»), l'editor stretto dentro le Impostazioni, il disegno separato dai moduli, nessun trascinamento, nessun punto di partenza.
Cosa fanno i migliori (ricerca del 25 ottobre): Zapier disegna dall'alto in basso partendo dall'innesco, si aggiunge con il «+» fra due passi o trascinando un blocco da una barra, i rami sono «percorsi» dentro un blocco; n8n tiene i parametri del nodo in un pannello accanto al disegno («focus panel»), con i dati in ingresso visibili per collegarli; OpenAI ha un nodo di partenza, anteprima che mostra ogni nodo mentre gira, modelli da cui partire, e sta spostando la creazione verso il linguaggio naturale (Agent Builder chiude il 30 novembre 2026 a favore degli agenti creati a parole).
Scelte:
- **Una cosa sola: il flusso.** Niente più «automazione» contro «flusso»: ogni automazione è un flusso, la vecchia lista di passi sparisce. Nei testi resta «automazione» solo dove serve a spiegare.
- **Finestra «Flussi»** (`flussi.html`, `src/flows/`, creata alla prima apertura, poi nascosta come le altre): a sinistra l'elenco dei flussi con «+ Nuovo flusso»; al centro il disegno dall'alto in basso, con la scheda **Quando** in cima, le schede dei passi, un «+» fra ogni coppia e «Fine»; in basso la barra dei blocchi da **trascinare** nel disegno (o cliccare: va in fondo); a destra il **pannello** del blocco scelto, con i moduli e i **dati disponibili** come pastiglie da cliccare per inserirli nel campo.
- **Trascinamento**: blocchi dalla barra a un punto del disegno; schede trascinate per cambiare ordine.
- **Rami leggibili**: Scelta e Per ogni elemento mostrano dentro la scheda le loro strade con la destinazione; i salti e «se non riesce» sono etichette sulla scheda, non fili che si incrociano.
- **Partire facile**: a flusso vuoto, «Descrivilo a parole» (lo crea la chat) e tre modelli pronti.
- **Prova e Esecuzioni nella finestra**: «Prova» in alto, le esecuzioni del flusso a destra, con le schede segnate verde/rosso.
- **Salvataggio automatico** di un flusso alla volta (`flow_save`, non tutte le impostazioni: niente sovrascritture fra finestre), con «Da completare: …» quando manca qualcosa.
- **Impostazioni → Flussi**: solo l'elenco (acceso/spento, Modifica, che apre la finestra), le proposte dalle abitudini e i compiti.

- [x] Rust: finestra `flussi` (`open_flows_window`), `flow_save`, `flow_delete`, `flow_ask_chat`, permessi della finestra.
- [x] Finestra: elenco, disegno con schede, «+», barra dei blocchi con trascinamento, riordino trascinando, pannello con moduli e dati disponibili.
- [x] Prova, esecuzioni del flusso con le schede segnate, modelli pronti, «Descrivilo a parole».
- [x] Impostazioni → Flussi ridotte all'elenco; via la vecchia lista di passi e l'editor in pagina.
- [x] Traduzioni, guida, documentazione, collaudo.

## Registro
- 25 ottobre 2026: tappa 6 scritta. La finestra `flussi` (`src/flows/main.ts`, `catalog.ts`, `flows.css`) sostituisce l'editor in pagina e la vecchia lista di passi (via `src/settings/flows.ts`). Provato nel browser: modello «Ticket urgenti», trascinamento di un blocco in un punto, riordino trascinando una scheda. Le schede segnano «da completare» quello che manca (`catalog::missing`). La finestra nasce alla prima apertura (`open_flows_window`, comando async: costruire una finestra dal thread principale la bloccherebbe) e chiede il flusso da mostrare con `flow_pending` (una query nell'indirizzo non passa lo schema dell'app in release).
- 25 ottobre 2026: tappa 5 scritta (affidabilità: tentativi, strada d'errore, niente doppioni dopo un riavvio, tempo massimo e campi degli agenti, tetto ai motori, «Prova da qui»). Note: un errore gestito con «Se non riesce» non segna il giro come fallito; «finisci senza errore» chiude il giro come riuscito. Un passo «decide» con regole non si riprova (non può fallire), uno del modello sì.
- 25 ottobre 2026: tappa 4 scritta; tutte le tappe fatte sul branch. Da provare dal vivo: un flusso vero con agente, foreach, scelta del modello e domanda su Telegram; poi unione in main con la voce in HANDOFF.
- 25 ottobre 2026: tappa 3 scritta. Provato nel browser: apri come flusso, aggiungi passi, Scelta con due rami. Da provare dal vivo nell'app.
- 25 ottobre 2026: tappa 2 scritta. Provato nel browser il disegno di un flusso con agente, scelta, avviso e domanda; da provare dal vivo: un flusso creato dalla chat e «Riprendi da qui».
- 25 ottobre 2026: tappa 1 scritta (`flows.rs`, campi nuovi in `automations::Step`, test). Da provare dal vivo con un flusso vero; l'editor delle automazioni in Impostazioni non conosce ancora i collegamenti (tappa 3): modificare lì un flusso con rami può perderli.
- 25 ottobre 2026: branch creato, piano scritto.
