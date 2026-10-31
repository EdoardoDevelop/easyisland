// Island geometry — ported from IslandTypes.swift + IslandWindowController.islandSize
// + IslandRootView.botPosition. All values are logical pixels, identical to the
// macOS app's points.

export type IslandMode = "hidden" | "compact" | "expanded";

export type AnchorH = "left" | "center" | "right";
/** "middle" only for an island opened in the middle of the screen (`islandPlace`). */
export type AnchorV = "top" | "middle" | "bottom";

/** Placement and look of the island outside of the expanded panel. */
export interface Placement {
  h: AnchorH;
  v: AnchorV;
  iconStyle: "character" | "dot" | "none";
  iconSize: number;
  hoverStyle: "icon" | "bar";
  hoverSize: number;
  /** Touches the screen edge on its anchored side, horizontally / vertically:
   *  no gap there, and square corners against it. */
  glueX?: boolean;
  glueY?: boolean;
  /** Centred, moved this far sideways in the window (an island come out of the fixed bar). */
  dx?: number;
}

export type IslandViewName =
  | "overview"
  | "empty"
  | "approval"
  | "notify"
  | "ask"
  | "question"
  | "error"
  | "finished"
  | "confused"
  | "upload"
  | "uploading"
  | "choose"
  | "mail"
  | "prompt"
  | "searching"
  | "result"
  | "note"
  | "greeting"
  | "actions"
  | "run"
  | "rewrite"
  | "unzip"
  | "files"
  | "diff"
  | "recap"
  | "moment"
  | "daily"
  | "barcard"
  | "news"
  | "done"
  | "remember";

export type BotStateName =
  | "idle"
  | "working"
  | "thinking"
  | "searching"
  | "approval"
  | "question"
  | "error"
  | "finished"
  | "ratelimit"
  | "sleeping"
  | "dizzy";

export type BotEmoteName = "love" | "surprised" | "proud" | "wink" | "yawn" | "happy" | "annoyed";

export type AgentLayoutMode = "none" | "grid" | "pills" | "column";

export interface ViewLayout {
  height: number;
  botX: number;
  botY: number | null; // null = auto-centred
  botDiameter: number;
  agentMode: AgentLayoutMode;
}

// The window is at least 720×560 while open; the island is drawn inside it, pinned
// to the chosen corner. 560 leaves room for views that grow with their content.
// An island the user made bigger gets a bigger window, up to the work area
// (`panelFor`, island.rs `set_panel_size`).
export const PANEL_W = 720;
export const PANEL_H = 560;

/** Island chrome around the views: 8 px top inset + 34 px top bar + 10 px bottom. */
export const ISLAND_CHROME_H = 52;
/** The open island's top bar (the character's bubble, the field, the buttons): the
 *  header's old height, which the drop sequence and the greeting are drawn around. */
export const TOPBAR_H = 34;
/** Room between the top bar and the menu and views below it (`#island.railed #body`). */
export const BODY_GAP = 8;
/** The menu on the left of the open island (sections, integrations), and the gap after it. */
export const RAIL_W = 164;
export const RAIL_GAP = 10;
/** The character at the head of the menu: its diameter for each size (`menuCharacter`). */
export const RAIL_BOT: Record<string, number> = { large: 64, medium: 52, small: 40 };
/** The tallest an expanded island may grow on its own to fit its content. */
export const MAX_ISLAND_H = PANEL_H - 2 * 8;

// No notch on a PC: these are the hidden/compact sizes of the original spec.
export const NOTCH_W = 184;
export const NOTCH_H = 32;
export const COMPACT_W = 288; // NOTCH_W + 104
/** The compact island with its strip (src/views/strip.ts): at least this tall, for two lines and the buttons. */
export const STRIP_H = 44;
export const EXPANDED_W = 640;
/** Narrowest the user can make the open island. */
export const ISLAND_MIN_W = 560;

/**
 * The largest open island on a screen whose work area is `limits` (logical px):
 * the work area less the edge margins, never below the usual window's room.
 */
export function islandMax(limits: { w: number; h: number }): { w: number; h: number } {
  return {
    w: Math.max(PANEL_W, limits.w) - 2 * EDGE_MARGIN,
    h: Math.max(PANEL_H, limits.h) - 2 * EDGE_MARGIN,
  };
}

