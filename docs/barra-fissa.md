# Barra fissa — lavoro a passi

Branch `claude/barra-fissa-2`, ripartito il 29 ottobre 2026 da `claude/sviluppo` sopra le due finestre (`docs/architettura.md` → «Finestra del personaggio»). Il primo tentativo, con la finestra dell'isola come barra, resta nel branch `claude/barra-fissa` come archivio. Da lì vengono `appbar.rs` e le impostazioni. Le decisioni di Edoardo sono in `docs/idee.md` → «Isola fissa: barra riservata in alto o in basso». A lavoro finito questo file si riassume in `docs/architettura.md` e si cancella.

**Obiettivo:** con «Barra fissa» accesa, Windows riserva una fascia in alto o in basso, come per la barra delle applicazioni, e le finestre si fermano al suo bordo.
- La fascia ha tre aree: inizio, centro e fine.
  - In una delle tre va il personaggio.
  - Nelle altre, e accanto al personaggio, vanno integrazioni, azioni, widget e la striscia scelti dall'utente.
- L'isola si apre sotto la fascia, o sopra se la fascia è in basso, e si comporta come una finestra. Il personaggio non si trascina.
- A riposo non consuma nulla.

## Scelte
- **La barra è la finestra del personaggio** (`personaggio`), registrata con `SHAppBarMessage` (`appbar.rs`).
  - È larga quanto lo schermo dell'isola, alta quanto la vista compatta (`Settings::bar_thickness`), sempre davanti, e prende tutto il mouse.
  - Rust la posa sulla fascia (`sync_character`, ramo `appbar::band()`).
  - La pagina (`src/character-window/main.ts`, modalità `bar`) disegna lo sfondo dell'isola e il personaggio nella sua area. Un clic sul personaggio apre o chiude l'isola.
- **L'isola** è la finestra di sempre:
  - chiusa è nascosta (`set_collapsed`: `quiet` con la barra accesa);
  - aperta sta contro la fascia, perché l'area di lavoro di Windows finisce lì e la casa è all'area del personaggio (`Settings::home_anchor`, `homePlacement`, senza spostamento);
  - `islandPlace` e `overTaskbar` non valgono;
  - va dietro alle altre app come una finestra; la barra resta davanti.
- **Messaggi della shell** tramite sottoclasse della finestra della barra, senza alcun ciclo:
  - `ABN_POSCHANGED`, `WM_DISPLAYCHANGE`, `WM_DPICHANGED`: si ricalcola la posizione;
  - `ABN_FULLSCREENAPP`: la barra si nasconde e torna dopo.
- **Impostazione `fixedBar`:** `""` (spenta), `"top"` o `"bottom"`. Vale per il PC, non per il profilo. `fixedBarSlot`: `start`, `center` o `end`.
- **Blocco già corretto nel primo tentativo:** in `apply` lo stato si copia fuori prima di `run_on_main_thread`, che sul thread principale esegue subito.

## Passi
- [x] **1. La fascia con il personaggio** (scritto il 29 ottobre, da provare dal vivo):
  - la finestra del personaggio diventa la fascia, con lo sfondo dell'isola e il personaggio nella sua area;
  - l'isola chiusa nascosta; aperta contro la fascia;
  - Impostazioni → Posizione: «Barra fissa» e «Personaggio nella barra», con le righe che non valgono nascoste.
