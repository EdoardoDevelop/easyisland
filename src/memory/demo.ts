// A made-up memory for the window in a plain browser (npm run dev, smoke and
// screenshots): never loaded inside the app.

import type { MemEdge, MemEvent, MemGraph, MemNode } from "./data";

/** Another PC whose memory is copied here (Agent Chat), made up too. */
const OTHER = "ufficio";

/** `source`: "" this PC, OTHER its copy, "*" both (brain::graph_of). */
export function demoGraph(source = ""): MemGraph {
  // ?many=300: a big memory, to see how the views hold up with many nodes.
  const many = Number(new URLSearchParams(location.search).get("many"));
  const mine = thisPc();
  if (many > 0) grow(mine, Math.min(3000, many));
  const other = otherPc();
  const g = source === OTHER ? { ...other, folder: `C:\\Users\\…\\EasyIsland\\memoria-condivise\\${OTHER}` } : mine;
  if (source === "*") {
    mine.nodes.push(...other.nodes);
    mine.edges.push(...other.edges, { from: "p:studio-rossi", to: `${OTHER}|p:studio-rossi`, label: OTHER });
    mine.events.push(...other.events);
    mine.events.sort((a, b) => a.date.localeCompare(b.date));
  }
  return { ...g, sources: [OTHER] };
}

/** The other PC's memory, with its ids as brain.rs tags them. */
function otherPc(): MemGraph {
  const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
  const id = (s: string) => `${OTHER}|p:${s}`;
  const pages: [string, string, number, string][] = [
    ["studio-rossi", "Studio Rossi", 1, "Server nuovo da montare a dicembre."],
    ["server-proxmox", "Server Proxmox", 3, "Due SSD in RAID1, scrub il primo sabato del mese."],
    ["listino-2026", "Listino 2026", 5, "Prezzi delle ore e dei contratti."],
    ["fornitori", "Fornitori", 12, "Grossisti per PC e dischi."],
  ];
  const nodes: MemNode[] = pages.map(([s, label, back, text]) => ({ id: id(s), kind: "page", label, date: day(back), text, weight: 2, origin: OTHER }));
  const edges: MemEdge[] = [
    { from: id("studio-rossi"), to: id("server-proxmox"), label: "usa" },
    { from: id("server-proxmox"), to: id("fornitori"), label: "comprato da" },
    { from: id("listino-2026"), to: id("fornitori"), label: "" },
  ];
  const events: MemEvent[] = pages.map(([s, label, back]) => ({ date: day(back), lane: "page", text: label, node: id(s) }));
  return { nodes, edges, events, check: [], inbox: [], folder: "" };
}

function thisPc(): MemGraph {
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
  edges.push({ from: "p:backup-3-2-1", to: "p:officina-verdi", label: "usato da", strength: 2 });
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
    [2, "Marco Rossi vuole il preventivo del NAS nuovo entro venerdì (Agent Chat)"],
    [4, "Laura Bianchi ha aperto un ticket per la stampante dello Studio Rossi"],
    [7, "L'Officina Verdi ha chiesto via mail l'aggiornamento del gestionale"],
    [9, "Chiamata con Marco Rossi: rinnovo dell'assistenza a gennaio"],
    [12, "Il gestionale dell'Officina Verdi va riavviato dopo gli aggiornamenti (da lavoro)"],
    [20, "Certbot sui server dei clienti ogni 60 giorni"],
    [33, "Una nota rimasta senza collegamenti"],
  ] as const;
  notes.forEach(([back, text], i) => {
    nodes.push({ id: `n:${i}`, kind: "note", label: text, date: day(back), text, weight: 0 });
    events.push({ date: day(back), lane: "note", text, node: `n:${i}` });
  });
  // Strength as brain.rs gives it: 2 the note names the page, 1 a guess.
  edges.push(
    { from: "n:1", to: "p:studio-rossi", label: "", strength: 2 }, { from: "n:2", to: "p:nas-synology", label: "", strength: 2 },
    { from: "n:3", to: "p:officina-verdi", label: "", strength: 2 }, { from: "n:5", to: "p:backup-3-2-1", label: "", strength: 2 },
    { from: "n:6", to: "p:marco-rossi", label: "", strength: 2 }, { from: "n:6", to: "p:nas-synology", label: "", strength: 1 },
    { from: "n:7", to: "p:laura-bianchi", label: "", strength: 2 }, { from: "n:7", to: "p:studio-rossi", label: "", strength: 2 },
    { from: "n:8", to: "p:officina-verdi", label: "", strength: 2 }, { from: "n:8", to: "p:gestionale-officina", label: "", strength: 1 },
    { from: "n:9", to: "p:marco-rossi", label: "", strength: 2 }, { from: "n:9", to: "p:assistenza-annuale", label: "", strength: 1 },
    { from: "n:10", to: "p:gestionale-officina", label: "", strength: 1 }, { from: "n:10", to: "n:8", label: "", strength: 1 },
    { from: "n:11", to: "p:certificati", label: "", strength: 1 }, { from: "n:4", to: "p:assistenza-annuale", label: "", strength: 1 },
  );
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

