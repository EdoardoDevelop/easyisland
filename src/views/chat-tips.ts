// What the chat can do, said where it helps (asked by Edoardo on 12 Nov 2026,
// after the browser and the suppliers' portals: «bisogna mettere i
// suggerimenti sulle cose che si possono fare nella chat»). Three ways, none
// of them a list of suggested questions in the empty chat (his choice of 9 Nov):
// - tips over the field from what is in front of the user — the page in the
//   Anteprima (preview_page_kind), the portals taught, the files in the Vassoio —
//   by rules here, no engine, no tokens; a click writes the request in the
//   field, never sends it;
// - commands in the «/» menu (chat.ts commands());
// - «Cosa so fare»: the abilities by group, with examples for the field.

import { Bridge, IS_TAURI, type PortalRecipe } from "../core/bridge";
import { t } from "../core/i18n";
import { State } from "../core/state";

/** A request for the field: {{…}} are the parts to fill (Tab goes to the next). */
export interface Tip {
  label: string;
  prompt: string;
}

/** What preview_page_kind says of the Anteprima's active tab (preview.rs page_kind). */
export interface PageKind {
  kind: "none" | "products" | "login" | "page" | "file";
  url?: string;
  host?: string;
  title?: string;
  ext?: string;
  path?: string;
  local?: boolean;
}

let portals: PortalRecipe[] = [];
let portalsRead = 0;

/** The portals taught, read again at most every 30 s. */
async function knownPortals(): Promise<PortalRecipe[]> {
  if (Date.now() - portalsRead > 30_000) {
    portalsRead = Date.now();
    portals = (await Bridge.portalsList()) ?? portals;
  }
  return portals;
}

/** In the browser preview: ?tips=products|login|page|pdf|portal fakes the Anteprima (docs/anteprima-browser.md). */
function demoKind(): PageKind | null {
  if (IS_TAURI) return null;
  const k = new URLSearchParams(location.search).get("tips");
  if (!k) return null;
  if (k === "pdf") return { kind: "file", ext: "pdf", path: "C:\\offerta.pdf", title: "offerta.pdf" };
  if (k === "portal") {
    portals = [{ id: "grossista", name: "Grossista", site: "https://shop.esempio.it", searchUrl: "", json: true, login: true, dvcEntry: "Grossista B2B", vatIncluded: false, notes: "", lastOk: "", lastError: "", uses: 1 }];
    portalsRead = Date.now();
    return { kind: "login", url: "https://shop.esempio.it/login", host: "shop.esempio.it" };
  }
  return { kind: k as PageKind["kind"], url: "https://shop.esempio.it/p/1", host: "shop.esempio.it", title: "Prodotto" };
}

const sameSite = (a: string, b: string) => {
  const base = (h: string) => h.replace(/^www\./, "").split(".").slice(-2).join(".");
  return !!a && !!b && base(a) === base(b);
};

/** The key of what the tips are about: they change (and come back after ✕) only when it does. */
export function tipsKey(p: PageKind | null): string {
  return `${p?.kind ?? ""}|${p?.url ?? p?.path ?? ""}|${State.inbox?.length ?? 0}`;
}

/** What the Anteprima shows now; null when it is closed or unknown. */
export async function pageKind(): Promise<PageKind | null> {
  const demo = demoKind();
  if (demo) return demo;
  if (!State.previewOpen) return null;
  return (await Bridge.previewPageKind()) ?? null;
}

