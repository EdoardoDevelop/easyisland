// "Cosa fai adesso": actions suggested in the ⚡ tab for the app in front
// (src-tauri/src/context.rs tells which one). Each one asks Claude about the
// text selected in that app; nothing is read until the button is clicked.

export interface Foreground {
  exe: string;
  title: string;
}

export interface Suggestion {
  label: string;
  /** An icon of action-icons.ts. */
  icon: string;
  prompt: string;
}

interface Rule {
  app: string;
  color: string;
  exes: string[];
  items: Suggestion[];
}

const S = (label: string, icon: string, prompt: string): Suggestion => ({ label, icon, prompt });

const RULES: Rule[] = [
  {
    app: "Outlook", color: "#0A84D6", exes: ["outlook.exe", "olk.exe"],
    items: [
      S("Riassumi la mail", "mail", "Riassumi questa mail in pochi punti: chi scrive, cosa chiede, scadenze."),
      S("Scrivi una risposta", "chat", "Scrivi una risposta cordiale e professionale a questa mail, in italiano. Solo il testo della risposta."),
      S("Cosa devo fare?", "check", "Elenca le cose che devo fare dopo aver letto questa mail, con eventuali scadenze."),
    ],
  },
  {
    app: "Excel", color: "#22A565", exes: ["excel.exe"],
    items: [
      S("Spiega questi dati", "chart", "Spiega questi dati copiati da Excel: cosa contengono, totali, tendenze, anomalie."),
      S("Spiega la formula", "code", "Spiega passo per passo questa formula di Excel e proponi una versione più semplice se esiste."),
      S("Crea una formula", "sparkles", "Ecco dei dati di Excel. Proponi la formula di Excel (in italiano, separatore ;) più utile per analizzarli e spiega come usarla."),
    ],
  },
  {
    app: "Word", color: "#2B7CD3", exes: ["winword.exe"],
    items: [
      S("Correggi", "check", "Correggi errori di ortografia, grammatica e punteggiatura di questo testo. Restituisci solo il testo corretto."),
      S("Rendi più formale", "briefcase", "Riscrivi questo testo in un tono più formale e professionale, stessa lingua. Solo il testo."),
      S("Riassumi", "note", "Riassumi questo testo in pochi punti."),
    ],
  },
  {
    app: "PowerPoint", color: "#D35230", exes: ["powerpnt.exe"],
    items: [
      S("Migliora la slide", "sparkles", "Migliora il testo di questa slide: più breve, chiaro, a punti. Solo il testo."),
      S("Note del relatore", "note", "Scrivi le note del relatore per presentare questo contenuto in un minuto."),
    ],
  },
  {
    app: "Browser", color: "#38BDF8",
    exes: ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "vivaldi.exe", "arc.exe"],
    items: [
      S("Riassumi", "note", "Riassumi questo testo preso da una pagina web in pochi punti."),
      S("Traduci in italiano", "globe", "Traduci in italiano questo testo. Solo la traduzione."),
      S("Spiegamelo", "info", "Spiegami questo testo in modo semplice, come a chi non è del settore."),
    ],
  },
  {
    app: "Codice", color: "#A78BFA",
    exes: ["code.exe", "cursor.exe", "devenv.exe", "rider64.exe", "idea64.exe", "pycharm64.exe", "notepad++.exe", "sublime_text.exe"],
    items: [
      S("Spiega il codice", "code", "Spiega cosa fa questo codice, in breve."),
      S("Trova bug", "bug", "Cerca bug, casi limite e problemi di sicurezza in questo codice. Sii concreto."),
      S("Migliora", "wrench", "Proponi una versione più pulita e leggibile di questo codice, mantenendo il comportamento."),
    ],
  },
  {
    app: "Terminale", color: "#22C55E",
    exes: ["windowsterminal.exe", "powershell.exe", "pwsh.exe", "cmd.exe", "conhost.exe", "wezterm-gui.exe", "alacritty.exe"],
    items: [
      S("Spiega l'errore", "alert", "Spiega questo errore del terminale e come risolverlo, con i comandi da usare su Windows."),
      S("Spiega il comando", "terminal", "Spiega cosa fa questo comando o output, riga per riga."),
    ],
  },
  {
    app: "Teams", color: "#6264A7", exes: ["ms-teams.exe", "teams.exe"],
    items: [
      S("Riassumi la chat", "chat", "Riassumi questa conversazione: decisioni, domande aperte, chi deve fare cosa."),
      S("Rispondi", "mail", "Scrivi una risposta breve e cordiale a questo messaggio. Solo il testo."),
    ],
  },
  {
    app: "PDF", color: "#F4505E", exes: ["acrord32.exe", "acrobat.exe", "foxitpdfreader.exe", "sumatrapdf.exe"],
    items: [
      S("Riassumi", "file", "Riassumi questo testo preso da un PDF in pochi punti."),
      S("Punti importanti", "star", "Elenca date, importi, scadenze e obblighi presenti in questo testo."),
    ],
  },
];

/** Any other app: what is useful on any text. */
const ANY: Rule = {
  app: "", color: "#8E939C", exes: [],
  items: [
    S("Riassumi", "note", "Riassumi questo testo in pochi punti."),
    S("Traduci", "globe", "Traduci questo testo in italiano (se è già italiano, in inglese). Solo la traduzione."),
    S("Correggi", "check", "Correggi errori di ortografia e grammatica di questo testo. Solo il testo corretto."),
  ],
};

export interface Suggestions {
  /** "Outlook", or the program's name for any other app. */
  app: string;
  color: string;
  items: Suggestion[];
}

/** "notepad.exe" → "Notepad". */
function prettyExe(exe: string): string {
  const base = exe.replace(/\.exe$/i, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function suggestionsFor(fg: Foreground | null): Suggestions | null {
  if (!fg) return null;
  // The desktop, the taskbar and the like: nothing to act on.
  if (["explorer.exe", "searchhost.exe", "startmenuexperiencehost.exe", "shellexperiencehost.exe"].includes(fg.exe)) {
    return null;
  }
  const rule = RULES.find((r) => r.exes.includes(fg.exe));
  if (rule) return { app: rule.app, color: rule.color, items: rule.items };
  return { app: prettyExe(fg.exe), color: ANY.color, items: ANY.items };
}
