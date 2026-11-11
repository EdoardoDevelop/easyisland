// Dragging in the island's menu (rail.ts): the order as before (sortable.ts did
// it), plus the groups (core/menu-groups.ts). An integration let go on the
// middle of another row makes a group of the two, or goes into that row's
// group; on a group's row it goes into the group. Near a row's edge it moves
// between rows instead: between the rows of an open group it joins it, out of
// them it leaves. A group's row carries its rows along. Out of the island an
// integration becomes a window, as before.
//
// Nothing moves while dragging (10/11, tried with a real mouse): the row aimed
// at lights up, or a line shows where it would go; it moves on the release. Moving
// at once shifted the rows as the pointer came in from an edge, and the middle of
// a row, where a group is made, was never reached.
//
// The rows are one flat list: a group's row (`data-head`, `data-open`) is
// followed by its own (`data-group`), hidden when it is closed.

const DRAG_THRESHOLD = 5;
/** The middle of a row, top to bottom, where a drop means «into it». */
const MIDDLE: [number, number] = [0.25, 0.75];

export interface RailDragOptions {
  /** False while the order is locked (Impostazioni → Integrazioni): only out of the island. */
  enabled(): boolean;
  outside(e: PointerEvent): boolean;
  popOut(id: string, e: PointerEvent): void;
  /** `dragged` let go on the integration `onto`. */
  merge(onto: string, dragged: string): void;
  /** `dragged` let go on the row of group `group`. */
  addTo(group: string, dragged: string): void;
  /** The new order of the integrations, and each group's (every group shown is a key). */
  commit(order: string[], members: Record<string, string[]>): void;
}

export function isRailDragging(list: HTMLElement): boolean {
  return list.classList.contains("sorting");
}