/**
 * Adds `count` made-up nodes to the small memory: customers with their people,
 * devices and contracts as pages, notes about them, a few sources and days,
 * linked the way brain.rs links them. Same seed, same memory.
 */
function grow(g: MemGraph, count: number) {
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const day = (back: number) => {
    const d = new Date(Date.now() - back * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const firms = ["Farmacia Centrale", "Studio Bianchi", "Officina Neri", "Hotel Lago", "Comune di Sopra", "Cantina Colli", "Ottica Sole", "Dentista Ferri", "Panificio Gallo", "Autoscuola Riva", "Studio Legale Greco", "Agenzia Mare", "Scuola Arcobaleno", "Ferramenta Conti", "Palestra Forma", "Pizzeria Vesuvio", "Notaio Marino", "Clinica Vet Fido"];
  const people = ["Giulia", "Luca", "Paolo", "Sara", "Andrea", "Chiara", "Matteo", "Elena", "Davide", "Francesca", "Simone", "Marta", "Stefano", "Valentina", "Alessio", "Irene"];
  const surnames = ["Ricci", "Costa", "Fontana", "Moretti", "Barbieri", "Lombardi", "Galli", "Martini", "Leone", "Longo", "Gentile", "Rinaldi"];
  const things = ["Firewall", "NAS", "Server", "Centralino 3CX", "Stampante", "Wi-Fi", "Backup", "Microsoft 365", "Antivirus", "Gestionale", "VPN", "Dominio"];
  const notes = ["vuole il preventivo entro venerdì", "ha chiesto di spostare l'intervento", "paga a 30 giorni", "rinnovo del contratto a marzo", "il disco del NAS fa rumore", "chiamare dopo le 15", "password da cambiare ogni 90 giorni", "ticket aperto per la stampante", "aggiornamento del gestionale a fine mese", "la VPN cade la sera", "nuovo PC per la reception", "backup verificato, tutto a posto", "mail di sollecito per la fattura", "sopralluogo fissato per giovedì", "licenze Microsoft 365 da rinnovare"];
  const pages: string[] = [];
  let made = 0;
  const addPage = (label: string, back: number, text: string) => {
    const id = `p:big-${pages.length}`;
    g.nodes.push({ id, kind: "page", label, date: day(back), text, weight: 0 });
    g.events.push({ date: day(back), lane: "page", text: label, node: id });
    pages.push(id);
    made++;
    return id;
  };
  const link = (from: string, to: string, label = "", strength?: number) => g.edges.push({ from, to, label, strength });
  // A third pages, the rest notes, sources and days.
  const pageCount = Math.max(6, Math.round(count * 0.28));
  for (let i = 0; made < pageCount; i++) {
    const firm = firms[i % firms.length] + (i >= firms.length ? ` ${Math.floor(i / firms.length) + 1}` : "");
    const boss = `${pick(people)} ${pick(surnames)}`;
    const firmId = addPage(firm, Math.floor(rnd() * 200), `Cliente, ${2 + Math.floor(rnd() * 20)} postazioni.\n- referente: [[${boss}]]`);
    const bossId = addPage(boss, Math.floor(rnd() * 200), `Referente di ${firm}.\n- lavora per: [[${firm}]]`);
    link(firmId, bossId, "referente");
    const kit = addPage(`${pick(things)} ${firm}`, Math.floor(rnd() * 200), `In uso da ${firm}.`);
    link(firmId, kit, "usa");
    if (i > 0 && rnd() < 0.5) link(firmId, pages[Math.floor(rnd() * (pages.length - 3))], "", 2);
  }
  const noteIds: string[] = [];
  for (let i = 0; made < count * 0.9; i++) {
    const p = pick(pages);
    const who = g.nodes.find((n) => n.id === p)!.label;
    const text = `${who}: ${pick(notes)}`;
    const id = `n:big-${i}`;
    const back = Math.floor(rnd() * 180);
    g.nodes.push({ id, kind: "note", label: text, date: day(back), text, weight: 0 });
    g.events.push({ date: day(back), lane: "note", text, node: id });
    link(id, p, "", 2);
    if (rnd() < 0.35) link(id, pick(pages), "", 1);
    if (noteIds.length && rnd() < 0.2) link(id, pick(noteIds), "", 1);
    noteIds.push(id);
    made++;
  }
  for (let i = 0; made < count; i++) {
    const back = Math.floor(rnd() * 120);
    if (i % 2) {
      const id = `s:big-${i}.pdf`;
      g.nodes.push({ id, kind: "source", label: `documento-${i}.pdf`, date: day(back), text: "", weight: 0 });
      g.events.push({ date: day(back), lane: "source", text: `documento-${i}.pdf`, node: id });
      link(pick(pages), id, "fonte");
    } else {
      const id = `d:big-${day(back + 7)}`;
      if (!g.nodes.some((n) => n.id === id)) {
        g.nodes.push({ id, kind: "day", label: day(back + 7), date: day(back + 7), text: "5 domande alla chat", weight: 0 });
        link(id, pick(pages));
      }
    }
    made++;
  }
  const degree = new Map<string, number>();
  for (const e of g.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  for (const n of g.nodes) n.weight = degree.get(n.id) ?? 0;
  g.events.sort((a, b) => a.date.localeCompare(b.date));
}
