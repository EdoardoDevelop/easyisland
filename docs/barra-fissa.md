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
- [ ] **2. Elementi delle aree:**
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
