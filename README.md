<div align="center">

<img src="src-tauri/icons/128x128.png" width="96" alt="Icona di Coucou">

# Coucou

**Su un PC Mochi non ha un notch, quindi vive in cima al tuo schermo.**

Approva i permessi di Claude Code, guarda la sessione lavorare, rilascia un file, chatta con Claude, tieni d'occhio i tuoi servizi: tutto senza interrompere quello che stai facendo.

![Windows 10/11](https://img.shields.io/badge/Windows-10%2F11-0078D4?logo=windows)
![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-backend-000?logo=rust)
![Licenza: MIT](https://img.shields.io/badge/licenza-MIT-green)

</div>

<img src="screenshots/greeting.png" width="640" alt="Mochi che saluta all'avvio">

---

## Installazione

Non c'è un installer da scaricare: Coucou si compila sul proprio PC, e alla fine
si ottiene un normale installer `.exe`. Ci vogliono circa 15–20 minuti la prima
volta (quasi tutti di download e compilazione), pochi minuti le volte successive.
L'installazione è solo per l'utente corrente: nessuna richiesta di amministratore.

### 1. Strumenti (solo la prima volta)

Apri **PowerShell** e installa i quattro strumenti con `winget`, già presente in
Windows 10/11:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

| Strumento | A cosa serve |
|---|---|
| Git | scaricare il progetto |
| Node.js (LTS, 20 o più recente) | compilare l'interfaccia |
| Rust (rustup) | compilare l'app e il relay `coucou-hook.exe` |
| Visual Studio Build Tools, carico "Sviluppo di applicazioni desktop con C++" | il linker e le librerie di Windows che usa Rust |

L'ultimo comando scarica alcuni GB e può richiedere parecchi minuti. WebView2,
che disegna l'interfaccia, è già incluso in Windows 10/11.

**Chiudi e riapri PowerShell** al termine, così i nuovi comandi (`git`, `npm`,
`cargo`) vengono trovati. Per controllare:

```powershell
git --version; node --version; cargo --version
```

### 2. Scarica il progetto

```powershell
cd $HOME
git clone https://github.com/EdoardoDevelop/coucou.git
cd coucou
```

> Se le modifiche più recenti sono ancora su un branch di sviluppo e non in
> `main`, passa a quel branch: `git checkout <nome-del-branch>`.

### 3. Compila l'installer

```powershell
npm install
npm run pack
```

`npm run pack` compila il relay, l'interfaccia e l'app, e alla fine lascia due
file nella cartella `release\`:

```
Coucou-Windows-X.Y.Z-setup.exe    l'installer con la versione
Coucou-Windows-setup.exe          lo stesso file con il nome fisso
```

### 4. Installa

```powershell
start .\release\Coucou-Windows-setup.exe
```

L'installer non è firmato, quindi Windows SmartScreen mostra un avviso: clicca
**Ulteriori informazioni → Esegui comunque**. Coucou si avvia e Mochi ti saluta;
da lì in poi lo trovi nel menu Start e nell'area di notifica.

Poi, dall'icona di Mochi nell'area di notifica → **Impostazioni…**:

1. **Claude Code → Installa hook…** per vedere le sessioni nell'isola (vedi sotto).
2. **Chat con Claude**: lascia "Abbonamento Claude" se usi Claude Code con il tuo
   piano, oppure inserisci una chiave API.
3. **Posizione e aspetto**: l'angolo e l'icona che preferisci.

### Aggiornare

```powershell
cd $HOME\coucou
git pull
npm install
npm run pack
start .\release\Coucou-Windows-setup.exe
```

L'installer sostituisce la versione precedente; impostazioni e chiavi restano.

### Disinstallare

Prima, in **Impostazioni… → Claude Code**, clicca **Disinstalla hook…**: il
disinstallatore volutamente non tocca il `settings.json` di Claude Code. Poi
**Impostazioni di Windows → App → App installate → Coucou → Disinstalla**.

### Se qualcosa va storto

| Errore | Soluzione |
|---|---|
| `npm`, `cargo` o `git` "non riconosciuto" | chiudi e riapri PowerShell dopo l'installazione degli strumenti |
| `linker 'link.exe' not found` | mancano i Visual Studio Build Tools con il carico C++: rilancia l'ultimo comando `winget` del passo 1 |
| `error: toolchain 'stable-x86_64-pc-windows-msvc' is not installed` | `rustup default stable-msvc` |
| l'installer viene bloccato da Defender | è il falso positivo descritto sopra: usa "Esegui comunque", oppure lancia direttamente `target\release\coucou.exe` |
| Mochi non compare | guarda nell'area di notifica (la freccia ^ accanto all'orologio) e il log in `%LOCALAPPDATA%\Coucou\coucou.log` |

## Come si usa

<img src="screenshots/compact.png" width="292" alt="L'isola compatta, con le pillole delle integrazioni come mini Mochi">
<img src="screenshots/overview.png" width="640" alt="La panoramica: l'integrazione in focus a sinistra, le altre pillole a destra">
<img src="screenshots/approval.png" width="640" alt="Una richiesta di permesso di Claude Code, con Nega e Consenti">
<img src="screenshots/chat.png" width="640" alt="Chat con Claude dall'isola">
<img src="screenshots/drop.png" width="640" alt="Mochi trasformato in una scatola, in attesa di un file">

_Le schermate mostrano ancora i testi in inglese della versione originale._

| Cosa fai | Cosa succede |
|---|---|
| Porti il mouse sull'icona di Mochi (in alto al centro, o nell'angolo che hai scelto) | Mochi si ingrandisce |
| Lasci il mouse sopra per un attimo, o clicchi | Si apre l'isola, allineata a quel lato |
| Clicchi su Mochi | Si infastidisce. Tre volte di fila e gli gira la testa |
| Lasci il puntatore su Mochi per due secondi | Cuori |
| Trascini un file sull'isola | Mochi diventa una scatola, lo inghiotte e poi si offre di rispondere a domande sul file |
| `Esc` | Chiude l'isola |
| Icona nell'area di notifica | Apri, Impostazioni…, Pausa, Esci |

Tutto il resto succede da solo: una richiesta di permesso di Claude Code apre
l'isola con **Nega / Consenti**, una sessione finita mostra cosa ha fatto e le
tue integrazioni stanno nelle pillole colorate accanto a Mochi.

## Posizione e aspetto

**Impostazioni… → Posizione e aspetto** decide dove vive Mochi e quanto si fa notare:

- **Posizione**: in alto o in basso, a sinistra, al centro o a destra. In basso
  sta sopra la barra delle applicazioni. Quando si apre, l'isola cresce
  dall'angolo scelto e il contenuto resta allineato a quel lato.
- **Icona a riposo**: Mochi fermo, un pallino con il colore dello stato, oppure
  nulla (solo una striscia invisibile sul bordo). La dimensione è regolabile.
  L'icona a riposo è un'immagine ferma: non consuma CPU.
- **Al passaggio del mouse**: un Mochi più grande e animato, oppure la barra
  compatta con le integrazioni, con dimensione regolabile.
- **Apri dopo**: quanto tenere il mouse sopra prima che si apra (o solo con un clic).
- **Resta visibile**: per quanti secondi resta l'icona grande dopo un evento.
- **Schermo intero**: durante video, giochi e presentazioni Mochi sparisce; le
  richieste di permesso compaiono comunque.

Per provare le combinazioni senza compilare l'app (basta Node, niente Rust):

```powershell
npm install
npm run ui
```

Si apre il browser su un finto desktop: il riquadro tratteggiato è la finestra
di Coucou. Le impostazioni si cambiano nell'indirizzo, per esempio
`http://localhost:1420/?anchorV=bottom&anchorH=left&iconStyle=dot&iconSize=32&hoverSize=48&openDelay=1&revealDuration=3&bg=dark`.

## Claude Code

<img src="screenshots/settings.png" width="562" alt="La finestra delle impostazioni">

Apri **Impostazioni… → Claude Code → Installa hook…**. Vedi il diff esatto di cosa
cambierà in `%USERPROFILE%\.claude\settings.json` e il percorso della copia di
backup datata che verrà creata. Non viene scritto nulla finché non clicchi. I tuoi
hook non vengono mai toccati e la disinstallazione rimuove solo le voci di Coucou.

Il relay è un piccolo eseguibile, `coucou-hook.exe`, copiato in
`%LOCALAPPDATA%\Coucou\bin\` all'avvio. Ha 300 ms per raggiungere Coucou ed esce
in modo pulito se l'app è chiusa, lenta o crashata: **una sessione di Claude Code
non viene mai bloccata né rallentata da Coucou.** Se nessuno risponde in tempo a
una richiesta di permesso, Coucou resta in silenzio e Claude Code la chiede nel
terminale come al solito.

Funziona da qualsiasi terminale: Windows Terminal, PowerShell, VS Code, Git Bash.

## Chat con Claude

**Impostazioni… → Chat con Claude** ti fa scegliere il motore della chat:

- **Abbonamento Claude (tramite Claude Code)**, il predefinito. Mochi usa
  Claude Code installato sul PC (`claude -p`, nascosto, senza finestre) e il tuo
  abbonamento Pro o Max: nessuna chiave e nessun costo extra, ma le domande
  contano nei limiti d'uso del piano. Serve Claude Code installato e con il
  login fatto. Claude Code gira in una cartella vuota
  (`%LOCALAPPDATA%\Coucou\chat`), con gli hook disattivati e solo con ricerca
  web, lettura di pagine web e lettura dei file che rilasci.
- **Chiave API Anthropic**. Mochi chiama direttamente l'API con la tua chiave,
  pagata a consumo dalla Console di Anthropic.

Le chiavi stanno in **Gestione credenziali di Windows**, mai su disco e mai
nell'interfaccia: l'isola può solo chiedere se una chiave esiste. Lo stesso vale
per le chiavi di ogni integrazione.

Mochi risponde in italiano, a meno che tu non gli scriva in un'altra lingua.

Nessuna telemetria. Le uniche richieste di rete di Coucou vanno ai servizi che
configuri tu.

## Compilarlo da te

Per chi lavora sul codice. Gli strumenti sono gli stessi del passo 1 di
[Installazione](#installazione).

```powershell
npm install
npm run tauri dev      # l'app vera, con ricaricamento automatico dell'interfaccia
npm run ui             # solo l'interfaccia nel browser (non serve Rust)
npm run build          # controllo dei tipi + build dell'interfaccia
npm run pack           # crea l'installer e lo mette in release/
```

`npm run ui` serve il front end in un normale browser senza compilare nulla in
Rust, che basta per lavorare all'aspetto dell'isola (vedi "Posizione e aspetto").
Serve anche `dev/upload-preview.html`, che
ripete in loop tutta la coreografia del rilascio di un file: è l'unica parte
dell'interfaccia che altrimenti richiede un vero trascinamento da Esplora file.
Nessuna delle due pagine finisce nell'app.

`npm run pack` lascia due file in `release/`, con gli stessi nomi che pubblica la
workflow di release:

```
Coucou-Windows-X.Y.Z-setup.exe    l'installer con la versione
Coucou-Windows-setup.exe          lo stesso file con il nome fisso
```

Installare è facoltativo: `target/release/coucou.exe` funziona da solo. Non c'è
nessuna finestra nella barra delle applicazioni e nessuna console: l'isola in cima
allo schermo e il Mochi nell'area di notifica sono tutta l'app, ed Esci sta nel
suo menu.

I 28 suoni stanno in `assets/sounds/`. Il percorso è dichiarato una sola volta, in
`SOUNDS_DIR` in cima a `vite.config.ts`.

L'icona dell'app e quella dell'area di notifica sono disegnate nel codice, come
Mochi:

```powershell
npm run icons          # rigenera src-tauri/icons da scripts/gen-icons.mjs
```

### Struttura

```
./
  src/                 front end dell'isola (TypeScript, nessun framework)
    mochi/             Mochi e il saluto all'avvio, in Canvas 2D
    island/            macchina a stati, hook, integrazioni
    views/             tutte le viste dell'isola
    settings/          la finestra delle impostazioni
  src-tauri/           backend Rust: finestra, named pipe, API Claude, poller
  hook/                coucou-hook.exe, il relay per Claude Code
  scripts/             generatore di icone, impacchettamento dell'installer
  assets/sounds/       i 28 suoni WAV
  design/              prototipo HTML originale e catture di riferimento
  docs/                SPEC.md, INTEGRATIONS.md e il sito GitHub Pages
```

### Log

`%LOCALAPPDATA%\Coucou\coucou.log`: eventi degli hook, decisioni sui permessi,
problemi dei poller. Resta sul tuo computer.

## Origine

Fork solo per Windows di [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou),
nato come app nativa macOS per il notch. Il codice macOS è stato rimosso; il
prototipo originale in `design/` resta il riferimento visivo. Alcune funzioni
esistevano solo sul Mac e non sono presenti qui: invio di un file per email,
trascinamento di Mochi su una finestra per allegarla come contesto, salto alla
finestra esatta del terminale. "Apri terminale" apre la cartella di lavoro in
VS Code quando `code` è nel `PATH`.

Licenza: MIT per il codice; per personaggio, nomi, icone e suoni vedi
`LICENSE-ASSETS.md`.
