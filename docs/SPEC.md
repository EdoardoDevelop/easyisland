# Notch Buddy — specifica

> **Nota:** questa specifica è stata scritta per l'app macOS originale (finestra nel notch, AppKit, SwiftUI). Su Windows l'isola vive in alto al centro dello schermo e si ritira nel bordo superiore. Comportamento, viste, stati, animazioni e suoni restano gli stessi. Le differenze specifiche di Windows sono descritte nel `README.md`.

Tutte le misure sono in punti macOS. I valori vengono da `reference/notch-buddy.html` (costanti `NW`, `NH`, `EW`, `VIEWS`, `STATES`, `EMOTES`, `PISTES`, `AGENTS`, classe `Bot`). Nel dubbio, rileggere il codice del prototipo.

---

## 1. Finestra e notch

- Una `NSPanel` senza bordi: `styleMask [.borderless, .nonactivatingPanel]`, sfondo trasparente, senza ombra, livello sopra la barra dei menu (`.mainMenu + 3` o equivalente che stia sopra la barra e le app a schermo intero), `collectionBehavior [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]`.
- Dimensione fissa 720 × 320, ancorata in alto al centro dello schermo che ha il notch. L'isola è disegnata al suo interno, attaccata al bordo superiore.
- **Clic passanti**: la zona trasparente non deve mai bloccare i clic. Si alterna `ignoresMouseEvents` a 60 Hz a seconda che `NSEvent.mouseLocation` sia dentro la forma dell'isola (più 6 pt di margine) oppure no.
- Il pannello può diventare key solo quando un campo di testo dell'isola ha il focus (prompt, mail). Altrimenti non ruba mai il focus.
- Rilevamento del notch: `NSScreen.safeAreaInsets.top` > 0 e `auxiliaryTopLeftArea` / `auxiliaryTopRightArea`. Larghezza del notch `wN` = larghezza dello schermo − le due zone ausiliarie; altezza `hN` = `safeAreaInsets.top`. Il prototipo usa `wN = 184`, `hN = 32`: nell'app usare i valori reali.
- Nessuno schermo con notch (coperchio chiuso): mostrare sullo schermo principale un finto notch nero di 184 × 24 in alto al centro.
- Tracciamento del mouse: polling di `NSEvent.mouseLocation` a ogni frame. Nessun permesso necessario.

### Forma dell'isola
- Rettangolo nero `#000`, angoli superiori squadrati (si fonde con il bordo dello schermo), angoli inferiori arrotondati: 14 pt in hidden/peek/compact, 30 pt in expanded.
- Due «orecchie» concave da 14 pt agli angoli superiori, all'esterno, perché la forma si raccordi al bordo dello schermo (vedi `#island::before/::after` nel prototipo).

## 2. Modalità dell'isola

| Modalità | Larghezza | Altezza | Personaggio | Agenti secondari |
|---|---|---|---|---|
| `hidden` | wN | hN | invisibile | invisibili |
| `peek` | wN + 64 | hN | Ø 18, centro x = 19 | invisibili |
| `compact` | wN + 104 | hN | Ø 20, centro x = 27 | griglia 2×2 nell'orecchia destra |
| `expanded` | 640 | secondo la vista (§5) | secondo la vista | secondo la vista |

(Ø = diametro del corpo. Il canvas del personaggio ha lato Ø / 0,6: il corpo occupa il 60 % del canvas, il resto serve a particelle, mani e badge.)

Griglia compact: pallini Ø 9,5 attorno al punto (larghezza − 27, hN/2), distanza ±6. 1 agente: centrato. 2: affiancati. 3: due sopra, uno sotto. 4: quadrato.

## 3. Regole di comportamento (validate da Louis)