/** The window an island of `w`×`h` needs: the usual one, or bigger, up to `limits`. */
export function panelFor(w: number, h: number, limits: { w: number; h: number }): { w: number; h: number } {
  return {
    w: Math.min(Math.max(PANEL_W, limits.w), Math.max(PANEL_W, Math.ceil(w + 2 * EDGE_MARGIN))),
    h: Math.min(Math.max(PANEL_H, limits.h), Math.max(PANEL_H, Math.ceil(h + 2 * EDGE_MARGIN))),
  };
}

export const ROUNDED_CORNER = 14; // hidden / compact
export const EXPANDED_CORNER = 22;

/** Invisible hover strip that wakes the island when hidden. */
export const WAKE_STRIP_W = 240;
export const WAKE_STRIP_H = 6;

/** Gap between a floating island and the screen edges, px. */
export const EDGE_MARGIN = 8;

/**
 * Which screen edges the island touches: with `glueEdges` any anchored side
 * left at the edge (no offset after a drag, or a few px from it). Off, the
 * island floats a few pixels off every edge, fully rounded — top centre too:
 * it used to hang from the top edge there anyway, and the switch seemed to do
 * nothing (Edoardo, 29 Oct 2026).
 */
export function glueFor(
  h: AnchorH,
  offsetX: number,
  offsetY: number,
  glueEdges: boolean,
): { glueX: boolean; glueY: boolean } {
  if (!glueEdges) return { glueX: false, glueY: false };
  return { glueX: h !== "center" && offsetX === 0, glueY: offsetY === 0 };
}

export function isGlued(p: Placement): boolean {
  return !!(p.glueX || p.glueY);
}

/** CSS border-radius: square where the island meets a screen edge. */
export function cornerRadii(p: Placement, r: number): string {
  const top = p.glueY && p.v === "top";
  const bottom = p.glueY && p.v === "bottom";
  const left = p.glueX && p.h === "left";
  const right = p.glueX && p.h === "right";
  const c = (square: boolean | undefined) => (square ? "0" : `${r}px`);
  return [c(top || left), c(top || right), c(bottom || right), c(bottom || left)].join(" ");
}

/**
 * Top-left corner of a `w`×`hh` island inside a `winW`×`winH` window pinned to
 * the same side of the screen. Growing the island keeps the anchored side
 * still, so everything opens away from the chosen corner.
 */
export function anchoredOrigin(
  p: Placement,
  w: number,
  hh: number,
  winW = PANEL_W,
  winH = PANEL_H,
): { x: number; y: number } {
  const mx = p.glueX ? 0 : EDGE_MARGIN;
  const my = p.glueY ? 0 : EDGE_MARGIN;
  const x = p.h === "left" ? mx : p.h === "right" ? winW - mx - w : (winW - w) / 2 + (p.dx ?? 0);
  const y = p.v === "bottom" ? winH - my - hh : p.v === "middle" ? (winH - hh) / 2 : my;
  return { x, y };
}

/** Size of the window while collapsed: the rest icon's box, or the wake strip. */
export function collapsedBox(p: Placement): { w: number; h: number } {
  if (p.iconStyle === "none") return { w: WAKE_STRIP_W, h: WAKE_STRIP_H };
  const side = Math.round(p.iconSize + 2 * EDGE_MARGIN);
  return { w: side, h: side };
}

/** The compact island: a round badge holding a live the character, or the old bar. */
export function compactSize(p: Placement): { w: number; h: number } {
  if (p.hoverStyle === "bar") return { w: COMPACT_W, h: NOTCH_H };
  const side = Math.round(p.hoverSize);
  return { w: side, h: side };
}

