// The blocks of the chat's replies, read as little as possible (22 Nov 2026,
// Edoardo: «la chat più fluida»).
//
// - A finished reply is read once per text and kept with its message: the
//   whole conversation is laid again at every new message, and reading every
//   reply's markdown again (code colours too) made long ones slow.
// - A reply streaming in: the part up to its last blank line outside a code
//   block is made of finished blocks (markdown.ts reads each block alone: a
//   blank line always closes one) and is kept; only what comes after is read
//   again at each piece. The finished reply is read whole once more (done),
//   so it ends exactly as before.

import { renderMarkdown, type MarkdownHooks } from "../core/markdown";
import { foldSteps } from "./typeline";

/** The first line of a step of the reply (typeline.ts foldSteps). */
const STEP = /^\s*>\s*(⚙|💭)/u;

/** A line that opens a code block, as markdown.ts reads one (its FENCE). */
const FENCE_OPEN = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/;

/** Where the finished blocks of `text` end: after its last blank line outside a ``` or ~~~ block (0 for none). */
export function settledEnd(text: string): number {
  let at = 0;
  let end = 0;
  let fence = "";
  // The block before is a step («> ⚙ …», «> 💭 …»): its «esito» may follow, and
  // foldSteps puts that inside it, so the two are never cut apart.
  let step = false;
  let fresh = true;
  for (const line of text.split("\n")) {
    const next = at + line.length + 1;
    if (fence) {
      // Closed as markdown.ts closes it: a line that starts with the same mark.
      if (line.trim().startsWith(fence)) fence = "";
    } else if (FENCE_OPEN.test(line)) {
      fence = line.trim().slice(0, 3);
      step = false;
    } else if (!line.trim()) {
      if (at > 0 && next <= text.length && !step) end = next;
      fresh = true;
      at = next;
      continue;
    } else if (fresh) step = STEP.test(line);
    fresh = false;
    at = next;
  }
  return end;
}

export class ReplyBlocks {
  private shapes = new WeakMap<object, { content: string; nodes: HTMLElement[] }>();
  private stream = { text: "", nodes: [] as HTMLElement[] };

  /** `hooks`: asked when needed (the chat defines them after this). */
  constructor(private readonly hooks: () => MarkdownHooks) {}

  /** A finished reply's blocks (steps folded), made again only when its text changed. */
  done(message: { content: string }): HTMLElement[] {
    const hit = this.shapes.get(message);
    if (hit && hit.content === message.content) return hit.nodes;
    const nodes = foldSteps(renderMarkdown(message.content, this.hooks()), true);
    this.shapes.set(message, { content: message.content, nodes });
    return nodes;
  }

  /** The blocks of a reply streaming in: the settled ones kept, the rest read again. */
  live(text: string): HTMLElement[] {
    const cut = settledEnd(text);
    const head = text.slice(0, cut);
    const s = this.stream;
    if (head !== s.text) {
      if (s.text && head.startsWith(s.text)) {
        s.nodes = [...s.nodes, ...foldSteps(renderMarkdown(head.slice(s.text.length), this.hooks()), false)];
      } else {
        // Another reply, or one that started again: from its beginning.
        s.nodes = head ? foldSteps(renderMarkdown(head, this.hooks()), false) : [];
      }
      s.text = head;
    }
    return [...s.nodes, ...foldSteps(renderMarkdown(text.slice(cut), this.hooks()), false)];
  }
}