export function railDrag(list: HTMLElement, opts: RailDragOptions): void {
  let drag: {
    el: HTMLElement; block: HTMLElement[]; x: number; y: number; started: boolean; sort: boolean;
    before: HTMLElement[]; into: HTMLElement | null; place: { target: HTMLElement; after: boolean } | null;
  } | null = null;

  const rows = () => Array.from(list.children).filter((c): c is HTMLElement => c instanceof HTMLElement && !!c.dataset.id);
  const shown = (c: HTMLElement) => c.getClientRects().length > 0;
  /** A group's row and its own rows, which move with it. */
  const blockOf = (el: HTMLElement): HTMLElement[] => {
    const head = el.dataset.head;
    if (!head) return [el];
    const out = [el];
    let n = el.nextElementSibling as HTMLElement | null;
    while (n && n.dataset.group === head) {
      out.push(n);
      n = n.nextElementSibling as HTMLElement | null;
    }
    return out;
  };
  const lastOf = (head: HTMLElement) => {
    const b = blockOf(head);
    return b[b.length - 1];
  };
  const restore = (order: HTMLElement[]) => list.append(...order);
  const clearInto = () => {
    drag?.into?.classList.remove("merge-target");
    if (drag) drag.into = null;
  };
  const clearPlace = () => {
    drag?.place?.target.classList.remove("drop-before", "drop-after");
    if (drag) drag.place = null;
  };

  list.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("input")) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
    if (!el || el.parentElement !== list) return;
    const sort = opts.enabled();
    // Locked: an integration can still leave the island, a group cannot.
    if (!sort && el.dataset.head) return;
    drag = { el, block: blockOf(el), x: e.clientX, y: e.clientY, started: false, sort, before: rows(), into: null, place: null };
  });

  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_THRESHOLD) return;
      drag.started = true;
      try {
        list.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer is already gone */
      }
      list.classList.add("sorting");
      for (const b of drag.block) b.classList.add("dragging");
    }
    const el = drag.el;
    const isGroup = !!el.dataset.head;
    const away = !isGroup && opts.outside(e);
    el.classList.toggle("tearing", away);
    if (away || !drag.sort) {
      clearInto();
      clearPlace();
      return;
    }
    const target = rows().find((s) => {
      if (drag!.block.includes(s) || !shown(s)) return false;
      const r = s.getBoundingClientRect();
      return e.clientY >= r.top && e.clientY <= r.bottom && e.clientX >= r.left - 40 && e.clientX <= r.right + 40;
    });
    if (!target) {
      clearInto();
      // Back on itself: nowhere to go. In the gap between two rows: the last place shown stays.
      const self = drag.block.some((b) => {
        const br = b.getBoundingClientRect();
        return e.clientY >= br.top && e.clientY <= br.bottom;
      });
      if (self) clearPlace();
      return;
    }
    const r = target.getBoundingClientRect();
    const at = (e.clientY - r.top) / Math.max(1, r.height);
    // On the middle of a row: into it (an integration only; a group never goes into another).
    const sameGroup = !!el.dataset.group && (target.dataset.head === el.dataset.group || target.dataset.group === el.dataset.group);
    if (!isGroup && !sameGroup && at > MIDDLE[0] && at < MIDDLE[1]) {
      clearPlace();
      if (drag.into !== target) {
        clearInto();
        drag.into = target;
        target.classList.add("merge-target");
      }
      return;
    }
    clearInto();
    // Near an edge: where it would go, shown by a line; nothing moves until the release
    // (moving at once shifted the rows, and the middle of the one aimed at was never reached).
    const after = at >= 0.5;
    if (drag.place?.target !== target || drag.place.after !== after) {
      clearPlace();
      drag.place = { target, after };
      target.classList.add(after ? "drop-after" : "drop-before");
    }
  });

  /** The release near an edge: the dragged rows go before or after the row aimed at. */
  const moveTo = (block: HTMLElement[], target: HTMLElement, after: boolean) => {
    const isGroup = !!block[0].dataset.head;
    // A group moves only around whole groups: never between another one's rows.
    let anchor = target;
    if (isGroup && target.dataset.group) {
      anchor = list.querySelector<HTMLElement>(`[data-head="${CSS.escape(target.dataset.group)}"]`) ?? target;
    }
    if (after) {
      // After a closed group (or any group, for a group): after its last row.
      if (anchor.dataset.head && (isGroup || anchor.dataset.open !== "1")) anchor = lastOf(anchor);
      anchor.after(...block);
    } else {
      anchor.before(...block);
    }
  };

  const finish = (e: PointerEvent) => {
    const d = drag;
    drag = null;
    if (!d?.started) return;
    if (list.hasPointerCapture(e.pointerId)) list.releasePointerCapture(e.pointerId);
    list.classList.remove("sorting");
    for (const b of d.block) b.classList.remove("dragging", "tearing");
    const into = d.into;
    into?.classList.remove("merge-target");
    const place = d.place;
    place?.target.classList.remove("drop-before", "drop-after");
    // The release would also be a click on the row: swallow it.
    const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
    list.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => list.removeEventListener("click", swallow, { capture: true }), 0);
    const id = d.el.dataset.id!;
    if (e.type !== "pointerup") {
      restore(d.before);
      return;
    }
    if (!d.el.dataset.head && opts.outside(e)) {
      restore(d.before);
      opts.popOut(id, e);
      return;
    }
    if (into) {
      restore(d.before);
      if (into.dataset.head) opts.addTo(into.dataset.head, id);
      else opts.merge(into.dataset.id!, id);
      return;
    }
    // Let go without a place shown (on itself): nothing changes.
    if (!place) return;
    moveTo(d.block, place.target, place.after);
    // Where each row is now, and so in which group.
    const order: string[] = [];
    const members: Record<string, string[]> = {};
    let cur = "";
    for (const c of rows()) {
      if (c.dataset.head) {
        cur = c.dataset.head;
        members[cur] = [];
        continue;
      }
      order.push(c.dataset.id!);
      if (c === d.el) {
        const prev = c.previousElementSibling as HTMLElement | null;
        const next = c.nextElementSibling as HTMLElement | null;
        const head = cur ? list.querySelector<HTMLElement>(`[data-head="${CSS.escape(cur)}"]`) : null;
        const inside = !!cur && head?.dataset.open === "1" && !!prev && (prev.dataset.head === cur || prev.dataset.group === cur);
        if (inside && (next?.dataset.group === cur || c.dataset.group === cur)) members[cur].push(c.dataset.id!);
        else cur = "";
      } else if (c.dataset.group && members[c.dataset.group]) {
        members[c.dataset.group].push(c.dataset.id!);
        cur = c.dataset.group;
      } else {
        cur = "";
      }
    }
    opts.commit(order, members);
  };
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
}