- [~] **2. Elementi delle aree:** (integrazioni, widget, azioni e striscia fatti il 29 ottobre; «…» da fare)
  - integrazioni e widget (icona, valore o entrambi; il clic apre la card);
  - azioni rapide (come la barra dell'app in uso);
  - striscia dove la mette l'utente;
  - menu «…» per ciò che non ci sta.
  - Disegnati dalla finestra della barra con i dati che l'isola manda sul canale (`src/core/link.ts`); i clic tornano all'isola.
- [ ] **3. Impostazioni della barra:**
  - aree e ordine degli elementi;
  - sfondo (di serie quello dell'isola, poi trasparente o un altro colore);
  - monitor.
- [ ] **4. Testi, documentazione, guida, verifiche** (test, build, smoke, prova dal vivo).

## Note durante il lavoro
- **29 ottobre, passo 1 scritto.**
  - **Vista compatta:** con la barra accesa la finestra del personaggio non la disegna. Se l'isola si affaccia compatta per un avviso (`peek`, striscia), compare sotto la barra con il suo personaggio. La striscia andrà nella barra al passo 2.
  - **Vista compatta sempre visibile:** con la barra accesa non vale. `keepCompactUp` non la tiene su e `petitToHiddenDelay` è 0,3 s, così la vista compatta compare solo per ciò che la striscia trattiene (permesso, chiamata).
- **29 ottobre, passo 2 (prima parte).**
  - **Elementi:** integrazioni, widget e azioni rapide nelle tre aree. L'isola li prepara (`src/island/bar.ts`: icona come nel menu, `taskIcon` di `rail.ts`; valore = `widgetStatus.summary` o l'ultimo passo; azioni con `renderActionIcon`). I testi entrano con `textContent`. Arrivano nel `look` del canale (`bar.items`, `BarPiece`).
  - **Disegno:** la finestra della barra li dispone nelle aree (`layAreas`). Nell'area del personaggio vengono subito dopo di lui; al centro senza personaggio sono centrati.
  - **Clic:** il clic torna all'isola (`{ kind: "bar", key }` → `barClick`). Un'integrazione o un widget aprono la card, o la chiudono se è già quella aperta; un'azione si esegue.
  - **Impostazione `fixedBarItems`:** `{ id: "task:…" | "action:…", area, show }`, del PC (in Rust `Vec<Value>`).
  - **Impostazioni → Posizione → «Elementi nella barra»** (`barItemsEditor`): aggiungi da un elenco (integrazioni attive, widget, azioni), area, «Icona e valore» / «Solo icona» / «Solo valore», ↑ ↓ ✕.
  - **Da fare:** la striscia nella barra (permessi, chiamate, agente al lavoro, barra dell'app in uso); il menu «…» quando gli elementi non ci stanno.
- **29 ottobre, prova dal vivo del passo 1 e della prima parte del passo 2** (fatta da Claude con foto dello schermo e clic simulati, Edoardo lontano dal PC).
  - **Configurazione:** barra in alto, personaggio all'inizio; elementi: Meteo all'inizio, Media al centro, «Traduci», Rete (solo icona) e Consumo alla fine. Copia di prima: `settings.json.bak-barra-20261029-105234`.
  - **Barra:** larga quanto lo schermo, con lo sfondo dell'isola; le finestre si fermano sotto. Il Consumo con l'avviso è giallo e tagliato con i puntini.
  - **Clic:** sul Meteo l'isola si apre attaccata sotto la barra, sulla card del Meteo, con il clone nel menu; secondo clic: si chiude. Clic sul personaggio: si apre e si chiude.
  - **Scala:** lo schermo è 2560×1440 al 125 %: i programmi che non dichiarano i DPI vedono la barra larga 2048.
- **29 ottobre, la striscia nella barra.**
  - **Cosa mostra:** quello di accanto al personaggio compatto (`stripItem` di `strip.ts`: permesso, chiamata, registrazione, riunione di Teams, richiesta da aprire, barra dell'app in uso, agente al lavoro), come un elemento della barra (`stripPiece` in `bar.ts`, colore dal tipo).
  - **Dove:** di serie accanto al personaggio; con «Striscia» in «Elementi nella barra» va dove la mette l'utente.
  - **Clic:** un pulsante torna come `strip:btn:<i>` e fa ciò che fa nella striscia (`barClick`). Il testo apre l'isola, o la chiude se è aperta.
  - **Niente vista compatta con la barra:** `showInStrip` e `peek` non la fanno comparire.
  - **Prova dal vivo:** un permesso finto mandato al relay (`PermissionRequest`) è comparso nella barra in giallo con Nega / Consenti. Il clic su Nega ha restituito al relay `deny` («Negato da EasyIsland»), senza vista compatta. La sessione finta è stata chiusa con `SessionEnd`.
  - **Smoke test:** «47 scene con errori» era il server di sviluppo fermo: riavviato, «nessun errore».