export const VIEW_LAYOUTS: Record<IslandViewName, ViewLayout> = {
  overview: { height: 160, botX: 68, botY: null, botDiameter: 58, agentMode: "pills" },
  empty: { height: 160, botX: 70, botY: null, botDiameter: 62, agentMode: "none" },
  approval: { height: 160, botX: 62, botY: null, botDiameter: 56, agentMode: "column" },
  ask: { height: 230, botX: 62, botY: 100, botDiameter: 56, agentMode: "column" },
  question: { height: 160, botX: 62, botY: null, botDiameter: 56, agentMode: "column" },
  error: { height: 160, botX: 62, botY: null, botDiameter: 58, agentMode: "column" },
  finished: { height: 160, botX: 62, botY: null, botDiameter: 58, agentMode: "column" },
  confused: { height: 160, botX: 76, botY: null, botDiameter: 66, agentMode: "column" },
  upload: { height: 176, botX: 140, botY: 104, botDiameter: 62, agentMode: "column" },
  // botY 103 = bar top (42 + 58) + 3, so the dot really rides the bar. The Swift
  // layout says 118 while its own comment says 103; the comment matches the spec.
  uploading: { height: 176, botX: 46, botY: 103, botDiameter: 20, agentMode: "none" },
  choose: { height: 176, botX: 60, botY: 101, botDiameter: 52, agentMode: "column" },
  mail: { height: 240, botX: 56, botY: null, botDiameter: 46, agentMode: "column" },
  prompt: { height: 160, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  notify: { height: 160, botX: 62, botY: null, botDiameter: 56, agentMode: "column" },
  searching: { height: 160, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  result: { height: 160, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  note: { height: 160, botX: 60, botY: null, botDiameter: 50, agentMode: "column" },
  greeting: { height: 150, botX: 320, botY: 90, botDiameter: 0, agentMode: "none" },
  actions: { height: 200, botX: 52, botY: null, botDiameter: 44, agentMode: "none" },
  run: { height: 280, botX: 52, botY: 92, botDiameter: 44, agentMode: "none" },
  rewrite: { height: 380, botX: 52, botY: 92, botDiameter: 44, agentMode: "none" },
  unzip: { height: 230, botX: 52, botY: 92, botDiameter: 44, agentMode: "none" },
  files: { height: 230, botX: 52, botY: 92, botDiameter: 44, agentMode: "none" },
  diff: { height: 280, botX: 52, botY: 92, botDiameter: 44, agentMode: "none" },
  recap: { height: 170, botX: 62, botY: null, botDiameter: 56, agentMode: "none" },
  moment: { height: 160, botX: 62, botY: null, botDiameter: 56, agentMode: "none" },
  daily: { height: 200, botX: 62, botY: null, botDiameter: 56, agentMode: "none" },
  barcard: { height: 200, botX: 62, botY: null, botDiameter: 56, agentMode: "none" },
  news: { height: 260, botX: 62, botY: null, botDiameter: 56, agentMode: "none" },
  done: { height: 260, botX: 62, botY: null, botDiameter: 56, agentMode: "none" },
  remember: { height: 300, botX: 52, botY: 92, botDiameter: 44, agentMode: "none" },
};

// The upload views above are only the fallback geometry. Once a file is actually
// dropped the whole sequence — the character included — is drawn by src/upload, which
// owns its own constants (USC) straight from UploadSequenceEngine.swift.

/** Chat view grows with the conversation — IslandContainer.chatPromptHeight. */
export function chatPromptHeight(messageCount: number): number {
  return Math.min(300, 240 + messageCount * 40);
}

export function islandSize(
  mode: IslandMode,
  view: IslandViewName,
  chatCount = 0,
  compact: { w: number; h: number } = { w: COMPACT_W, h: NOTCH_H },
  /** Natural height of the view's content, px; the island grows to show it all. */
  fit = 0,
): { w: number; h: number } {
  switch (mode) {
    case "hidden":
      // No notch to hide inside on a PC: the island retracts to zero height and
      // slides into the screen edge; only the rest icon (if any) stays.
      return { w: compact.w === COMPACT_W ? NOTCH_W : compact.w, h: 0 };
    case "compact":
      return compact;
    case "expanded": {
      const base = view === "prompt" ? chatPromptHeight(chatCount) : VIEW_LAYOUTS[view].height;
      const h = fit > 0 ? Math.max(base, Math.min(MAX_ISLAND_H, Math.ceil(ISLAND_CHROME_H + fit))) : base;
      return { w: EXPANDED_W, h };
    }
  }
}

export interface BotPlacement {
  cx: number;
  cy: number;
  diameter: number;
  opacity: number;
}

/** IslandRootView.botPosition — cy is measured from the island's top edge. */
export function botPosition(
  mode: IslandMode,
  view: IslandViewName,
  islandH: number,
  uploadProgress = 0,
  compact: { w: number; h: number } = { w: COMPACT_W, h: NOTCH_H },
  /** The open island has its menu: the character sits at its head (diameter). */
  rail = 0,
): BotPlacement {
  const badge = compact.w !== COMPACT_W;
  switch (mode) {
    case "hidden":
      return badge
        ? { cx: compact.w / 2, cy: 0, diameter: 6, opacity: 0 }
        : { cx: 46, cy: 16, diameter: 6, opacity: 0 };
    case "compact":
      return badge
        ? { cx: compact.w / 2, cy: compact.h / 2, diameter: compact.w * 0.56, opacity: 1 }
        : { cx: 40, cy: 16, diameter: 20, opacity: 1 };
    case "expanded": {
      if (rail > 0) {
        // Top inset + top bar + gap, then the head of the menu (railHead).
        return { cx: 10 + RAIL_W / 2, cy: 8 + TOPBAR_H + BODY_GAP + railHead(rail) / 2, diameter: rail, opacity: 1 };
      }
      const layout = VIEW_LAYOUTS[view];
      if (view === "uploading") {
        return {
          cx: 36 + uploadProgress * 526,
          cy: layout.botY ?? 103,
          diameter: layout.botDiameter,
          opacity: 1,
        };
      }
      if (layout.botY != null) {
        return { cx: layout.botX, cy: layout.botY, diameter: layout.botDiameter, opacity: 1 };
      }
      // Centre of the fixed 84 pt card (8 pt top inset + 34 pt header → content at y = 42)
      const headerBottom = 42;
      const cardH = 84;
      const cy = headerBottom + (islandH - headerBottom - cardH) / 2 + cardH / 2;
      return { cx: layout.botX, cy, diameter: layout.botDiameter, opacity: 1 };
    }
  }
}

/** Height of the menu's head, where the character stands (with room for its badge and glow). */
export function railHead(diameter: number): number {
  return Math.round(diameter * 1.45);
}

export function botGlowColor(s: BotStateName): string {
  switch (s) {
    case "working":
      return "#3B9EFF";
    case "thinking":
      return "#A78BFA";
    case "searching":
      return "#6366F1";
    case "approval":
      return "#F5A524";
    case "error":
      return "#F4505E";
    case "finished":
      return "#34D399";
    case "ratelimit":
      return "#F59E0B";
    default:
      return "#FFFFFF";
  }
}

export function botGlowOpacity(s: BotStateName): number {
  switch (s) {
    case "idle":
    case "sleeping":
      return 0.15;
    case "dizzy":
      return 0;
    default:
      return 0.65;
  }
}

// Project colours (IslandConst.projectColors)
const PROJECT_COLORS: Record<string, string> = {
  korus: "#FF5A4E",
  "sbe hub": "#2EC4A0",
  "morning ai brief": "#F29B38",
  "publication ig": "#7C5CFF",
  "ig post": "#7C5CFF",
  "louisraille.fr": "#38BDF8",
  louisraille: "#38BDF8",
  "notch buddy": "#EC4899",
  "notch-buddy": "#EC4899",
  notchbuddy: "#EC4899",
};

const FALLBACK_COLORS = ["#22C55E", "#EAB308", "#60A5FA", "#E879F9"];

export function colorForProject(name: string): string {
  const key = name.toLowerCase().trim();
  const exact = PROJECT_COLORS[key];
  if (exact) return exact;
  for (const [k, c] of Object.entries(PROJECT_COLORS)) {
    if (key.startsWith(k) || key.includes(k)) return c;
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

// Card wash colours (CardBackground.washColor)
export type Wash = "red" | "green" | "pink" | "amber" | "cyan" | "indigo" | "soft" | null;

export function washRGBA(wash: Wash): string {
  switch (wash) {
    case "red":
      return "rgba(244,80,94,0.55)";
    case "green":
      return "rgba(52,211,153,0.5)";
    case "pink":
      return "rgba(244,114,182,0.55)";
    case "amber":
      return "rgba(245,165,36,0.42)";
    case "cyan":
      return "rgba(34,211,238,0.38)";
    case "indigo":
      return "rgba(99,102,241,0.5)";
    case "soft":
      return "rgba(255,255,255,0.08)";
    default:
      return "rgba(0,0,0,0)";
  }
}
