// What deserves a second look before "Consenti" (the approval card): commands
// that delete, rewrite history, publish, run as administrator or pipe a script
// from the internet, and files that hold secrets. Words only: the card still
// shows the exact command, and nothing is ever blocked from here.

const RECURSIVE_DELETE = "Elimina file e cartelle in modo ricorsivo";
const ADMIN = "Chiede i diritti di amministratore";

const COMMAND_RISKS: [RegExp, string][] = [
  [/(^|[\s;&|(])rm\s+(-[a-z]*r|-[a-z]*\s+-r|--recursive)/, RECURSIVE_DELETE],
  [/\bremove-item\b[^|;&\n]*-r(ecurse)?\b/, RECURSIVE_DELETE],
  [/(^|[\s;&|(])(rd|rmdir)\s+\/s\b/, RECURSIVE_DELETE],
  [/(^|[\s;&|(])del\s+[^|;&\n]*\/s\b/, RECURSIVE_DELETE],
  [/\bgit\s+push\b[^|;&\n]*(\s--force\b|\s-f\b|\s--force-with-lease\b|\s\+\S)/, "Forza il push: riscrive la cronologia sul server"],
  [/\bgit\s+reset\s+[^|;&\n]*--hard\b/, "Butta via le modifiche non salvate (git reset --hard)"],
  [/\bgit\s+clean\s+[^|;&\n]*-[a-z]*f/, "Elimina i file non tracciati (git clean)"],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, "Annulla tutte le modifiche locali"],
  [/(^|[\s;&|(])sudo\s/, ADMIN],
  [/-verb\s+runas\b/, ADMIN],
  [/(^|[\s;&|(])runas\s/, ADMIN],
  [/\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgh\s+release\s+create\b|\bnuget\s+push\b|\bvsce\s+publish\b/, "Pubblica un pacchetto o una release"],
  [/\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n]*\|\s*(sh|bash|zsh|iex|invoke-expression|python3?|pwsh|powershell)\b/, "Scarica ed esegue uno script da internet"],
  [/\bformat(-volume)?\s+[a-z]:|\bdiskpart\b|\bmkfs\b|\bclear-disk\b|(^|\s)dd\s+if=/, "Agisce direttamente su un disco"],
  [/\breg(\.exe)?\s+delete\b|\bset-executionpolicy\b|\bbcdedit\b|\bnetsh\s+advfirewall\b|\bset-mppreference\b/, "Cambia impostazioni di sistema o di sicurezza"],
  [/\b(shutdown|stop-computer|restart-computer)\b/, "Spegne o riavvia il PC"],
  [/\bdrop\s+(table|database|schema)\b|\btruncate\s+table\b/, "Cancella dati da un database"],
];

/** .env, chiavi private, certificati, file di credenziali; not .env.example and the like. */
const SECRET_FILE = /(^|[\\/\s"'])(\.env(\.(?!example\b|sample\b|template\b|dist\b)[\w-]+)*|id_(rsa|dsa|ecdsa|ed25519)|[\w.-]+\.(pem|key|pfx|p12)|credentials(\.json)?|secrets?\.(json|ya?ml|toml)|\.npmrc|\.pypirc|\.netrc|\.git-credentials)(["'\s]|$)/i;

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "Patch"]);
const READ_TOOLS = new Set(["Read"]);

/** The warnings for a permission request, most serious first; none for ordinary work. */
export function risksOf(tool: string, input: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (w: string) => { if (!out.includes(w)) out.push(w); };
  const command = typeof input.command === "string" ? input.command : "";
  if (command) {
    const c = command.toLowerCase().replace(/\s+/g, " ");
    for (const [re, warning] of COMMAND_RISKS) if (re.test(c)) add(warning);
    if (SECRET_FILE.test(command)) add("Usa un file con segreti (chiavi, password)");
  }
  const file = typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : "";
  if (file && SECRET_FILE.test(file)) {
    if (WRITE_TOOLS.has(tool)) add("Scrive in un file con segreti (chiavi, password)");
    else if (READ_TOOLS.has(tool)) add("Legge un file con segreti (chiavi, password)");
  }
  return out;
}