1. **Non gira niente** → `hidden`. Completamente invisibile.
2. **Mouse sul notch** mentre è `hidden` → `peek` subito, il personaggio esce salutando (mani + suono `peek` + suono `greet`). Se il mouse resta 650 ms → `expanded` (vista `overview`, oppure `empty` se non ci sono attività). Se se ne va durante il peek → ritorno a `hidden` dopo 600 ms.
3. **Ci sono attività in corso e l'utente è attivo** → `compact`: sottilissima, personaggio visibile, segue il mouse con gli occhi su tutto lo schermo.
4. **Passaggio del mouse in compact** → `expanded` dopo 200 ms. Clic sul personaggio in compact → `expanded` subito.
5. **Chiusura automatica**: una volta aperta, l'isola si richiude dopo **60 s senza attività** (movimento del mouse sull'isola, clic, digitazione). Uscire dall'isola non la chiude. Negli ultimi 10 secondi una linea di 2 pt in basso al centro (160 pt → 0, bianco al 35 %) mostra il conto alla rovescia. `Esc` chiude.
6. **Utente assente** (nessun movimento del mouse da 3 min, regolabile) → `hidden`, anche con attività in corso. Al primo movimento → ritorno a `compact` se ci sono attività.
7. **Avvisi** (permesso, domanda, errore): l'isola si apre da sola sulla vista dell'avviso, **anche se l'utente è assente**, e resta aperta (niente chiusura automatica) finché non risponde.
8. **Finito**: l'isola si apre sulla vista `finished` per 5,2 s, poi rimuove l'attività e si richiude.
9. Più avvisi contemporanei: coda, uno alla volta, in ordine di arrivo.
10. **Focus**: il personaggio grande rappresenta l'attività in focus (l'ultimo avviso, altrimenti la prima che lavora). Le altre attività sono i mini-personaggi. Cliccare un mini-personaggio lo mette in focus.

## 4. Animazioni dell'isola

- Apertura / ingrandimento: 520 ms, molla con leggero superamento, equivalente a `cubic-bezier(.32,1.22,.42,1)`. In SwiftUI partire da `.spring(response: 0.5, dampingFraction: 0.72)` e regolare a occhio confrontando con il prototipo.
- Chiusura / restringimento: 340 ms, `cubic-bezier(.45,0,.2,1)`, senza superamento.
- Larghezza, altezza, raggio, posizione e dimensione del personaggio, posizione e dimensione dei mini-personaggi si animano **insieme** (effetto «elemento condiviso»: i mini-personaggi passano dalla griglia alle pillole e poi alla colonna senza sparire).
- Contenuto delle viste: uscita 160 ms (opacità 0, sfocatura 8, scala 0,97); entrata 300 ms con 160 ms di ritardo (dopo che il contenitore ha iniziato a crescere). L'intestazione compare con 300 ms di ritardo.
- Mini-personaggi: sfasamento di 35 ms per indice.
- Etichette delle pillole: compaiono 220 ms dopo l'inizio del movimento.
- Al passaggio in `expanded`, il personaggio sbatte le palpebre.
- Suoni: `open` all'apertura, `close` alla chiusura.

## 5. Viste (modalità expanded, larghezza 640)

Struttura comune: intestazione di 34 pt (schede a sinistra: Panoramica, Chiedi, Rilascia; a destra: «N in corso» + pulsante audio). Contenuto rientrato di 36 in alto, 10 a sinistra, destra e in basso. Schede: raggio 20, sfondo `#141518`, bordo bianco al 3,5 %. Nelle viste diverse da `overview` i mini-personaggi passano in **colonna** a destra (Ø 16, x = larghezza − 31, y = 50 + i × 24) e la scheda lascia 42 pt a destra.

Velo di colore delle schede: gradiente radiale dal basso (120 % × 90 %, centro 50 % / 130 %), colore dello stato:
rosso `rgba(244,80,94,.55)`, verde `rgba(52,211,153,.5)`, rosa `rgba(244,114,182,.55)`, ambra `rgba(245,165,36,.42)`, ciano `rgba(34,211,238,.38)`, indaco `rgba(99,102,241,.5)`, neutro `rgba(255,255,255,.08)`.

| Vista | Altezza | Personaggio (x, Ø) | Contenuto | Cattura |
|---|---|---|---|---|
| `overview` | 196 | 64, 70 | scheda sinistra larga 322: riga agente + scorrimento attività; scheda destra: pillole | 03 |
| `empty` | 150 | 70, 62 | «Nulla in esecuzione al momento.» + pulsante «Chiedi a Claude» | 16 |
| `approval` | 206 | 62, 56 | agente + «Claude Code vuole eseguire un comando», blocco di codice, Nega (N), Consenti sempre, Consenti (Y) | 04 |
| `question` | 196 | 62, 56 | agente + domanda + opzioni come pulsanti | 05 |
| `error` | 190 | 62, 58 | agente + strumento, titolo, dettaglio in rosso `#FF8D97`, Riprova, Apri in n8n | 06 |
| `finished` | 170 | 62, 58 | agente + riepilogo, Apri terminale, OK | 07 |
| `confused` | 160 | 76, 66 | «Troppi colpi tutti insieme.» | 08 |
| `upload` | 176 | 140, 62 | zona tratteggiata, «Rilascia qui i tuoi file», etichette | 09 |
| `uploading` | 150 | sulla barra, Ø 28 | «Caricamento del file» + %, barra verde, il personaggio fa da cursore della barra | 10 |
| `choose` | 170 | 60, 52 | «il file è pronto.», Fai una domanda, Invia per email | 11 |
| `mail` | 210 | 56, 46 | campi A, Oggetto (+ Messaggio facoltativo), Invia, Annulla | 12 |
| `prompt` | 156 | 52, 44 | pillola di contesto + campo + microfono + invia | 13 |
| `searching` | 156 | 52, 44 | contesto + testo scintillante «Claude legge la pagina e cerca sul web…» | 14 |
| `result` | 262 (si adatta al contenuto, max 320) | 52, 44 | titolo, 3 righe di risultato, pulsanti | 15 |
| `note` | 136 | 60, 50 | messaggio breve (email inviata, copiato, apro n8n…), si chiude da solo dopo 2 s | — |

