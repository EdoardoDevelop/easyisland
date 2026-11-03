// Drag to reorder the children of a container (the overview's pills, the
// header's integration tabs). Children carry `data-id`; a press that moves
// more than a few pixels becomes a drag, the item follows the pointer through
// its siblings, and on release the new order of ids is reported. A press that
// does not move stays an ordinary click. With `out`, an item dropped outside
// the island is handed over instead (the menu's «Apri in una finestra»).

const DRAG_THRESHOLD = 5;

export interface SortableOptions {
  /** False while the order is locked (Impostazioni → Integrazioni). */
  enabled(): boolean;
  onReorder(ids: string[]): void;
  /** Dragged out of the island: `outside` says where that is, `drop` gets the item. */
  out?: {
    outside(e: PointerEvent): boolean;
    drop(id: string, e: PointerEvent): void;
  };
}

/** True while an item of `container` is being dragged: do not rebuild it meanwhile. */
export function isSorting(container: HTMLElement): boolean {
  return container.classList.contains("sorting");
}

export function sortable(container: HTMLElement, opts: SortableOptions): void {
  let drag: { el: HTMLElement; x: number; y: number; started: boolean; before: string; sort: boolean } | null = null;

  const items = () => Array.from(container.children).filter((c): c is HTMLElement => c instanceof HTMLElement && !!c.dataset.id);
  const order = () => items().map((c) => c.dataset.id!);

  container.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // Locked order: the item can still be dragged out, not moved among the others.
    const sort = opts.enabled();
    if (!sort && !opts.out) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
    if (!el || el.parentElement !== container) return;
    drag = { el, x: e.clientX, y: e.clientY, started: false, before: order().join("|"), sort };
  });

  // The page listens, not only the container: a quick drag leaves it before the capture.
  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_THRESHOLD) return;
      drag.started = true;
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer is already gone */
      }
      container.classList.add("sorting");
      drag.el.classList.add("dragging");
    }
    const el = drag.el;
    const away = !!opts.out?.outside(e);
    el.classList.toggle("tearing", away);
    if (away || !drag.sort) return;
    const siblings = items();
    const target = siblings.find((s) => {
      if (s === el) return false;
      const r = s.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (!target) return;
    // Moving forward lands after the target, moving back lands before it.
    if (siblings.indexOf(target) > siblings.indexOf(el)) target.after(el);
    else target.before(el);
  });

  const finish = (e: PointerEvent) => {
    const d = drag;
    drag = null;
    if (!d?.started) return;
    if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
    container.classList.remove("sorting");
    d.el.classList.remove("dragging", "tearing");
    // The release would also count as a click on the item: swallow that one
    // (it follows pointerup in the same task; if none comes, stop waiting).
    const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
    container.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => container.removeEventListener("click", swallow, { capture: true }), 0);
    if (e.type === "pointerup" && opts.out?.outside(e)) {
      // Out of the island: back to the order it had, and handed over.
      const byId = new Map(items().map((c) => [c.dataset.id!, c]));
      for (const id of d.before.split("|")) {
        const c = byId.get(id);
        if (c) container.append(c);
      }
      opts.out.drop(d.el.dataset.id!, e);
      return;
    }
    const ids = order();
    if (ids.join("|") !== d.before) opts.onReorder(ids);
  };
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
}
