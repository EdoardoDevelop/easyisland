// The animated icons (src/views/anim-icons.ts), big and at their real size.

import { clipIcon, lensIcon, planeIcon } from "../src/views/anim-icons";
import { svg } from "../src/views/dom";
import { ICONS } from "../src/views/icons";

const icons: [string, (size: number) => SVGSVGElement, string][] = [
  ["Invio", planeIcon, "send"],
  ["Cerca", lensIcon, ""],
  ["Allega", clipIcon, ""],
  ["Chiudi", (n) => svg(ICONS.xmark, n), ""],
  ["Nuovo", (n) => svg(ICONS.plus, n), ""],
  ["Fissa", (n) => svg(ICONS.pin, n), ""],
  ["Impostazioni", (n) => svg(ICONS.sliders, n), ""],
  ["Suoni", (n) => svg(ICONS.speakerOn, n), ""],
  ["Detta", (n) => svg(ICONS.mic, n, { stroke: 1.8 }), ""],
  ["Ferma", (n) => svg(ICONS.stop, n), ""],
  ["Automatica", (n) => svg(ICONS.bolt, n), ""],
  ["Multi agent", (n) => svg(ICONS.team, n), ""],
  ["Conversazioni", (n) => svg(ICONS.sidebar, n, { stroke: 1.8 }), ""],
  ["Anteprima", (n) => svg(ICONS.preview, n, { stroke: 1.8 }), ""],
  ["In finestra", (n) => svg(ICONS.popOut, n, { stroke: 1.8 }), ""],
  ["Nell'isola", (n) => svg(ICONS.popIn, n, { stroke: 1.8 }), ""],
  ["Copia", (n) => svg(ICONS.copy, n), ""],
  ["Avanti", (n) => svg(ICONS.chevronRight, n, { stroke: 2 }), ""],
  ["Indietro", (n) => svg(ICONS.chevronLeft, n, { stroke: 2 }), ""],
];

function fill(id: string, size: number) {
  for (const [name, make, cls] of icons) {
    const figure = document.createElement("figure");
    const button = document.createElement("button");
    button.className = cls;
    button.append(make(size));
    const caption = document.createElement("figcaption");
    caption.textContent = name;
    figure.append(button, caption);
    document.getElementById(id)?.append(figure);
  }
}

fill("big", 72);
fill("small", 15);
