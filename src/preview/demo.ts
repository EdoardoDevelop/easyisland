// Made-up tabs for the preview in a plain browser (npm run dev, screenshots):
// a web page, a Markdown file, a file the chat changed, a CSV.

import type { FileView, PreviewState } from "./types";

const APP_BEFORE = `import { createServer } from "node:http";

const PORT = 5173;

function page(title: string): string {
  return \`<h1>\${title}</h1>\`;
}

createServer((req, res) => {
  res.end(page("Studio Rossi"));
}).listen(PORT);
`;

const APP_AFTER = `import { createServer } from "node:http";

// The port comes from the environment, 5173 by default.
const PORT = Number(process.env.PORT ?? 5173);

function page(title: string, subtitle = ""): string {
  return \`<h1>\${title}</h1><p>\${subtitle}</p>\`;
}

createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(page("Studio Rossi", "Assistenza informatica"));
}).listen(PORT, () => console.log(\`http://localhost:\${PORT}\`));
`;

const README = `# Sito di Studio Rossi

Il sito dello studio, con la pagina dei **servizi** e i *contatti*.

## Avvio

1. \`npm install\`
2. \`npm run dev\` e apri [localhost:5173](http://localhost:5173)

| Pagina | File |
|---|---|
| Home | \`src/app.ts\` |
| Contatti | \`src/contatti.ts\` |

> Le modifiche si vedono subito nell'anteprima.
`;

const CSV = `Cliente;Postazioni;Contratto;Scadenza
Studio Rossi;8;Assistenza annuale;31/12/2026
Farmacia Bianchi;3;A chiamata;
Ottica Verdi;5;Assistenza annuale;30/06/2027
`;

export const DEMO: PreviewState = {
  tabs: [
    { id: 1, kind: "web", target: "http://localhost:5173/", title: "Studio Rossi", browser: true, loading: false, errors: 1 },
    { id: 2, kind: "file", target: "C:\\Progetti\\sito\\src\\app.ts", title: "app.ts", browser: false, loading: false, errors: 0 },
    { id: 3, kind: "file", target: "C:\\Progetti\\sito\\README.md", title: "README.md", browser: false, loading: false, errors: 0 },
    { id: 4, kind: "file", target: "C:\\Progetti\\sito\\clienti.csv", title: "clienti.csv", browser: false, loading: false, errors: 0 },
  ],
  active: Number(new URLSearchParams(location.search).get("tab") ?? 2),
  view: { preset: "fit", width: 0, height: 0, scheme: "", zoom: "fit" },
};

export function demoFile(path: string): FileView {
  const name = path.split("\\").pop() ?? path;
  const ext = name.split(".").pop() ?? "";
  const text = ext === "ts" ? APP_AFTER : ext === "md" ? README : ext === "csv" ? CSV : "";
  return { kind: "text", path, name, ext, size: text.length, text, dataUrl: "", before: ext === "ts" ? APP_BEFORE : null, modified: 0 };
}
