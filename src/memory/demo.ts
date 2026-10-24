// A made-up memory for the window in a plain browser (npm run dev, smoke and
// screenshots): never loaded inside the app.

import type { MemEdge, MemEvent, MemGraph, MemNode } from "./data";

export function demoGraph(): MemGraph {
  const nodes: MemNode[] = [];
  const edges: MemEdge[] = [];
  const events: MemEvent[] = [];
  const day = (back: number) => {
    const d = new Date(Date.now() - back * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const page = (id: string, label: string, back: number, text: string) => {
    nodes.push({ id: `p:${id}`, kind: "page", label, date: day(back), text, weight: 0 });
    events.push({ date: day(back), lane: "page", text: label, node: `p:${id}` });
  };
  page("studio-rossi", "Studio Rossi", 2, "Cliente dal 2021, commercialisti, 8 postazioni.\n- usa: [[NAS Synology]]\n- referente: [[Marco Rossi]]\n- contratto: [[Assistenza annuale]]");
  page("marco-rossi", "Marco Rossi", 4, "Titolare dello Studio Rossi. Preferisce le telefonate alle mail.\n- lavora con: [[Laura Bianchi]]");
  page("laura-bianchi", "Laura Bianchi", 9, "Segreteria dello Studio Rossi: apre i ticket.\n- usa: [[Portale ticket]]");
  page("nas-synology", "NAS Synology", 12, "DS920+, backup notturno su disco USB e su cloud.\n- parte di: [[Backup 3-2-1]]");
  page("backup-3-2-1", "Backup 3-2-1", 30, "Tre copie, due supporti, una fuori sede.\n- usato da: [[Officina Verdi]]");
  page("assistenza-annuale", "Assistenza annuale", 40, "Contratto con 20 ore incluse, rinnovo a gennaio.\n- prezzi in: [[Listino 2026]]");
  page("officina-verdi", "Officina Verdi", 6, "Cliente, 3 PC e un gestionale.\n- usa: [[Gestionale Officina]]\n- contratto: [[Assistenza annuale]]");
  page("gestionale-officina", "Gestionale Officina", 18, "Gira su SQL Server Express, aggiornamenti a fine mese.");
  page("portale-ticket", "Portale ticket", 22, "I clienti aprono i ticket da qui; le urgenze arrivano anche su Telegram.");
  page("certificati", "Certificati SSL", 3, "Rinnovo con certbot ogni 60 giorni sui server dei clienti.\n- per: [[Officina Verdi]]\n- per: [[Studio Rossi]]");
  nodes.push({ id: "p:listino-2026", kind: "missing", label: "Listino 2026", date: "", text: "", weight: 0 });
  const link = (a: string, b: string, label = "") => edges.push({ from: `p:${a}`, to: `p:${b}`, label });
  link("studio-rossi", "nas-synology", "usa");
  link("studio-rossi", "marco-rossi", "referente");
  link("studio-rossi", "assistenza-annuale", "contratto");
  link("marco-rossi", "laura-bianchi", "lavora con");
  link("laura-bianchi", "portale-ticket", "usa");
  link("nas-synology", "backup-3-2-1", "parte di");
  link("backup-3-2-1", "officina-verdi", "usato da");
  link("assistenza-annuale", "listino-2026", "prezzi in");
  link("officina-verdi", "gestionale-officina", "usa");
  link("officina-verdi", "assistenza-annuale", "contratto");
  link("certificati", "officina-verdi", "per");
  link("certificati", "studio-rossi", "per");
  const notes = [
    [1, "Rispondi breve e in italiano"],
    [3, "Lo Studio Rossi paga a 60 giorni"],
    [5, "Il NAS Synology si riavvia la domenica alle 3"],
    [8, "Per l'Officina Verdi chiamare prima delle 9"],
    [15, "I preventivi con IVA al 22%"],
    [26, "Backup 3-2-1 anche per i clienti nuovi"],
  ] as const;
  notes.forEach(([back, text], i) => {
    nodes.push({ id: `n:${i}`, kind: "note", label: text, date: day(back), text, weight: 0 });
    events.push({ date: day(back), lane: "note", text, node: `n:${i}` });
  });
  edges.push({ from: "n:1", to: "p:studio-rossi", label: "" }, { from: "n:2", to: "p:nas-synology", label: "" }, { from: "n:3", to: "p:officina-verdi", label: "" }, { from: "n:5", to: "p:backup-3-2-1", label: "" });
  for (const [i, name] of ["verbale-riunione.md", "mail-rossi.eml", "manuale-nas.html"].entries()) {
    const id = `s:${name}`;
    nodes.push({ id, kind: "source", label: name, date: day(5 + i * 9), text: "", weight: 0 });
    events.push({ date: day(5 + i * 9), lane: "source", text: name, node: id });
  }
  edges.push({ from: "p:studio-rossi", to: "s:mail-rossi.eml", label: "fonte" }, { from: "p:nas-synology", to: "s:manuale-nas.html", label: "fonte" }, { from: "p:marco-rossi", to: "s:verbale-riunione.md", label: "fonte" });
  // The diary: a few questions a day, more on some days.
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let back = 60; back >= 0; back--) {
    const n = Math.floor(rnd() * (back % 7 < 2 ? 2 : 9));
    for (let q = 0; q < n; q++) {
      const hh = String(8 + Math.floor(rnd() * 10)).padStart(2, "0");
      events.push({ date: `${day(back)} ${hh}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}`, lane: "diary", text: "subscription · Come rinnovo il certificato dello Studio Rossi? → Con certbot renew…", node: "" });
    }
  }
  for (const back of [1, 3, 6]) {
    const id = `d:${day(back)}`;
    nodes.push({ id, kind: "day", label: day(back), date: day(back), text: "7 domande alla chat", weight: 0 });
    edges.push({ from: id, to: back === 6 ? "p:officina-verdi" : "p:studio-rossi", label: "" });
  }
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  for (const n of nodes) n.weight = degree.get(n.id) ?? 0;
  events.sort((a, b) => a.date.localeCompare(b.date));
  return {
    nodes,
    edges,
    events,
    check: ["La pagina «Assistenza annuale» porta a «Listino 2026», che non esiste", "Note simili: «Backup 3-2-1 anche per i clienti nuovi» e la pagina «Backup 3-2-1»"],
    inbox: ["articolo-firewall.html", "appunti-call-verdi.txt"],
    folder: "C:\\Users\\…\\EasyIsland\\memoria",
  };
}
