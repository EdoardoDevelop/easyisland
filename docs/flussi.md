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
- [ ] `create_automation` dalla chat con nodi, rami e agenti (anteprima = conferma).
- [ ] Impostazioni: il flusso disegnato in sola lettura, l'elenco dei giri con entrate e uscite di ogni nodo, «Riprendi da qui».

## Tappa 3: editor visivo modificabile
- [ ] Canvas senza librerie (come la mappa della memoria): nodi, fili, trascinamento, pannello del nodo.
- [ ] Un flusso di un solo passo resta semplice (niente diagramma).
- [ ] Automazioni e compiti in una sola pagina «Flussi».

## Tappa 4
- [ ] Decisione presa dal modello fra rami con un nome.
- [ ] «Per ogni elemento».
- [ ] Chiedi a me anche su Telegram.

## Registro
- 25 ottobre 2026: tappa 1 scritta (`flows.rs`, campi nuovi in `automations::Step`, test). Da provare dal vivo con un flusso vero; l'editor delle automazioni in Impostazioni non conosce ancora i collegamenti (tappa 3): modificare lì un flusso con rami può perderli.
- 25 ottobre 2026: branch creato, piano scritto.