Centro verticale del personaggio: 36 + (altezza − 46) / 2, tranne `result` (y = 86).

### Scorrimento delle attività (overview)
- Posizione x = 112 nella scheda, finestra di 96 pt con maschera sfumata sopra/sotto, 4 righe da 30 pt (precedente, corrente, successiva, successiva+1).
- Riga corrente: 14 pt medium, testo scintillante (gradiente grigio → bianco → grigio che scorre in 2,2 s). Le altre: 13 pt `#5F646D`, icona 14 pt.
- Ogni 2,8 s, se l'attività in focus sta lavorando, tutto sale di 30 pt in 450 ms con `cubic-bezier(.3,.9,.3,1)`.
- Nell'app reale le righe sono le ultime azioni della sessione (strumento + destinazione: «Modifica Invoice.swift», «Esegue npm test») o i nodi n8n.

### Pillole (overview)
- 132 × 34, raggio 17, sfondo nel colore dell'agente al 13 %, bordo al 32 %, mini-personaggio Ø 24 centrato a 17 pt dal bordo sinistro, etichetta 12 pt nel colore dell'agente schiarito del 25 %. Due colonne, distanza 8, centrate verticalmente nella scheda destra (che inizia a x = 342).

### Pulsanti
- Pillola, 12,5 pt medium, sfondo bianco al 9 % (al passaggio 15 %); primario: sfondo `#F5F6F8`, testo `#0B0C0E`. Pressione: scala 0,94. Scorciatoie mostrate in una piccola pillola bordata (Y, N).

## 6. Colori degli agenti (fissi)

| Agente | Colore |
|---|---|
| Korus | `#FF6B5B` |
| SBE Hub | `#2DD4A7` |
| Morning AI Brief (n8n) | `#F7B32B` |
| Publication IG (n8n) | `#A78BFA` |
| louisraille.fr | `#38BDF8` |
| Altri | in quest'ordine: `#F472B6`, `#34D399`, `#FB923C`, `#60A5FA`, `#E879F9`, poi da capo |

Nome di una sessione di Claude Code = nome della cartella di lavoro (`cwd`), con una tabella di alias regolabile (es. `sbe-hub` → «SBE Hub»). Nome di un workflow n8n = nome del workflow.

## 7. Il personaggio del prototipo: Mochi (oggi Slime, vedi `src/character/slime.ts`)

Portare la classe `Bot` del prototipo **così com'è** in Swift (`Canvas` dentro `TimelineView(.animation(paused:))`). Costanti di Mochi (`PISTES.mochi` nel prototipo):

