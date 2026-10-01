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

L'installer scaricabile è **temporaneamente non disponibile**. Microsoft Defender
segnala per errore l'installer non firmato come malware (`Trojan:Win32/Wacatac.H!ml`,
un falso positivo del machine learning). Finché l'installer non è firmato,
[compilalo da te](#compilarlo-da-te): ci vogliono pochi minuti e si installa solo
per l'utente corrente, senza richiesta di amministratore.

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

Servono [Rust](https://rustup.rs), [Node 20+](https://nodejs.org) e gli
**MSVC build tools** (Visual Studio Build Tools con "Sviluppo di applicazioni
desktop con C++"). WebView2 è già incluso in Windows 10/11.

```powershell
npm install
npm run tauri dev      # build di sviluppo con ricaricamento automatico
npm run pack           # crea l'installer e lo mette in release/
```

`npm run dev` da solo serve il front end in un normale browser, che basta per
lavorare all'aspetto dell'isola. Serve anche `dev/upload-preview.html`, che
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