/** The tips for what is in front of the user, at most four. */
export async function contextTips(page: PageKind | null): Promise<Tip[]> {
  const out: Tip[] = [];
  const all = await knownPortals();
  const portal = page?.host ? all.find((p) => sameSite(new URL(p.site).hostname, page.host!)) : undefined;
  if (page?.kind === "products" || (portal && page?.kind === "page")) {
    if (portal) {
      out.push({ label: t("Cerca su {p}", { p: portal.name }), prompt: t("Cerca {{codice o parole}} su {p}", { p: portal.name }) });
    } else {
      out.push({ label: t("Leggi i prodotti"), prompt: t("Leggi i prodotti di questa pagina (codice, prezzo, disponibilità, foto)") });
      out.push({ label: t("Impara questo portale"), prompt: t("Impara a cercare su questo portale: fai una ricerca di prova con {{un codice che ha}} e mostrami cosa trovi") });
    }
    out.push({ label: t("Foto nel Vassoio"), prompt: t("Scarica nel Vassoio le foto di {{quale prodotto}}") });
  } else if (page?.kind === "login") {
    if (portal?.dvcEntry) out.push({ label: t("Entra con Devolutions"), prompt: t("Entra in {p} con la voce di Devolutions della ricetta", { p: portal.name }) });
    else out.push({ label: t("Entra con Devolutions"), prompt: t("Entra in questo sito con la voce di Devolutions {{nome della voce}}") });
  } else if (page?.kind === "page") {
    if (page.local) {
      out.push({ label: t("Controlla la pagina"), prompt: t("Controlla questa pagina: errori della console, richieste fallite e come si vede da telefono") });
    } else {
      out.push({ label: t("Riassumi la pagina"), prompt: t("Riassumi questa pagina") });
      out.push({ label: t("Cerca nella pagina"), prompt: t("Trova in questa pagina {{cosa}}") });
    }
  } else if (page?.kind === "file" && ["pdf", "docx", "doc"].includes(page.ext ?? "")) {
    out.push({ label: t("Leggi il documento"), prompt: t("Leggi {f} e riassumilo", { f: page.title || page.path || "" }) });
  }
  // Searching every portal: whenever there are some and the page is not one of them.
  if (all.length && !portal && out.length < 4) {
    out.push({ label: t("Cerca nei portali"), prompt: t("Cerca {{codice o parole}} in tutti i portali e confronta prezzi e disponibilità") });
  }
  // Files the user dropped: what can be done with them.
  const pdfs = (State.inbox ?? []).filter((f) => /\.pdf$/i.test(f.name));
  if (pdfs.length >= 2 && out.length < 4) out.push({ label: t("Unisci i PDF"), prompt: t("Unisci in un solo PDF {{quali}} del Vassoio") });
  return out.slice(0, 4);
}

/** «Cosa so fare»: what the chat can do, by group; examples go to the field. */
export function helpGroups(): { title: string; items: Tip[] }[] {
  return [
    { title: t("Browser e portali dei fornitori"), items: [
      { label: t("Apri e leggi un sito"), prompt: t("Apri {{indirizzo}} nell'Anteprima e dimmi cosa c'è") },
      { label: t("Insegna un portale"), prompt: t("Impara a cercare su questo portale: fai una ricerca di prova con {{un codice che ha}} e mostrami cosa trovi") },
      { label: t("Cerca nei portali"), prompt: t("Cerca {{codice o parole}} in tutti i portali e confronta prezzi e disponibilità") },
      { label: t("Preventivo dai portali"), prompt: t("Fammi un preventivo per {{cliente}} con {{quantità e prodotti}}, ricarico {{20}}%, dal mio modello Word, con le foto") },
    ] },
    { title: t("Documenti"), items: [
      { label: t("Leggi un PDF o un Word"), prompt: t("Leggi {{file}} e riassumilo") },
      { label: t("Unisci o dividi PDF"), prompt: t("Unisci in un solo PDF {{quali}} del Vassoio") },
      { label: t("Documento dal tuo modello"), prompt: t("Crea dal modello {{nome}} un documento per {{cliente}}") },
    ] },
    { title: t("Memoria"), items: [
      { label: t("Ricorda una cosa"), prompt: t("Ricordati che {{cosa}}") },
      { label: t("Cosa sai di…"), prompt: t("Cosa sai di {{cliente o argomento}}?") },
    ] },
    { title: t("Lavori da soli e automazioni"), items: [
      { label: t("Un compito nel tempo"), prompt: t("Ogni {{giorno}} alle {{9:00}} {{cosa controllare}} e avvisami solo se cambia qualcosa") },
      { label: t("Un'automazione"), prompt: t("Quando {{succede qualcosa}}, {{cosa fare}}") },
    ] },
    { title: t("Integrazioni e PC"), items: [
      { label: t("Crea un'integrazione"), prompt: t("Crea un'integrazione per {{cosa}} con {{campi}}") },
      { label: t("Stato del PC"), prompt: t("Com'è messo il PC? Disco, memoria, rete") },
      { label: t("Apri un programma"), prompt: t("Apri {{programma o cartella}}") },
    ] },
  ];
}