- R = 0,3 × lato del canvas. Corpo: superellisse con esponente 2,7, raggi rx = 1,14 R, ry = 0,88 R, spostato di +0,06 R verso il basso.
- Gradiente del corpo: `#FFFAF5` (in alto a destra) → `#DDCCBF` (in basso a sinistra). Tinta dello stato: gradiente lineare dal basso verso l'alto, colore dello stato al 92 % × tint fino al trasparente a −0,25 ry. Ombreggiatura radiale (bordo nero al 20 %) e riflesso radiale bianco al 55 % in alto a destra.
- Guance: due ellissi rosa `rgba(255,120,150,.5 × blush)`, blush minimo 0,35 per Mochi, seguono lo sguardo.
- Occhi: inchiostro `#1A1412`, larghezza 0,25 R, altezza 0,27 R, distanza angolare ±0,37 rad, inclinazione verticale −0,12 rad. Proiezione su una sfera (yaw, pitch, roll) con scorcio prospettico e ritaglio sulla silhouette: è questo che produce le capriole (gli occhi escono dall'alto e rientrano dal basso).
- Sguardo: segue il mouse con ritardo (`tanh(dx/260)`, `tanh(dy/200)`, smorzamento esponenziale). Battito di ciglia casuale ogni 2,2–5,4 s, doppio battito nel 22 % dei casi.
- Mini-personaggi: stesso motore, corpo tinto del colore dell'agente, badge ridotti.
- Canvas del personaggio grande: 230 pt × 2 (Retina); mini: 76 pt × 2.

### Stati (`STATES`)

| Chiave | Etichetta | Colore | Tinta | Occhi | Badge | Particolarità |
|---|---|---|---|---|---|---|
| `idle` | A riposo | `#E6E9EE` | 0 | pillola | nessuno | |
| `working` | Lavora | `#3B9EFF` | 0,72 | pillola | pillola «•••» animata | |
| `thinking` | Pensa | `#8B5CF6` | 0,72 | pillola | «•••» | guarda in alto a destra |
| `searching` | Cerca | `#6366F1` | 0,72 | pillola | «•••» | occhi che scorrono da sinistra a destra |
| `approval` | Aspetta il tuo via libera | `#F5A524` | 0,78 | grandi | «!» | piccoli salti in loop |
| `question` | Fa una domanda | `#22D3EE` | 0,75 | pillola | «?» | testa inclinata di 0,17 rad |
| `error` | Errore | `#F4505E` | 0,78 | piatti | punto rosso | scossa orizzontale all'ingresso |
| `finished` | Finito | `#34D399` | 0,35 | contenti (arco) | punto verde | capriola completa 950 ms + scintille |
| `ratelimit` | Limite raggiunto | `#FB923C` | 0,72 | stanchi | punto arancione | gocce di sudore |
| `sleeping` | Dorme | `#94A3B8` | 0,32 | chiusi | nessuno | respiro, «z» che salgono |
| `dizzy` | Stordito | `#F472B6` | 0,7 | spirali | nessuno | doppia capriola 1,3 s |

Alone dietro il personaggio: gradiente radiale nel colore dello stato, opacità da 0,2 a 0,6 secondo lo stato (`glow`, `go`), sfocatura 6.

Corrispondenza con gli eventi reali: vedi `INTEGRATIONS.md`. `sleeping` = nessuna attività da 10 min e isola aperta a mano; `ratelimit` = limite d'uso segnalato da Claude Code.

### Emote (`EMOTES`) e cosa le attiva

| Emote | Occhi | Extra | Suono | Attivazione |
|---|---|---|---|---|
| Amore | cuori `#FF4D6D` | guance al massimo, cuori che salgono | `love` | mouse fermo 1,9 s sul personaggio |
| Sorpreso | puntini | salto + occhi ingranditi | `pop` | quando lo si afferra |
| Fiero | stelle `#F7B32B` | stelle, testa all'indietro | `proud` | risultato di ricerca mostrato |
| Occhiolino | un occhio chiuso | testa inclinata | `wink` | email inviata, finestra agganciata |
| Sbadiglio | stanchi poi chiusi | allungamento verticale, «z» | `yawn` | subito prima di passare a `sleeping` |
| Contento | archi | guance | — | dopo una decisione, un file inghiottito |
| Infastidito | fessure inclinate | alone viola `#A855F7` | `annoyed` | uno schiaffo |

## 8. Interazioni con il personaggio

- **Passaggio del mouse** (expanded): battito di ciglia, occhi ×1,08, suono `hover`. Fermo per 1,9 s → Amore.
- **Clic** in compact/peek → apre. **Clic** in expanded → schiaffo: schiacciamento (70/130/170 ms), Infastidito 800 ms, alone viola, suoni `slap` + `annoyed`.
- **3 clic in meno di 1,7 s** → stato `dizzy` per 3,3 s, vista `confused`, suono `dizzy`, poi ritorno alla vista e allo stato precedenti.
- **Trascinare** il personaggio (> 7 pt): un personaggio fluttuante Ø 54 segue il cursore (Sorpreso + `pop`), quello nel notch sparisce. Rilasciato sulla finestra di un'altra app → **aggancio** (vedi INTEGRATIONS §4). Rilasciato altrove → torna nel notch in 420 ms rimpicciolendosi.
- **Trascinare un file** dal Finder verso la zona del notch (±220 pt attorno al centro, fino a 26 pt sotto l'isola) → vista `upload`, il personaggio si trasforma in una «vaschetta» (morph di 380 ms con rimbalzo) e guarda il file. Contorno verde e velo verde quando il file ci passa sopra.
- **Rilasciare**: il file finisce dentro il personaggio (360 ms), `gulp` a 330 ms, schiacciamento + Contento, ritorno alla forma rotonda a 950 ms, vista `uploading` (da 1,2 a 2,1 s, `tick` ogni 10 %, corrisponde alla copia nella cartella di lavoro dell'app), suono `approve`, poi vista `choose`.
- Più file: stesso flusso, etichetta «3 file».

## 9. Suoni

Nel prototipo: file WAV (48 kHz stereo), resi con un guadagno ×6. In EasyIsland i suoni sono sintetizzati nel codice (`src/core/synth.ts`) con lo stesso volume. **Volume predefinito del lettore: 0,12** per ritrovare il livello del prototipo; il cursore del volume nelle impostazioni va da 0 a 0,2. Riprodurre con lettori precaricati (latenza nulla); più suoni possono sovrapporsi. Disattivabile dall'intestazione dell'isola e dalle impostazioni (persistente).

| Evento | Suono |
|---|---|
| peek / saluto | `peek` + `greet` |
| apertura / chiusura | `open` / `close` |
| mouse sul personaggio / piccolo clic nell'interfaccia | `hover` / `blip` |
| schiaffo / infastidito / stordito | `slap` / `annoyed` / `dizzy` |
| lavora / pensa / cerca | `work` / `think` / `search` |
| permesso / domanda / errore / limite | `approval` / `question` / `error` / `rate` |
| finito | `finish` |
| decisione confermata, caricamento finito | `approve` |
| file inghiottito / avanzamento | `gulp` / `tick` |
| invio (prompt, email) / aggancio finestra | `send` / `attach` |
| emote | `love`, `pop`, `proud`, `wink`, `yawn`, `sleep` |

Nessun suono per gli aggiornamenti silenziosi (scorrimento delle attività, mini-personaggi che cambiano stato, tranne gli avvisi).

## 10. Barra dei menu e impostazioni

Piccola voce nella barra dei menu (icona: silhouette di Mochi, monocromatica). Menu: Apri il notch, Avvia la demo (⌃⌥⌘D), Impostazioni…, Debug ▸ (forzare ogni vista, ogni stato, ogni emote, aggiungere attività finte), Esci.

Finestra Impostazioni (SwiftUI, semplice):
- Chiave API Anthropic (Portachiavi), modello (per il predefinito vedi INTEGRATIONS §5).
- n8n: URL dell'istanza, chiave API (Portachiavi), intervallo di polling, workflow seguiti (tutti per impostazione predefinita).
- Claude Code: stato degli hook (installati / no), pulsante Installa / Disinstalla, attesa massima per una decisione (predefinita 110 s).
- Suono on/off, volume. Chiusura automatica (predefinita 60 s). Ritardo di assenza (predefinito 3 min).
- Avvio all'accesso (`SMAppService.mainApp`).
- Alias dei nomi di progetto e colori.

## 11. Tappe

Ogni tappa si chiude con build + cattura + confronto con i riferimenti + commit (vedi CLAUDE.md).

- **M0 Base**: verificare Xcode (`xcodebuild -version`), XcodeGen, `git init`, `project.yml`, app agente che si avvia e mostra contenuti finti. Menu Debug.
- **M1 Isola**: pannello, rilevamento del notch, 4 modalità, regole §3, clic passanti, animazioni §4, dati finti.
- **M2 Personaggio**: port di `Bot` (Mochi), tutti gli stati e le emote, mini-personaggi, alone, badge, particelle, mani. In pausa quando nascosto.
- **M3 Viste**: tutte le viste §5, scorrimento, pillole, colonna, elemento condiviso, veli. Confrontare con le 16 catture.
- **M4 Suoni**: collegamento §9, impostazioni audio.
- **M5 Claude Code**: hook, approvazioni, domande, salto al terminale (INTEGRATIONS §1).
- **M6 n8n**: polling, errori, nuovo tentativo, apertura (INTEGRATIONS §2).
- **M7 File**: trascina e rilascia, prompt su file, email via Mail (INTEGRATIONS §3 e §6).
- **M8 Finestre + ricerca**: aggancio, cattura, URL, API Claude con ricerca web, vista risultato (INTEGRATIONS §4 e §5).
- **M9 Rifinitura**: modalità demo (DEMO.md), impostazioni complete, avvio all'accesso, schermo senza notch, misura di CPU/RAM, passata finale di confronto visivo.

## 12. Criteri di accettazione

- Affiancata al prototipo, non si vede differenza su personaggio, colori, tempi e suoni.
- Nessun clic perso a causa della finestra trasparente.
- Una sessione di Claude Code non viene mai bloccata dall'app (app chiusa, crashata o lenta → subentra il terminale).
- Hidden = 0 % di CPU; compact < 3 %; memoria < 100 MB.
- La demo (⌃⌥⌘D) si filma tutta d'un fiato senza interventi.
