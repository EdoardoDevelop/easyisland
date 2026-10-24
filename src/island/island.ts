// The island: DOM shell, sizing animation, the character placement, mouse handling.
// Mirrors IslandRootView.swift + IslandWindowController.swift.

import { Tracked, Spring, clamp } from "../core/anim";
import { Bridge, IS_TAURI, onDragDrop, type WindowShot } from "../core/bridge";
import {
  BODY_GAP, EDGE_MARGIN, EXPANDED_CORNER, EXPANDED_W, ISLAND_CHROME_H, ISLAND_MIN_W, NOTCH_W, PANEL_H, PANEL_W,
  RAIL_GAP, RAIL_W, ROUNDED_CORNER, STRIP_H, VIEW_LAYOUTS, anchoredOrigin, botGlowColor, botGlowOpacity, botPosition,
  chatPromptHeight, collapsedBox, compactSize, cornerRadii, glueFor, isGlued, islandMax, islandSize, panelFor,
  type IslandMode, type IslandViewName, type Placement,
} from "../core/layout";
import type { Suggestion } from "./context";
import { buildSelectionMenu, type SelectionMenu } from "./selection-menu";
import { Sound } from "../core/sound";
import { OPENED_BY_APP, OPEN_URLS, State, canAskSession, isSessionTask } from "../core/state";
import { BotEngine, hexToRGB } from "../character/engine";
import { character, setCharacter } from "../character/character";
import { Greeting } from "../character/greeting";
import { createMiniBot, pruneMiniBots, syncMiniBotStates, tickMiniBots } from "../character/minibots";
import { UploadCanvas } from "../upload/canvas";
import { USC, UploadSeq } from "../upload/sequence";
import { buildHeader, buildViews, type ViewActions, type ViewHost } from "../views/views";
import { buildSearch, type SearchHost } from "../views/search";
import { rdmLookFor } from "../views/rdm";
import { buildRail, railBotSize } from "../views/rail";
import { buildStrip, type Strip } from "../views/strip";
import { closeMenu, showMenu, type MenuItem } from "../views/ctxmenu";
import { sendToChat, windowLabel } from "../views/chat";
import { capturing, startCapture } from "./capture";
import type { ApprovalInfo, Notice, QuickAction, Settings } from "../core/state";
import { h } from "../views/dom";
import { IslandStateMachine } from "./fsm";
import { locale, t } from "../core/i18n";
import { applyUiStyle, uiStyle, windowsLook } from "../core/uistyle";

const BOT_OVERHANG = 40;
/** The island's background in the Windows 11 look when the user kept the default black. */
const WINDOWS_ISLAND = "#1c1c1c";
/** Same margin as the Rust hit test (src-tauri/src/island.rs). */
const HIT_MARGIN = 14;
/** Around the island, a dragged file is still taken; same as DROP_MARGIN in island.rs. */
const DROP_MARGIN = 24;
/** Pause between two gestures of the compact the character when it does not follow the cursor, ms. */
const WANDER_MIN_MS = 1800;
const WANDER_SPREAD_MS = 4200;
/** Smallest change of gaze (lookX / lookY, −1…1) worth a new frame. */
const LOOK_EPS = 0.01;
/** Frame interval while the character only follows the cursor (nothing else moving), ms. */
const LOOK_FRAME_MS = 33;

/** Errors already written to the log: a broken card fails every frame, logged once. */
const reported = new Set<string>();

/**
 * Runs one part of a frame (a view's sync, the character's drawing…). An
 * exception is written to the log once and the rest of the frame goes on: one
 * card that cannot read its data used to stop the animation loop for good
 * (`running` stayed true, so nothing ever started it again) and froze the
 * whole island until a restart.
 */
function guard(part: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    const text = `${part}: ${(e as Error)?.stack ?? e}`;
    if (reported.has(text)) return;
    if (reported.size < 50) reported.add(text);
    console.error(text);
    void Bridge.log(`errore nell'isola · ${text}`).catch(() => {});
  }
}
/** Pointer travel (px) that turns a press on the compact island into a drag. */
const DRAG_THRESHOLD = 4;
/** The carried character, logical px (carry.rs draws it this big, a little below the pointer). */
const CARRY_SIZE = 56;
/** Least room for the character's bubble and the field in the top bar (measureHeader). */
const HEADER_MIN = 420;

/** The three views the drop sequence owns; leaving them stops the engine. */
/** Views drawn at a fixed size: the user's width and height do not apply. */
const FIXED_SIZE_VIEWS: ReadonlySet<IslandViewName> = new Set(["greeting", "upload", "uploading", "choose"]);
const UPLOAD_VIEWS: ReadonlySet<IslandViewName> = new Set(["upload", "uploading", "choose"]);

/**
 * Views worth going back to after a permission card. The drop sequence stops
 * when the card takes over, and the short-lived views have nothing left to say.
 */
const RETURNABLE = (v: IslandViewName) =>
  !UPLOAD_VIEWS.has(v) && v !== "greeting" && v !== "confused" && v !== "note";

/** Seconds between the drop and the moment the progress bar starts filling. */
const PRE_PROGRESS = USC.T_PROG_START - USC.T_DROP;

const modeOrder = (m: IslandMode) => (m === "hidden" ? 0 : m === "compact" ? 1 : 2);

export class Island {
  readonly fsm = new IslandStateMachine();

  private root: HTMLElement;
  private islandEl!: HTMLElement;
  private clipEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private viewsEl!: HTMLElement;
  /** The menu on the left of the open island (src/views/rail.ts), and the height it last needed. */
  private rail!: ViewHost;
  private railNeed = 0;
  /** Beside the compact island's character (src/views/strip.ts), its measured width and its hold. */
  private strip!: Strip;
  private stripW = 0;
  private stripHeld = false;
  private botCanvas!: HTMLCanvasElement;
  private botGlow!: HTMLElement;
  private greetingCanvas!: HTMLCanvasElement;
  private miniGrid!: HTMLElement;
  private countdown!: HTMLElement;
  private wakeStrip!: HTMLElement;
  /** What stays on screen while the island is hidden (the character or a dot). */
  private restIcon!: HTMLElement;
  /** Corner of the open island that sets its width and height. */
  private resizeGrip = h("div", { id: "island-resize", title: t("Trascina per cambiare larghezza e altezza · doppio clic: predefinite") });
  private restCanvas!: HTMLCanvasElement;
  private restDot!: HTMLElement;
  private restKey = "";

  private header!: ViewHost & { field: HTMLElement };
  private search!: SearchHost;
  /** Set while the user's own hover or click opens the island (openByUser). */
  private openedByUser = false;
  private views!: Map<IslandViewName, ViewHost>;
  private uploadCanvas!: UploadCanvas;

  private width = new Tracked(NOTCH_W);
  private height = new Tracked(0);
  private radius = new Tracked(ROUNDED_CORNER);
  private botCx = new Spring(46);
  private botCy = new Spring(16);
  private botSize = new Spring(10);

  private engine = new BotEngine();
  private greeting = new Greeting();

  private running = false;
  private lastFrame = 0;
  private dirty = true;
  private canvasPx = 0;

  // Rust starts the window at full size so the launch greeting has room.
  private collapsed = false;
  /** Where the compact the character looks while it does not follow the cursor. */
  private wanderLook = { x: 0, y: 0 };
  private wanderTimer: number | null = null;
  /** The gaze last drawn: cursor moves that do not change it skip the frame loop. */
  private drawnLook = { x: Infinity, y: Infinity };
  /** Left button held on the compact island: a click or the start of a drag. */
  /** A press that may become a drag of the whole island (`expanded`: started on the open island's header). */
  private press: { x: number; y: number; moved: boolean; expanded: boolean } | null = null;
  /**
   * A press on the character of the chat tab: carried onto another app's window,
   * it attaches that window to the chat (window_drop.rs). `busy`/`again`: one
   * lookup of the window under the cursor at a time, and one more after it if
   * the pointer moved meanwhile.
   */
  private windowPress: { x: number; y: number; moved: boolean; cancelled: boolean; busy: boolean; again: boolean } | null = null;
  /** While carried: where the character looks (the way it is moving), when its face was last sent, and whether one is on its way. */
  private pickLook = { x: 0, y: 0 };
  private pickCursorAt = 0;
  private pickSending = false;
  /** The browser preview has no carry.rs: the carried character is drawn in the page instead. */
  private carryEl: HTMLCanvasElement | null = null;
  private carryAt = { x: 0, y: 0 };
  /** The open island dragged off its place this opening, logical px (0 = still at that edge). */
  private openOffset = { x: 0, y: 0 };
  /** Carried around, until Rust has settled where it was dropped: rounded all round. */
  private carried = false;
  private collapseTimer: number | null = null;
  private wasInIsland = false;
  /** Last shape handed to Rust for the click-through test. */
  private pushedRect = { x: -1, y: -1, w: -1, h: -1 };
  /** The window the island is drawn in (logical px): 720×560, or bigger for a bigger island. */
  private panel = { w: PANEL_W, h: PANEL_H };
  /** The work area of the island's screen (logical px): how big the window may get. */
  private limits = { w: PANEL_W, h: PANEL_H };
  /** Open somewhere else than the character (`islandPlace`): the window is there. */
  private away = false;
  /** Where this opening is, while `away` (the greeting has its own place). */
  private awayPlace: Settings["islandPlace"] = "character";
  /** Launched without the greeting: the character shows up without a sound. */
  private quietLaunch = false;
  /** Closing from there: the island retracts in place, then the window goes home. */
  private awayClosing: number | null = null;
  private homeCollapseAt: number | null = null;
  /** Width of the views the top bar needs for its buttons, bubble and field (measureHeader). */
  private headerNeed = 0;
  /** Hovering the compact island for `openDelay` seconds opens it. */
  private hoverOpenTimer: number | null = null;

  // Bot hover → love (IslandWindowController.botHoverIn)
  private botHovering = false;
  private botHoverTimer: number | null = null;
  private lastLoveTime = 0;
  private botHoverStart = { x: 0, y: 0 };

  private confusedRecovery: number | null = null;
  private prevViewBeforeConfused: IslandViewName = "overview";
  /** 📌 on and open: the window is an ordinary app (Bridge.setAppMode). */
  private appMode = false;
  /** Opened from a shortcut: the island keeps the keyboard until it closes. */
  private keyboard = false;
  /** Where the island was before a permission card took it (rememberBeforeCard). */
  private beforeCard: { view: IslandViewName | null; focusId: string | null } | null = null;
  /** A zone just put in the tray: until then (ms), the island reopens on the tray. */
  private trayUntil = 0;
  private lastSyncedView: IslandViewName | null = null;
  /** Natural content height reported by the current view (0 = its fixed height). */
  private fit: { view: IslandViewName | null; h: number } = { view: null, h: 0 };

  /** Drop sequence bookkeeping: last tick played, and whether the ✓ has fired. */
  private uploadTens = 0;
  private uploadDone = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
    this.wireFsm();
    this.wireInput();
    this.engine.onDizzy = () => this.handleDizzy();
    this.greeting.onComplete = () => this.fsm.greetComplete();
    this.greeting.bare = true;
    // After the start-up greeting the island is compact: WebView2 may keep less memory.
    window.setTimeout(() => { if (State.mode !== "expanded") void Bridge.webviewMemoryLow(true); }, 15000);
    State.subscribe(() => {
      this.dirty = true;
      this.ensureRunning();
      // 📌 makes the open island an ordinary app window; unpinning, or closing
      // (which drops the pin), gives the usual island back.
      const app = ((State.keepOpen && !State.keptByItself) || !!State.settings.islandApp) && State.mode === "expanded";
      if (app !== this.appMode) {
        this.appMode = app;
        State.appWindow = app;
        // Over the taskbar or not changes the room it has (island_area).
        void Bridge.setAppMode(app).then(() => this.refreshLimits());
      }
      if (!app && State.maximized) {
        State.maximized = false;
        this.animateGeometry(false);
      }
    });
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────

  private build() {
    const actions: ViewActions = {
      setView: (v) => this.setView(v),
      collapse: () => this.collapse(),
      setFocus: (id) => {
        State.setFocus(id);
        Sound.play("blip");
      },
      openTerminal: () => {
        // Back to where the session runs: the Claude app, VS Code or the terminal.
        const task = State.focusTask;
        void Bridge.openSession(task?.sessionHost ?? null, task?.sessionCwd ?? null);
      },
      // The ↗ button — same targets as openAgentTarget() on macOS.
      openTarget: () => {
        const task = State.focusTask;
        if (!task) return;
        if (isSessionTask(task)) {
          // A session seen by the hooks goes back to its own app; otherwise VS Code.
          if (task.sessionHost) void Bridge.openSession(task.sessionHost, task.sessionCwd ?? null);
          else void Bridge.openInVSCode(task.sessionCwd ?? null);
        }
        else if (task.id === "integration_n8n") void Bridge.openN8n();
        else if (task.id === "integration_zammad") void Bridge.openZammad();
        else if (OPEN_URLS[task.id]) void Bridge.openUrl(OPEN_URLS[task.id]);
        else if (OPENED_BY_APP.has(task.id)) void Bridge.openIntegration(task.id);
      },
      openUrl: (url) => {
        if (url) void Bridge.openUrl(url);
      },
      decide: (d) => {
        const req = State.pendingApproval;
        void Bridge.log(`decide ${d} req=${req?.requestId ?? "none"}`);
        if (!req) return;
        Sound.play(d === "deny" ? "blip" : "approve");
        void Bridge.approvalDecision(req.requestId, d);
        this.settleApproval(req);
      },
      answerQuestions: (answers) => {
        const req = State.pendingApproval;
        if (!req) return;
        Sound.play("approve");
        void Bridge.approvalAnswers(req.requestId, answers);
        this.settleApproval(req);
      },
      handToTerminal: () => {
        const req = State.pendingApproval;
        if (!req) return;
        void Bridge.approvalDecline(req.requestId);
        this.settleApproval(req);
      },
      dismiss: () => {
        if (State.pendingApproval) actions.handToTerminal();
        this.collapse();
      },
      foldCard: () => this.foldCard(),
      holdOpen: (on) => this.setPinned(on),
      askSession: () => this.askSession(),
      toggleSound: () => {
        State.settings.soundEnabled = !State.settings.soundEnabled;
        Sound.setEnabled(State.settings.soundEnabled);
        void Bridge.saveSettings(State.settings);
        State.notify();
      },
      openSettingsWindow: () => void Bridge.openSettingsWindow(),
      blip: () => Sound.play("blip"),
      toggleKeepOpen: () => this.toggleKeepOpen(),
      toggleMaximized: () => this.toggleMaximized(),
      installUpdate: () => void this.installUpdate(),
      answerSuggestion: (fp, choice) => void this.answerSuggestion(fp, choice),
      runAction: (a) => void this.runAction(a),
      runSuggestion: (sg, app) => void this.runSuggestion(sg, app),
      extractZip: (place) => void this.extractZip(place),
      openFiles: () => void this.openFiles(),
      cancelDrop: () => this.cancelDrop(),
      refreshFiles: () => void this.refreshFiles(),
      askAboutFile: (f) => this.askAboutFile(f),
      captureScreen: () => void this.captureScreen(),
      reorder: (ids) => {
        State.reorder(ids);
        void Bridge.saveSettings(State.settings);
        State.notify();
      },
      askAboutPicture: (f) => this.askAboutPicture(f),
      askAboutText: (label, text) => this.startChat("", { label, text }, false),
      openChat: () => this.startChat("", null, false),
      askChat: (q) => this.askChat(q),
      showNotice: (n) => this.showNotice(n),
      explainError: (text, note) => this.explainError(text, note),
      confirmRun: () => void this.startScript(),
      killRun: () => {
        if (State.run?.status === "running") void Bridge.actionKill(State.run.runId);
      },
      closeRun: () => {
        State.run = null;
        State.isPinned = false;
        this.fsm.pinned = false;
        this.setView("actions");
      },
      applyRewrite: (text, plain) => void this.applyRewrite(text, plain),
      retryRewrite: () => void this.fetchRewrite(),
      closeRewrite: () => this.closeRewrite(),
    };

    this.wakeStrip = h("div", { id: "wake-strip" });
    this.restCanvas = h("canvas", {}) as HTMLCanvasElement;
    this.restDot = h("i", {});
    this.restIcon = h("div", { id: "rest-icon" }, this.restCanvas, this.restDot);
    this.botGlow = h("div", { id: "bot-glow" });
    this.botCanvas = h("canvas", { id: "bot-canvas" });
    this.greetingCanvas = h("canvas", { id: "greeting-canvas" });
    this.miniGrid = h("div", { id: "mini-grid" });
    this.countdown = h("div", { id: "countdown" });

    this.header = buildHeader(actions);
    this.views = buildViews(actions, () => this.animateGeometry(false));
    this.viewsEl = h("div", { id: "views" });
    for (const v of this.views.values()) this.viewsEl.append(v.el);
    this.search = buildSearch({
      openTask: (id) => {
        State.summary = false;
        State.setFocus(id);
        this.setView("overview");
      },
      runAction: (a) => void this.runAction(a),
      openProgram: (path) => {
        Sound.play("blip");
        void Bridge.actionOpenApp(path, "").then(() => this.collapse(), (e) => this.note(String(e), State.view));
      },
      ask: (text) => {
        Sound.play("blip");
        this.startChat(text, null, false);
      },
    });
    // The one field sits in the top bar; its results cover the views.
    this.header.field.append(this.search.el);
    this.rail = buildRail(actions);
    // A tab chosen while typing: the search ends, its words go.
    this.rail.el.addEventListener("click", () => this.search.close(), true);
    this.strip = buildStrip({
      decide: (d) => actions.decide(d),
      runAction: (a) => void this.runAction(a),
      runSuggestion: (s) => void this.runSuggestion(s, ""),
    });
    this.contentEl = h("div", { id: "content" }, this.header.el, h("div", { id: "body" }, this.rail.el, this.viewsEl));

    // The drop sequence draws the card, the bar and its own the character. It sits under
    // the header, which stays visible on top of it exactly as on macOS.
    this.uploadCanvas = new UploadCanvas({
      ask: () => {
        State.promptContext = State.droppedFile
          ? { kind: "file", name: State.droppedFile.name, path: State.droppedFile.path }
          : null;
        this.setView("prompt");
      },
      cancel: () => this.cancelDrop(),
      tray: () => void this.openFiles(),
      runAction: (a) => void this.runAction(a),
    });

    this.clipEl = h(
      "div",
      { id: "island-clip" },
      this.greetingCanvas,
      this.uploadCanvas.el,
      this.contentEl,
      this.strip.el,
    );
    this.islandEl = h(
      "div",
      { id: "island" },
      this.clipEl,
      this.botGlow,
      this.botCanvas,
      this.miniGrid,
      this.countdown,
      this.resizeGrip,
    );

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.greetingCanvas.width = Math.round(EXPANDED_W * dpr);
    this.greetingCanvas.height = Math.round(150 * dpr);
    this.greetingCanvas.style.width = `${EXPANDED_W}px`;
    this.greetingCanvas.style.height = "150px";

    this.root.append(this.wakeStrip, this.restIcon, this.islandEl);
    this.applyGeometry();
    this.watchScale();
  }

  /**
   * Moved to a display with another scale: the canvases were sized for the old
   * one, so the character came out too small or too big for its box until the
   * island was opened and closed. Redraw them, and once the drag is over let
   * Rust size the window for the new display.
   */
  private watchScale() {
    const dpr = window.devicePixelRatio;
    matchMedia(`(resolution: ${dpr}dppx)`).addEventListener("change", () => {
      void Bridge.log(`scale ${dpr} -> ${window.devicePixelRatio}`);
      this.canvasPx = 0;
      this.restKey = "";
      this.drawRestIcon();
      this.applyGeometry();
      State.notify();
      this.ensureRunning();
      if (!this.press?.moved) void Bridge.reposition();
      this.watchScale();
    }, { once: true });
  }

  // ── FSM ─────────────────────────────────────────────────────────────────────

  private wireFsm() {
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    // A pending request, or results of the search bar being looked through.
    this.fsm.waiting = () => State.pendingApproval != null || this.search.open || State.windowPick != null || this.windowPress != null
      // Typing in a Notion page of the card (notionpage.ts): it does not close under the caret.
      || !!(document.activeElement as HTMLElement | null)?.closest?.(".np-card [contenteditable='true'], .np-card input");
    this.fsm.held = () => this.strip.item?.urgent === true;
    this.fsm.onTransition = (from, to) => {
      switch (to) {
        case "hidden":
          this.setMode("hidden");
          break;
        case "petit":
          if (from === "greeting") this.greeting.interrupt();
          else if (from === "hidden" && !this.quietLaunch) Sound.play("peek");
          this.quietLaunch = false;
          this.setMode("compact");
          if (from === "greeting") State.view = State.defaultView();
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "home":
          this.expand(this.openingView());
          if (this.openedByUser) this.focusSearchSoon();
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "greeting":
          this.expand("greeting");
          this.greeting.start();
          break;
      }
      State.notify();
    };
  }

  launch() {
    if (State.settings.greeting === false) {
      this.quietLaunch = true;
      this.fsm.launchQuiet();
    } else {
      this.fsm.launch();
    }
  }

  // ── Mode / view ─────────────────────────────────────────────────────────────

  private setMode(mode: IslandMode) {
    const prev = State.mode;
    if (mode === prev) return;
    State.mode = mode;
    // Before the animation: an open island that was dragged away goes back to
    // the character's place, so it shrinks there and the next opening starts there.
    if (mode === "expanded" && prev !== "expanded") this.openAway();
    else if (prev === "expanded" && mode !== "expanded") this.closeAway();
    // Compact: WebView2 trims its memory; open: back to normal.
    if ((mode === "expanded") !== (prev === "expanded")) void Bridge.webviewMemoryLow(mode !== "expanded");
    if (mode === "expanded") {
      Sound.play("open");
      void this.refreshForeground();
    }
    if (prev === "expanded") {
      Sound.play("close");
      State.isPinned = false;
      // 📌 lasts for one opening: closing by hand (Esc, ✕) ends it.
      State.keepOpen = false;
      State.keptByItself = false;
      this.fsm.keepOpen = false;
      this.keyboard = false;
      void Bridge.focusWindow(false);
    }
    if (mode !== "expanded") {
      this.engine.resetMorph();
      // Nothing can be seen of the sequence once the island is shut, and leaving
      // it running would keep the frame loop awake — the island must cost
      // nothing while hidden.
      UploadSeq.deactivate();
    }
    this.applyBare();
    this.updateWindowCollapsed();
    this.animateGeometry(modeOrder(mode) < modeOrder(prev));
    this.scheduleWander();
    State.notify();
  }

  /** The open island always watches the cursor; the compact view only if asked to. */
  private followsCursor(): boolean {
    return State.mode === "expanded" || State.settings.followCursorCompact;
  }

  /**
   * Compact and not following the cursor: every few seconds, at random, the character
   * blinks, looks somewhere else, looks back or pulls a face — enough to feel
   * alive. Between two gestures the frame loop is stopped, so it costs nothing.
   */
  private scheduleWander() {
    if (this.wanderTimer != null) window.clearTimeout(this.wanderTimer);
    this.wanderTimer = null;
    if (State.mode !== "compact" || State.settings.followCursorCompact) {
      this.wanderLook = { x: 0, y: 0 };
      return;
    }
    this.wanderTimer = window.setTimeout(() => {
      this.wanderTimer = null;
      this.wander();
      this.scheduleWander();
    }, WANDER_MIN_MS + Math.random() * WANDER_SPREAD_MS);
  }

  private wander() {
    if (State.mode !== "compact" || State.settings.followCursorCompact || State.paused) return;
    const r = Math.random();
    if (r < 0.38) {
      // Look somewhere: the cube turns that way.
      this.wanderLook = { x: Math.random() * 1.8 - 0.9, y: Math.random() * 1.2 - 0.5 };
    } else if (r < 0.58) {
      this.wanderLook = { x: 0, y: 0 };
    } else if (r < 0.86) {
      this.engine.blink();
      if (Math.random() < 0.3) window.setTimeout(() => { this.engine.blink(); this.ensureRunning(); }, 260);
    } else if (State.effectiveState === "idle") {
      // A face now and then — only at rest, never over a state's own eyes.
      const faces = ["wink", "happy", "yawn", "surprised"] as const;
      this.engine.triggerEmote(faces[Math.floor(Math.random() * faces.length)]);
    } else {
      this.engine.blink();
    }
    this.ensureRunning();
  }

  /** True while the drop sequence owns the island body. */
  private get uploadActive(): boolean {
    return State.mode === "expanded" && UploadSeq.isActive && UPLOAD_VIEWS.has(State.view);
  }

  /**
   * The search bar under the views: on the open island, not in the chat (it has
   * its own field), the greeting or the drop sequence.
   */
  /**
   * How tall the open view's content is (its fitHeight), measured as if the
   * island had no room to spare (--extra-h at 0). Boxes that grow with the
   * spare room (the "ha finito" message, the plan, the lists) would otherwise
   * feed their grown height back into the island's: the spare room shrank,
   * the next measure was smaller, and the island flipped between two heights
   * at every update — at every letter typed in «Continua».
   */
  private measureFit(): number {
    const view = this.views.get(State.view);
    if (!view?.fitHeight) return 0;
    const extra = this.islandEl.style.getPropertyValue("--extra-h");
    this.islandEl.style.setProperty("--extra-h", "0px");
    const h = view.fitHeight();
    this.islandEl.style.setProperty("--extra-h", extra);
    return h;
  }

  private get searchShown(): boolean {
    return State.mode === "expanded" && State.settings.searchBar !== false
      && !FIXED_SIZE_VIEWS.has(State.view) && State.view !== "prompt" && !this.uploadActive;
  }

  /**
   * The open island has its menu on the left, the character at its head. Not
   * for the greeting and the drop sequence, drawn at their fixed size.
   */
  private get railShown(): boolean {
    return State.mode === "expanded" && !FIXED_SIZE_VIEWS.has(State.view) && !this.uploadActive;
  }

  /** What the menu adds to the island's width. */
  private get railRoom(): number {
    return this.railShown ? RAIL_W + RAIL_GAP : 0;
  }

  /** Navigating out of the drop flow ends the sequence, as on macOS. */
  private stopSequenceIfLeaving(view: IslandViewName) {
    if (UploadSeq.isActive && !UPLOAD_VIEWS.has(view)) UploadSeq.deactivate();
  }

  expand(view: IslandViewName) {
    this.stopSequenceIfLeaving(view);
    State.view = view;
    if (State.mode !== "expanded") this.setMode("expanded");
    else this.animateGeometry(false);
    State.lastActivity = performance.now();
    this.homeCollapseAt = null;
    State.notify();
  }

  setView(view: IslandViewName) {
    if (view === "actions") void this.refreshForeground();
    if (view !== "files") this.trayUntil = 0;
    this.stopSequenceIfLeaving(view);
    if (State.mode !== "expanded") {
      this.fsm.forceHome();
      State.view = view;
      this.animateGeometry(false);
      State.notify();
      return;
    }
    const grew = VIEW_LAYOUTS[view].height >= VIEW_LAYOUTS[State.view].height;
    State.view = view;
    State.lastActivity = performance.now();
    this.animateGeometry(!grew);
    State.notify();
  }

  /**
   * A Claude Code permission card is about to take the island: remember the view
   * and the pill it had, so answering goes back there.
   */
  rememberBeforeCard() {
    if (this.beforeCard) return; // already showing a card: keep the first place
    const onCard = State.view === "approval" || State.view === "ask";
    this.beforeCard = {
      view: State.mode === "expanded" && !onCard && RETURNABLE(State.view) ? State.view : null,
      focusId: State.focusId,
    };
  }

  /**
   * A pending request was answered, left to the terminal or given up by the
   * relay: unpin and go back to where the island was before the card.
   */
  settleApproval(req: ApprovalInfo) {
    const onCard = State.view === "approval" || State.view === "ask";
    const back = this.beforeCard;
    this.beforeCard = null;
    State.pendingApproval = null;
    State.isPinned = false;
    this.fsm.pinned = false;
    if (req.source === "chat") {
      // Back to the conversation, which is still waiting for its answer.
      if (onCard) this.setView("prompt");
      return;
    }
    const tid = req.taskId ?? "integration_claude";
    State.updateTask(tid, "working");
    State.setPillBadge(tid, null);
    if (back?.focusId && back.focusId !== State.focusId) State.setFocus(back.focusId);
    // Somebody navigated away from the card meanwhile: leave them where they are.
    if (onCard) this.setView(back?.view ?? State.defaultView());
  }

  /**
   * Closes the island. A permission request waiting for an answer is never
   * closed this way (only ✕ hands it to the terminal): the island goes back to
   * its card instead. `force` is for stepping aside on purpose (Cerchia e chiedi).
   */
  collapse(force = false) {
    closeMenu();
    const card = State.pendingCard();
    if (card && !force) {
      if (State.view !== card) this.setView(card);
      State.isPinned = true;
      this.fsm.pinned = true;
      return;
    }
    State.isPinned = false;
    this.fsm.pinned = false;
    // Drive the state machine rather than the mode: setting the mode behind its
    // back left it thinking the island was still open, and a click on the compact
    // island then did nothing — the island could never be reopened.
    this.fsm.forcePetit();
  }

  /**
   * "Più tardi" (or Esc) on a permission or a question: the island goes back to
   * the compact view without answering. The request keeps waiting (the agent
   * too, up to the relay's own limit) with a badge on its pill, and its card
   * is what the island opens on next (State.defaultView → pendingCard).
   */
  foldCard() {
    const req = State.pendingApproval;
    if (!req) return;
    State.setPillBadge(req.taskId ?? "integration_claude", "approval");
    Sound.play("blip");
    this.collapse(true);
  }

  /**
   * "Chiedi a questa sessione": the chat, asking a read-only copy of the
   * focused Claude Code session (claude_cli.rs → session_ask) instead of its engine.
   */
  askSession() {
    const task = State.focusTask;
    if (!canAskSession(task)) return;
    State.chatHistory = [];
    void Bridge.chatReset();
    State.chatText = null;
    State.chatWindow = null;
    State.droppedFile = null;
    State.promptContext = null;
    State.chatSession = { sessionId: task!.sessionId!, cwd: task!.sessionCwd!, name: task!.name, fork: null };
    this.setView("prompt");
  }

  /** Keeps the island open (or lets it close again on its own). */
  setPinned(on: boolean) {
    State.isPinned = on;
    this.fsm.pinned = on;
    // Unpinned with the mouse away: nothing else would start the auto-close.
    if (!on && !this.wasInIsland && this.fsm.state === "home") {
      this.fsm.mouseLeft();
      if (!State.keepOpen && !State.pendingApproval) {
        this.homeCollapseAt = performance.now() + State.settings.autoCloseInterval * 1000;
      }
    }
    State.notify();
  }

  /**
   * An alert that ended on its own (a call answered on the phone or by a
   * colleague): close at once, unless the mouse is on the island or 📌 is on.
   */
  endAlert() {
    this.setPinned(false);
    if (!this.wasInIsland && !State.keepOpen && this.fsm.state === "home") this.collapse();
  }

  /** Alert from the hook server: open on this view. Pinned alerts never auto-close. */
  alert(view: IslandViewName) {
    this.fsm.pinned = State.isPinned;
    this.fsm.forceHome();
    this.expand(view);
    // Pinned: the taskbar button flashes; stepped back behind a window: it comes forward.
    if (view === "approval" || view === "ask" || view === "question") void Bridge.flashIfBehind();
  }

  // ── Quick actions ─────────────────────────────────────────────────────────

  /** Shows a short message in the note view, then goes back to `back`. */
  private note(message: string, back: IslandViewName = "actions") {
    State.noteMessage = message;
    this.setView("note");
    Sound.play("error");
    // Long enough to read: longer messages stay longer.
    const ms = Math.min(7000, 2600 + Math.max(0, message.length - 60) * 40);
    window.setTimeout(() => {
      if (State.view === "note" && State.noteMessage === message) this.setView(back);
    }, ms);
  }

  /** Starts a fresh chat about `context` and asks `question` right away. */
  /** «Spiega e correggi» on a copied error: the chat with the error attached. */
  explainError(text: string, note: string) {
    State.moment = null;
    const context = { label: t("Errore copiato"), text: note ? `${text}

${note}` : text };
    this.startChat(t("Spiega questo errore e come correggerlo."), context, false);
  }

  /** A question from an automation (automations.rs, step "chat"): a new chat that sends it. */
  askChat(question: string) {
    this.startChat(question, null, false);
  }

  private startChat(question: string, context: { label: string; text: string } | null, keepFile: boolean) {
    State.chatHistory = [];
    State.chatSession = null;
    void Bridge.chatReset();
    State.chatText = context;
    State.chatWindow = null;
    if (!keepFile) {
      State.droppedFile = null;
      State.promptContext = null;
    }
    this.setView("prompt");
    if (question.trim()) window.setTimeout(() => sendToChat(question), 60);
  }

  /** Which app is in front, for the ⚡ suggestions (src/island/context.ts). */
  private async refreshForeground() {
    if (State.settings.contextActions === false) return;
    const fg = await Bridge.foregroundApp();
    // Opening the chat may focus the island itself: keep the last real app then.
    if (fg) {
      State.foreground = fg;
      State.notify();
    }
  }

  /** A suggestion: copy the selection in the app in front, then ask the chat (or rewrite it in place). */
  async runSuggestion(s: Suggestion, _app: string) {
    Sound.play("blip");
    if (s.replace) await this.rewriteSelection(s.label, s.prompt);
    else await this.askAboutSelection(s.prompt);
  }

  // ── The selection: its menu and "Sostituisci" ────────────────────────────

  /** The menu on the selected text, while it is up: what each entry does, and the text. */
  private selMenu: { menu: SelectionMenu; text: string } | null = null;

  /** Why the selection could not be read or replaced, for the user (context.rs reason codes). */
  private selectionProblem(code: string): string {
    switch (code) {
      case "empty": return t("Nessun testo selezionato: seleziona del testo nell'app e riprova.");
      case "not-text": return t("La selezione non è testo.");
      case "held": return t("Lascia i tasti della scorciatoia e riprova.");
      case "no-focus": return t("Windows non ha lasciato tornare all'app: riprova.");
      case "changed": return t("La selezione è cambiata e non ho sostituito niente: selezionala di nuovo o usa «Copia».");
      case "clipboard": return t("Gli appunti sono occupati da un'altra app: riprova.");
      default: return t("Non trovo l'app da cui veniva il testo: usa «Copia».");
    }
  }

  /** A short message, then the island closes again (it was opened for this). */
  private flashNote(message: string) {
    State.noteMessage = message;
    this.setView("note");
    Sound.play("error");
    window.setTimeout(() => {
      if (State.view === "note" && State.noteMessage === message) this.collapse();
    }, 3200);
  }

  /** The selection shortcut: copy the selected text, then the menu at the mouse. */
  private async openSelectionMenu() {
    const r = await Bridge.captureSelection();
    if (!("text" in r)) {
      this.flashNote(this.selectionProblem(r.error));
      return;
    }
    const menu = buildSelectionMenu(r.text);
    this.selMenu = { menu, text: r.text };
    await Bridge.selectionMenu(menu.entries);
  }

  /** An entry of the menu on the selection was clicked ("tray" event "sel:<id>"). */
  pickSelectionMenu(id: string) {
    const sel = this.selMenu;
    const pick = sel?.menu.picks.get(id);
    this.selMenu = null;
    if (!sel || !pick) return;
    if (pick === "settings") {
      void Bridge.openSettingsWindow();
      return;
    }
    if (pick === "notion-note" || pick === "notion-task") {
      void this.sendToNotion(pick, sel.text);
      return;
    }
    if (pick === "rdm-find") {
      rdmLookFor(sel.text);
      this.alert("overview");
      return;
    }
    if (pick === "rdm-rdp" || pick === "rdm-ssh") {
      Bridge.rdmQuick(pick === "rdm-rdp" ? "RDP" : "SSH", sel.text.trim()).catch((e) => this.flashNote(String(e).replace(/^Error:\s*/, "")));
      return;
    }
    Sound.resume();
    Sound.play("blip");
    if (pick.output === "replace") this.startRewrite(pick.name, pick.prompt, sel.text);
    else this.startChat(pick.prompt, { label: t("Testo selezionato"), text: sel.text }, false);
  }

  /** "Nota / Attività in Notion" on the selection: saved, a short note says where. */
  private async sendToNotion(kind: "notion-note" | "notion-task", text: string) {
    const c = State.settings.integrationConfig;
    try {
      if (kind === "notion-note") {
        const now = new Date();
        const stamp = `${now.toLocaleDateString(locale(), { day: "numeric", month: "short" })} ${now.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}`;
        const where = await Bridge.notionAddNote(text, stamp);
        this.flashNote(t("Salvata in «{p}» ✓", { p: where }));
      } else {
        // A task's title is one line: the first of the selection.
        const title = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? text.trim();
        await Bridge.notionAddTask(title.slice(0, 200), null);
        this.flashNote(t("Attività aggiunta in «{p}» ✓", { p: c.notionTasks?.title ?? "Notion" }));
      }
      Sound.play("approve");
    } catch (e) {
      this.flashNote(String(e).replace(/^Error:\s*/, ""));
    }
  }

  /** From the ⚡ tab or an action: copy the selection, then the rewrite card. */
  private async rewriteSelection(label: string, prompt: string) {
    const r = await Bridge.captureSelection();
    if ("text" in r) this.startRewrite(label, prompt, r.text);
    else this.note(this.selectionProblem(r.error));
  }

  /** The rewrite card: pinned (it waits for a click), then the answer comes in. */
  private startRewrite(label: string, prompt: string, original: string) {
    State.rewrite = {
      id: `w${Date.now().toString(36)}`, label: label || t("Riscrivi"), prompt, original,
      result: "", status: "loading", message: "",
    };
    State.isPinned = true;
    this.fsm.pinned = true;
    this.setView("rewrite");
    void this.fetchRewrite();
  }

  private async fetchRewrite() {
    const w = State.rewrite;
    if (!w) return;
    w.status = "loading";
    w.result = "";
    w.message = "";
    State.notify();
    try {
      const r = await Bridge.rewriteText(w.prompt, w.original);
      if (State.rewrite !== w) return;
      w.result = r.text;
      w.formatted = r.formatted;
      w.formattedText = r.formatted ? r.text : "";
      w.lost = r.lost;
      w.status = "ready";
      Sound.play("finish");
    } catch (err) {
      if (State.rewrite !== w) return;
      w.status = "error";
      w.message = String(err).replace(/^Error:\s*/, "");
      Sound.play("error");
    }
    State.notify();
  }

  /**
   * "Sostituisci": paste the new text over the selection, if it is still there,
   * with the selection's formatting unless `plain` ("Senza formattazione") or
   * the text was edited in the card.
   */
  private async applyRewrite(text: string, plain = false) {
    const w = State.rewrite;
    if (!w || w.status !== "ready" || !text.trim()) return;
    const formatted = !plain && !!w.formatted && text === w.formattedText;
    w.result = text;
    w.status = "replacing";
    w.message = "";
    State.notify();
    const why = await Bridge.replaceSelection(w.original, text, formatted);
    if (State.rewrite !== w) return;
    if (!why) {
      Sound.play("finish");
      this.closeRewrite();
      this.collapse();
      return;
    }
    w.status = "ready";
    w.message = this.selectionProblem(why);
    Sound.play("error");
    State.notify();
  }

  private closeRewrite() {
    State.rewrite = null;
    State.isPinned = false;
    this.fsm.pinned = false;
    if (State.view === "rewrite") this.collapse();
  }

  /**
   * The question about the text selected in whatever app is in front. With no
   * selection (or one that cannot be copied) the chat opens with the question
   * in its field, for the user to paste or type the text after it.
   */
  private async askAboutSelection(prompt: string) {
    const r = await Bridge.captureSelection();
    if ("text" in r) {
      this.startChat(prompt, { label: t("Testo selezionato"), text: r.text }, false);
      return;
    }
    this.draftChat(prompt);
  }

  /**
   * A folder dropped on the island, or the character dropped on one: the paths
   * are added to the chat field, after what is already written, and the
   * conversation goes on.
   */
  private pathToChat(paths: string[]) {
    Sound.play("blip");
    State.chatInsert = paths.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(" ");
    this.alert("prompt");
    void Bridge.focusWindow(true);
    window.setTimeout(() => this.views.get("prompt")?.focus?.(), 120);
  }

  // ── The character of the chat tab carried onto a window ─────────────────────

  /**
   * In the chat (the window goes to it), not while it answers nor when it asks a
   * session; and in File e schermo, where the window is chosen for Registra or
   * "Foto nel Vassoio".
   */
  private canPickWindow(): boolean {
    if (State.mode !== "expanded") return false;
    if (State.view === "files") return !State.paused;
    return State.view === "prompt" && !State.chatSession && State.stateOverride !== "thinking";
  }

  private startWindowPick() {
    // The island must not close while the pointer is away from it.
    this.fsm.pinned = true;
    State.windowPick = { over: "" };
    // Lifted: surprised, until it is over a window it can take.
    this.pickFace(false);
    this.engine.triggerEmote("surprised");
    this.pickLook = { x: 0, y: 0 };
    // The character leaves the island and follows the pointer in a window of
    // its own (carry.rs), its face sent by the frame loop: refreshPickCursor.
    this.islandEl.style.cursor = "grabbing";
    this.pickCursorAt = performance.now();
    void Bridge.windowPick(true).then(() => this.sendCarryFrame());
    this.botCanvas.style.visibility = "hidden";
    this.botGlow.style.visibility = "hidden";
    this.ensureRunning();
    Sound.play("blip");
    State.notify();
  }

  /** The face while carried: happy over a window it can take, surprised elsewhere. */
  private pickFace(overWindow: boolean) {
    const emote = overWindow ? "happy" : "surprised";
    if (this.engine.permanentEmote === emote) return;
    this.engine.setPermanentEmote(emote);
    if (overWindow) this.engine.triggerEmote("happy");
    this.ensureRunning();
  }

  /** The window under the pointer gets the character's face about 15 times a second. */
  private refreshPickCursor(nowMs: number) {
    if (nowMs - this.pickCursorAt < 66 || this.pickSending) return;
    this.pickCursorAt = nowMs;
    this.sendCarryFrame();
  }

  /** The window under the cursor, shown in the chat while the character is carried. */
  private askPickWindow(p: NonNullable<Island["windowPress"]>) {
    if (p.busy) {
      p.again = true;
      return;
    }
    p.busy = true;
    void Bridge.windowUnderCursor().then((w) => {
      p.busy = false;
      if (this.windowPress !== p || p.cancelled || !State.windowPick) return;
      const over = w ? windowLabel(w) : "";
      this.pickFace(!!w);
      if (State.windowPick.over !== over) {
        State.windowPick = { over };
        State.notify();
      }
      if (p.again) {
        p.again = false;
        this.askPickWindow(p);
      }
    });
  }

  /** Let go (`drop`) or given up: the character comes back, the window is captured. */
  private async endWindowPick(drop: boolean) {
    let shot: WindowShot | null = null;
    if (drop && State.view === "files") {
      // File e schermo: the window is only chosen; the panel offers what to do.
      const w = await Bridge.windowPickDrop();
      if (w) {
        State.pickedWindow = w;
        Sound.play("blip");
      }
    } else if (drop) {
      try {
        shot = await Bridge.windowDrop();
      } catch (err) {
        this.note(String(err).replace(/^Error:\s*/, ""), "prompt");
      }
    } else {
      void Bridge.windowPick(false);
    }
    State.windowPick = null;
    this.carryEl?.remove();
    this.carryEl = null;
    this.engine.setPermanentEmote(null);
    this.islandEl.style.cursor = "";
    this.botCanvas.style.visibility = "";
    this.botGlow.style.visibility = "";
    this.fsm.pinned = State.isPinned;
    if (shot) this.attachWindow(shot);
    else State.notify();
  }

  private placeCarry() {
    if (!this.carryEl) return;
    this.carryEl.style.left = `${this.carryAt.x - CARRY_SIZE / 2}px`;
    this.carryEl.style.top = `${this.carryAt.y - CARRY_SIZE * 0.3}px`;
  }

  /** The character's face, at its size on screen in physical pixels, for the window under the pointer (carry.rs). */
  private sendCarryFrame() {
    if (!State.windowPick || this.pickSending) return;
    const src = this.botCanvas;
    if (!src.width || !this.canvasPx) return;
    const size = Math.round(CARRY_SIZE * (window.devicePixelRatio || 1));
    if (!IS_TAURI) {
      this.carryEl ??= document.body.appendChild(h("canvas", { id: "carry-canvas" }) as HTMLCanvasElement);
      this.carryEl.width = this.carryEl.height = size;
      this.placeCarry();
      const g = this.carryEl.getContext("2d");
      g?.clearRect(0, 0, size, size);
      g?.drawImage(src, 0, BOT_OVERHANG * (src.width / this.canvasPx), src.width, src.width, 0, 0, size, size);
      return;
    }
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    // The body is the w × w square under the particles' overhang (drawBot).
    const dpr = src.width / this.canvasPx;
    const side = this.canvasPx * dpr;
    ctx.drawImage(src, 0, BOT_OVERHANG * dpr, side, side, 0, 0, size, size);
    const rgba = Array.from(ctx.getImageData(0, 0, size, size).data);
    this.pickSending = true;
    void Bridge.carryFrame(size, size, rgba).finally(() => { this.pickSending = false; });
  }

  /**
   * The window the character was dropped on: the chat is about it from the
   * first question. It goes with the first message only, so a conversation in
   * progress starts over (it stays in the history).
   */
  private attachWindow(w: WindowShot) {
    Sound.play("approve");
    if (State.chatHistory.length) {
      State.chatHistory = [];
      void Bridge.chatReset();
    }
    State.chatText = null;
    State.droppedFile = null;
    State.promptContext = null;
    State.chatWindow = w;
    this.engine.triggerEmote("love");
    void Bridge.focusWindow(true);
    State.notify();
    window.setTimeout(() => this.views.get("prompt")?.focus?.(), 120);
  }

  /** A fresh chat with `prompt` in its field, not sent: the text goes after it. */
  private draftChat(prompt: string) {
    const q = prompt.trim();
    this.startChat("", null, false);
    State.chatDraft = q ? `${q.replace(/[:.]$/, "")}: ` : "";
    State.notify();
  }

  /** "Estrai…" on a dropped ZIP: list what is inside, then wait for a destination. */
  private async openUnzip() {
    const file = State.droppedFile;
    if (!file) return;
    State.unzip = { info: null, status: "loading", message: "" };
    this.setView("unzip");
    try {
      const info = await Bridge.zipList(file.path);
      if (State.unzip) State.unzip = { info, status: "ready", message: "" };
    } catch (err) {
      if (State.unzip) State.unzip = { info: null, status: "error", message: String(err).replace(/^Error:\s*/, "") };
      Sound.play("error");
    }
    State.notify();
  }

  /** The tray ("Vassoio"): list the inbox and show it. */
  async openFiles() {
    State.inbox = await Bridge.inboxList() ?? [];
    this.setView("files");
  }

  async refreshFiles() {
    State.inbox = await Bridge.inboxList() ?? [];
    State.notify();
  }

  /** "Chiedi" on a file of the history: the same as dropping it again, without the copy. */
  askAboutFile(f: { name: string; path: string }) {
    State.droppedFile = { name: f.name, path: f.path };
    State.promptContext = { kind: "file", name: f.name, path: f.path };
    State.chatText = null;
    State.chatWindow = null;
    State.chatHistory = [];
    void Bridge.chatReset();
    this.setView("choose");
  }

  /**
   * "Cerchia e chiedi" (scheda + or its shortcut, src/island/capture.ts): the
   * island steps aside, the screen freezes under the island's own window, and the
   * zone circled goes to the chat, a quick action, the clipboard or the tray.
   */
  async captureScreen() {
    if (capturing()) return;
    Sound.play("blip");
    if (State.mode === "expanded") {
      this.collapse(true);
      // Out of the picture before the screen freezes.
      await new Promise((r) => window.setTimeout(r, 380));
    }
    await startCapture({
      ask: (file, question) => {
        Sound.play("approve");
        this.askAboutPicture(file);
        if (question) window.setTimeout(() => sendToChat(question), 60);
      },
      done: (message) => {
        Sound.play("approve");
        void this.refreshFiles();
        State.noteMessage = message;
        this.setView("note");
        window.setTimeout(() => {
          if (State.view === "note" && State.noteMessage === message) this.collapse();
        }, 2200);
      },
      tray: (file) => {
        Sound.play("approve");
        State.trayFresh = { name: file.name, until: Date.now() + 5 * 60_000 };
        // Open on the tray, and reopen there if it closes before anything else is opened.
        void this.openFiles().then(() => { this.trayUntil = performance.now() + 5 * 60_000; });
      },
      failed: (message) => this.note(message, State.defaultView()),
    });
  }

  /** Where a reopening lands: a waiting request, the tray just filled, or the usual place. */
  private openingView(): IslandViewName {
    const tray = performance.now() < this.trayUntil;
    this.trayUntil = 0;
    return State.pendingCard() ?? (tray ? "files" : State.defaultView());
  }

  /** A picture already in the inbox goes straight to the chat, ready for the question. */
  askAboutPicture(f: { name: string; path: string }) {
    State.droppedFile = { name: f.name, path: f.path };
    State.promptContext = { kind: "file", name: f.name, path: f.path };
    State.chatText = null;
    State.chatWindow = null;
    State.chatHistory = [];
    void Bridge.chatReset();
    this.setView("prompt");
  }

  async extractZip(place: string) {
    const file = State.droppedFile;
    const u = State.unzip;
    if (!file || !u || u.status === "working") return;
    u.status = "working";
    State.isPinned = true;
    this.fsm.pinned = true;
    State.notify();
    try {
      const dest = await Bridge.zipExtract(file.path, file.name, place, file.source ?? null);
      u.status = "done";
      u.message = dest;
      Sound.play("finish");
    } catch (err) {
      u.status = "error";
      u.message = String(err).replace(/^Error:\s*/, "");
      Sound.play("error");
    }
    State.isPinned = false;
    this.fsm.pinned = false;
    State.notify();
  }

  /** Crea / Non ora / No, mai on a proposal from the habits. */
  async answerSuggestion(fp: string, choice: "create" | "snooze" | "dismiss") {
    try {
      const msg = await Bridge.habitAnswer(fp, choice);
      State.notice = { title: msg, text: "", level: choice === "create" ? "ok" : "info", url: "" };
      Sound.play(choice === "create" ? "finish" : "blip");
    } catch (e) {
      State.notice = { title: String(e).replace(/^Error:\s*/, ""), text: "", level: "error", url: "" };
    }
    State.notify();
    window.setTimeout(() => {
      if (State.view === "notify" && !State.notice?.suggestion) this.collapse();
    }, 3000);
  }

  async runAction(a: QuickAction) {
    if (!a.id.startsWith("builtin:")) void Bridge.habitNoteQuick(a.id);
    if (a.id === "builtin:unzip") {
      Sound.play("blip");
      await this.openUnzip();
      return;
    }
    Sound.play("blip");
    try {
      switch (a.kind) {
        case "url":
          if (!/^https?:\/\//i.test(a.target.trim())) {
            this.note(t("Il link deve iniziare con http:// o https://"));
            return;
          }
          await Bridge.openUrl(a.target.trim());
          this.collapse();
          break;
        case "app":
          await Bridge.actionOpenApp(a.target, a.args);
          this.collapse();
          break;
        case "keys":
          // Back to the program first: the keys go to the window that was in front.
          if (State.mode === "expanded" && !State.keepOpen) this.collapse();
          await Bridge.actionSendKeys(a.keys ?? "");
          break;
        case "script":
          State.run = {
            action: a, runId: `r${Date.now().toString(36)}`, status: "confirm",
            output: "", code: null, timedOut: false,
          };
          State.isPinned = true;
          this.fsm.pinned = true;
          this.setView("run");
          if (!a.confirm) await this.startScript();
          break;
        case "prompt": {
          if (a.input === "file") {
            if (!State.droppedFile) {
              this.note(t("Rilascia prima un file sull'isola, poi scegli l'azione."));
              return;
            }
            this.startChat(a.prompt, null, true);
            return;
          }
          if (a.input === "selection") {
            if (a.output === "replace") await this.rewriteSelection(a.name, a.prompt);
            else await this.askAboutSelection(a.prompt);
            return;
          }
          if (a.input === "page") {
            const r = await Bridge.captureWindowText();
            if (!("text" in r)) {
              this.note(this.selectionProblem(r.error));
              return;
            }
            this.startChat(a.prompt, { label: t("Testo della finestra"), text: r.text }, false);
            return;
          }
          let context: { label: string; text: string } | null = null;
          if (a.input === "clipboard") {
            const text = await Bridge.clipboardText();
            if (!text) {
              this.draftChat(a.prompt);
              return;
            }
            context = { label: t("Testo copiato"), text };
          }
          this.startChat(a.prompt, context, false);
          break;
        }
      }
    } catch (err) {
      this.note(String(err).replace(/^Error:\s*/, ""));
    }
  }

  private async startScript() {
    const run = State.run;
    if (!run || run.status === "running") return;
    run.status = "running";
    State.notify();
    try {
      const res = await Bridge.actionRunScript(run.runId, run.action.shell, run.action.script);
      if (State.run?.runId !== run.runId) return;
      run.status = "done";
      run.output = res.output;
      run.code = res.code;
      run.timedOut = res.timedOut;
      Sound.play(res.timedOut || (res.code ?? 0) !== 0 ? "error" : "finish");
    } catch (err) {
      if (State.run?.runId !== run.runId) return;
      run.status = "error";
      run.output = String(err).replace(/^Error:\s*/, "");
      Sound.play("error");
    }
    State.isPinned = false;
    this.fsm.pinned = false;
    State.notify();
  }

  /** A global shortcut was pressed (from src-tauri/src/hotkeys.rs). */
  async onHotkey(name: string) {
    Sound.resume();
    if (name === "open") {
      // Pressed again with the island open: it closes (a waiting request stays, see collapse).
      if (State.mode === "expanded") {
        this.collapse();
        return;
      }
      // The Panoramica, as the ⌂ tab; a request waiting for an answer comes first.
      State.summary = true;
      this.setView(State.pendingCard() ?? "overview");
    } else if (name === "ask") {
      const text = await Bridge.clipboardText();
      // A picture copied (and no text): attach it instead.
      const picture = text ? null : await Bridge.clipboardPicture();
      if (picture) this.askAboutPicture(picture);
      else this.startChat("", text ? { label: t("Testo copiato"), text } : null, false);
    } else if (name === "screenshot") {
      await this.captureScreen();
    } else if (name === "clipboard") {
      if (!State.settings.activeIntegrations.includes("integration_clipboard")) return;
      State.setFocus("integration_clipboard");
      this.setView("overview");
    } else if (name === "pending") {
      const card = State.pendingCard();
      if (!card) {
        State.noteMessage = t("Nessuna richiesta in attesa.");
        this.setView("note");
        window.setTimeout(() => { if (State.view === "note") this.setView(State.defaultView()); }, 1800);
        return;
      }
      this.alert(card);
    } else if (name === "session") {
      this.openSessionApp();
      return;
    } else if (name === "nextPill") {
      if (State.mode !== "expanded") this.setView("overview");
      this.cycleFocus(1);
    } else if (name === "selectionMenu") {
      await this.openSelectionMenu();
      return;
    } else if (name === "mute") {
      State.settings.soundEnabled = !State.settings.soundEnabled;
      Sound.setEnabled(State.settings.soundEnabled);
      if (State.settings.soundEnabled) Sound.play("blip");
      void Bridge.saveSettings(State.settings);
      State.notify();
      return;
    } else if (name.startsWith("action:")) {
      const a = (State.settings.actions ?? []).find((x) => x.id === name.slice(7));
      if (a) await this.runAction(a);
      return;
    }
    // Opened from the keyboard: the island takes the keys until it closes
    // (N / Y / S on a card, arrows, Ctrl+N, Ctrl+P — see onIslandKey).
    if (State.mode === "expanded" && (name === "open" || name === "pending" || name === "nextPill")) {
      this.keyboard = true;
      void Bridge.focusWindow(true);
      if (name === "open") this.focusSearchSoon();
    }
  }

  /** The app the Claude Code session runs in (terminal, VS Code, Cursor, Claude). */
  openSessionApp() {
    const t = isSessionTask(State.focusTask) ? State.focusTask : State.latestSessionTask;
    if (t?.sessionHost) void Bridge.openSession(t.sessionHost, t.sessionCwd ?? null);
    else void Bridge.openInVSCode(t?.sessionCwd ?? null);
  }

  /** ← / → in the overview, or the "next pill" shortcut: focus the next pill. */
  cycleFocus(dir: 1 | -1) {
    const list = State.tasks;
    if (list.length < 2) return;
    const i = list.findIndex((t) => t.id === State.focusId);
    const next = list[(i + dir + list.length) % list.length];
    State.setFocus(next.id);
    Sound.play("blip");
    if (State.view !== "overview") this.setView("overview");
    State.notify();
  }

  /**
   * Keys inside the open island (only when it has the keyboard: the chat, or
   * opened by a shortcut). Buttons with `data-key` in the view on screen answer
   * to that key (N / Y / S on a permission, 1–9 on a question); ← → move between
   * pills, ↑ ↓ scroll the view's list; Ctrl+N new chat, Ctrl+P keep open.
   */
  private onIslandKey(e: KeyboardEvent) {
    if (State.mode !== "expanded") return;
    const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']");
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (ctrl && !e.altKey && key === "n") {
      e.preventDefault(); // WebView2 would open a new window
      this.startChat("", null, false);
      return;
    }
    if (ctrl && !e.altKey && key === "p") {
      e.preventDefault(); // …or the print dialog
      this.toggleKeepOpen();
      return;
    }
    if (typing || ctrl || e.altKey || e.repeat) return;
    const button = this.viewsEl.querySelector<HTMLElement>(`.view.on [data-key="${CSS.escape(key)}"]`);
    if (button) {
      e.preventDefault();
      button.click();
      return;
    }
    if (State.view === "overview" && (key === "ArrowLeft" || key === "ArrowRight")) {
      e.preventDefault();
      this.cycleFocus(key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (key === "ArrowUp" || key === "ArrowDown") {
      const view = this.viewsEl.querySelector<HTMLElement>(".view.on");
      const list = [...(view?.querySelectorAll<HTMLElement>("*") ?? [])].find(
        (n) => n.scrollHeight > n.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(n).overflowY));
      if (list) {
        e.preventDefault();
        list.scrollBy({ top: key === "ArrowDown" ? 48 : -48, behavior: "smooth" });
      }
    }
  }

  reveal() {
    // Over a full-screen app, or in front of a client, only real alerts may show up.
    if (State.quiet) return;
    // Routine activity only surfaces when the profile wants everything.
    if (State.settings.notify !== "all") return;
    this.fsm.reveal();
  }

  /**
   * "Davanti al cliente" (src-tauri/src/presence.rs): a call, someone on this
   * PC from afar, or the tray switch. Sounds stop in any case; with "hide" the
   * compact the character goes away too. An open card waiting for an answer stays.
   */
  setPresence(active: boolean, reason: string) {
    State.presence = { active, reason };
    Sound.suppressed = active;
    if (State.quiet && State.mode !== "hidden" && !State.isPinned && !State.pendingApproval) this.fsm.forceHidden();
    if (!State.quiet) this.keepCompactUp();
    State.notify();
  }

  /** A message from `easyisland-hook notify` (any script, task or flow). */
  showNotice(n: Notice) {
    const important = n.level === "error" || n.level === "warn";
    // Same rules as everything else: in front of a client or over a full-screen
    // app only problems may show, and "solo permessi" means just that.
    if (State.settings.notify === "permissions") return;
    if (State.settings.notify === "alerts" && !important) return;
    if (State.quiet && !important) return;
    State.notice = n;
    Sound.play(n.level === "error" ? "error" : n.level === "warn" ? "question" : n.level === "ok" ? "finish" : "blip");
    if (State.quiet) return; // a problem in front of a client: the sound is off anyway, no card either
    this.alert("notify");
  }

  /** A newer version is on GitHub: offer it, never install on our own. */
  showUpdate(version: string, current: string) {
    this.showNotice({
      title: t("EasyIsland {version} è disponibile", { version }),
      text: t("Ora hai la {current}. Installando, l'app si chiude e si riapre da sola.", { current }),
      level: "info",
      url: "",
      install: version,
    });
  }

  private async installUpdate() {
    State.noteMessage = t("Scarico l'aggiornamento…");

    this.setView("note");
    try {
      await Bridge.updateInstall();
    } catch (err) {
      this.note(String(err).replace(/^Error:\s*/, ""), State.defaultView());
    }
  }

  /** Rust reports a full-screen app coming or going. */
  setFullscreen(on: boolean) {
    State.fullscreen = on;
    if (State.quiet && State.mode === "compact") this.fsm.forceHidden();
    if (!State.quiet) this.keepCompactUp();
    State.notify();
  }

  /** 📌 in the header. */
  /**
   * The right-click menu for `el`: an integration or an agent (menu, Panoramica,
   * its card), a quick action, the selected text, a reply of the chat; then the
   * island's own entries. Only things a click can do anyway: nothing deletes,
   * sends or runs a command without its usual confirmation.
   */
  private contextItems(el: HTMLElement | null): { title: string; items: MenuItem[] } {
    const items: MenuItem[] = [];
    let title = "";
    const settingsAt = (page: string, item = "") => () => void Bridge.openSettingsAt(page, item);

    // Selected text in the island: copy it, or ask about it.
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (sel && el && this.islandEl.contains(el)) {
      title = t("Testo selezionato");
      items.push(
        { label: t("Copia"), run: () => void Bridge.copyRewrite(sel, false) },
        { label: t("Chiedi alla chat"), run: () => this.startChat("", { label: t("Testo selezionato"), text: sel }, false) },
      );
    }

    // An integration, a widget or an agent: a row of the menu, a tile, its open card.
    const rail = el?.closest<HTMLElement>("[data-rail]")?.dataset.rail ?? "";
    let id = el?.closest<HTMLElement>("[data-id]")?.dataset.id ?? "";
    if (!id && !items.length && el?.closest(".view") && State.view === "overview" && !State.showsSummary) id = State.focusTask?.id ?? "";
    if (!id && rail === "agenti") id = State.latestSessionTask?.id ?? "";
    const task = id ? State.tasks.find((x) => x.id === id) ?? null : null;
    if (task && !items.length) {
      const session = isSessionTask(task);
      title = session ? task.agentName ?? task.name : task.name;
      items.push({ label: t("Apri"), run: () => { State.setFocus(task.id); this.setView("overview"); } });
      if (session) {
        if (task.sessionHost || task.sessionCwd) {
          items.push({ label: t("Torna alla sessione"), run: () => void Bridge.openSession(task.sessionHost ?? null, task.sessionCwd ?? null) });
        }
        if (task.sessionCwd) items.push({ label: t("Apri la cartella"), run: () => void Bridge.actionOpenApp(task.sessionCwd!, "") });
        items.push({ label: t("Impostazioni degli agenti"), sep: true, run: settingsAt("claude") });
      } else if (task.id.startsWith("widget:")) {
        const wid = task.id.slice("widget:".length);
        items.push({ label: t("Aggiorna ora"), run: () => void Bridge.widgetRefresh(wid) });
        items.push({ label: t("Impostazioni «{name}»", { name: task.name }), sep: true, run: settingsAt("widget", wid) });
      } else {
        items.push({ label: t("Aggiorna ora"), run: () => void Bridge.refreshIntegration(task.id) });
        items.push({ label: t("Impostazioni «{name}»", { name: task.name }), sep: true, run: settingsAt("integrazioni", task.id) });
      }
    }

    // A quick action.
    const actionId = el?.closest<HTMLElement>("[data-action]")?.dataset.action ?? "";
    const action = actionId ? (State.settings.actions ?? []).find((a) => a.id === actionId) : undefined;
    if (action && !items.length) {
      title = action.name || t("Azione");
      items.push(
        { label: t("Esegui"), run: () => void this.runAction(action) },
        { label: t("Modifica «{name}»", { name: action.name || t("Senza nome") }), run: settingsAt("azioni", action.id) },
      );
    }

    // A reply of the chat: all of it.
    const reply = el?.closest<HTMLElement>(".chat-row .reply, .chat-row .bubble");
    if (reply && !items.length) {
      const text = reply.innerText.trim();
      title = t("Messaggio");
      items.push({ label: t("Copia il messaggio"), run: () => void Bridge.copyRewrite(text, false) });
    }

    // The fixed rows of the menu: where their settings are.
    if (!items.length && rail) {
      const pages: Record<string, [string, string]> = {
        chat: ["chat", t("Impostazioni della chat")],
        azioni: ["azioni", t("Impostazioni delle azioni rapide")],
      };
      const p = pages[rail];
      if (p) items.push({ label: p[1], run: settingsAt(p[0]) });
    }
    if (!items.length && State.view === "prompt") items.push({ label: t("Impostazioni della chat"), run: settingsAt("chat") });
    if (!items.length && State.view === "actions") items.push({ label: t("Impostazioni delle azioni rapide"), run: settingsAt("azioni") });

    // Always: the island itself.
    const first = items.length > 0;
    items.push(
      { label: State.keepOpen ? t("Lascia chiudere da sola") : t("Tieni aperta"), sep: first, run: () => this.toggleKeepOpen() },
      { label: t("Panoramica"), run: () => { State.summary = true; this.setView("overview"); } },
      { label: t("Impostazioni…"), run: () => void Bridge.openSettingsWindow() },
      { label: t("Chiudi l'isola"), run: () => this.collapse() },
    );
    return { title, items };
  }

  toggleKeepOpen() {
    State.keptByItself = false;
    State.keepOpen = !State.keepOpen;
    this.fsm.setKeepOpen(State.keepOpen, this.wasInIsland);
    if (State.keepOpen) this.homeCollapseAt = null;
    else if (!this.wasInIsland) this.homeCollapseAt = performance.now() + State.settings.autoCloseInterval * 1000;
    State.notify();
  }

  // ── File drop ───────────────────────────────────────────────────────────────

  /** One line for the log: where the island and the drop sequence stand. */
  private dropState(): string {
    return `mode ${State.mode}, view ${State.view}, fsm ${this.fsm.state}, ` +
      `seq ${UploadSeq.isActive ? (UploadSeq.dropped ? "dropped" : "active") : "off"}, ` +
      `frames ${this.running ? "running" : "stopped"}, paused ${State.paused}, quiet ${State.quiet}, ` +
      `page ${document.visibilityState}`;
  }

  /** What the island was before a dragged file opened it, to go back to when nothing is dropped. */
  private beforeDrop: { mode: IslandMode; view: IslandViewName } | null = null;
  private dragEndPoll: number | null = null;

  /**
   * The file left the island: once the drag is over (the button is released
   * somewhere else) and it did not come back, the drop view goes and the island
   * is as it was. Asked a few times a second, only for this short while.
   */
  private watchDragEnd() {
    if (this.dragEndPoll != null) return;
    this.dragEndPoll = window.setInterval(async () => {
      if (State.fileDragOver) {
        // Back over the island: its own leave will start watching again.
        window.clearInterval(this.dragEndPoll!);
        this.dragEndPoll = null;
        return;
      }
      if (await Bridge.mouseButtonDown()) return;
      window.clearInterval(this.dragEndPoll!);
      this.dragEndPoll = null;
      this.restoreAfterDrag();
    }, 200);
  }

  /** Nothing was dropped: back to how the island was before the file arrived. */
  private restoreAfterDrag() {
    const before = this.beforeDrop;
    this.beforeDrop = null;
    if (!before || State.fileDragOver || State.view !== "upload") return;
    this.engine.animateMorph(0);
    if (before.mode !== "expanded") this.collapse();
    else this.setView(UPLOAD_VIEWS.has(before.view) ? State.defaultView() : before.view);
  }

  private onDragDrop(e: { type: string; paths?: string[] }) {
    if (e.type !== "over") void Bridge.log(`drag ${e.type} ${e.paths?.length ?? 0} file(s), ${this.dropState()}`);
    if (State.paused) return;
    switch (e.type) {
      case "enter":
      case "over": {
        if (State.fileDragOver) return;
        if (!this.beforeDrop) this.beforeDrop = { mode: State.mode, view: State.view };
        State.fileDragOver = true;
        this.engine.animateMorph(1);
        // Open first, then start the sequence. A compact island opens through
        // the state machine, which passes by the default view on the way, and
        // leaving the drop views stops the sequence: started first, it was
        // switched off at once, the character never followed the file and the bar
        // stayed at 0 %. Both run in this same task, so the next frame already
        // sees the sequence active on `upload`.
        this.alert("upload");
        UploadSeq.enterZone(State.mouseInIsland.x, State.mouseInIsland.y);
        break;
      }
      case "leave": {
        if (!State.fileDragOver) return;
        State.fileDragOver = false;
        this.engine.animateMorph(0);
        // The island stays open while the drag goes on (the file may come
        // back); when it ends somewhere else, watchDragEnd puts it back.
        UploadSeq.exitZone();
        this.watchDragEnd();
        State.notify();
        break;
      }
      case "drop": {
        State.fileDragOver = false;
        const path = e.paths?.[0];
        if (!path) {
          // Refused or empty: back to how the island was.
          this.engine.animateMorph(0);
          if (this.beforeDrop) this.restoreAfterDrag();
          else this.setView(State.defaultView());
          return;
        }
        void Bridge.isFolder(path).then((folder) => {
          // Into a conversation going on: the file joins it (sent with the
          // next question) instead of starting a new one.
          const before = this.beforeDrop;
          if (!folder && before?.view === "prompt" && before.mode === "expanded" && State.chatHistory.length > 0 && !State.chatSession) {
            this.restoreAfterDrag();
            void Bridge.ingestFile(path)
              .then((f) => {
                State.chatAttach = { name: f.name, path: f.path };
                Sound.play("approve");
                State.notify();
              })
              .catch((err) => {
                State.noteMessage = String(err).replace(/^Error:\s*/, "");
                this.setView("note");
              });
            return;
          }
          if (!folder) {
            this.beforeDrop = null;
            this.swallow(path);
            return;
          }
          // A folder (it cannot be dropped as a file): every dropped path goes
          // to the chat field instead.
          this.beforeDrop = null;
          this.engine.animateMorph(0);
          this.pathToChat(e.paths!);
        });
        break;
      }
    }
  }

  /**
   * The character eats the file. Nothing here waits on the file system: the copy into
   * the inbox runs in the background and swaps the path in when it lands, so a
   * slow disk can never stall the animation — same as FileDropHandler on macOS.
   */
  private swallow(path: string) {
    const seq = ++this.dropSeq;
    const name = path.split(/[\\/]/).pop() || "file";
    State.droppedFile = { name, path, source: path };
    State.promptContext = { kind: "file", name, path };
    State.chatText = null;
    State.chatWindow = null;
    State.chatHistory = [];
    void Bridge.chatReset();

    UploadSeq.performDrop(State.uploadDuration);
    this.uploadTens = 0;
    this.uploadDone = false;

    this.engine.gulp();
    Sound.play("approve");
    this.engine.triggerEmote("happy");
    this.engine.animateMorph(0);

    State.uploadProgress = 0;
    this.setView("uploading");
    this.ensureRunning();
    // A stalled frame loop leaves the bar at 0 % with nothing in the log: say so.
    window.setTimeout(() => {
      void Bridge.log(`drop: after 1.5 s progress ${Math.round(State.uploadProgress * 100)} %, ${this.dropState()}`);
    }, 1500);

    void Bridge.ingestFile(path)
      .then((file) => {
        // "Annulla" pressed before the copy landed: the copy goes too.
        if (seq !== this.dropSeq) {
          void Bridge.inboxDelete(file.name).catch(() => {});
          return;
        }
        State.droppedFile = { name: file.name, path: file.path, source: path };
        State.promptContext = { kind: "file", name: file.name, path: file.path };
        // "Vassoio" pressed before the copy landed: list it now.
        if (State.view === "files") void this.refreshFiles();
        State.notify();
      })
      .catch((err) => {
        if (seq !== this.dropSeq) return;
        UploadSeq.deactivate();
        State.noteMessage = String(err).replace(/^Error:\s*/, "");
        this.engine.animateMorph(0);
        this.setView("note");
        Sound.play("error");
        window.setTimeout(() => this.setView(State.defaultView()), 2400);
      });
  }

  /** Bumped by every drop and by "Annulla": a copy that lands later is dropped. */
  private dropSeq = 0;

  /** "Annulla" on a dropped file: forget it (its copy leaves the tray) and go back. */
  private cancelDrop() {
    const f = State.droppedFile;
    this.dropSeq++;
    UploadSeq.deactivate();
    this.engine.animateMorph(0);
    if (f && f.path !== f.source) void Bridge.inboxDelete(f.name).catch(() => {});
    State.droppedFile = null;
    State.promptContext = null;
    this.setView(State.defaultView());
  }

  /**
   * Sounds and view changes hung off the canvas timeline: a `tick` every 10 %,
   * the ✓ chime when the bar completes, then `choose` once the character has grown back.
   */
  private stepSequence() {
    const since = UploadSeq.sinceDrop();
    if (since == null) return;
    const dur = State.uploadDuration;
    const p = Math.max(0, Math.min(1, (since - PRE_PROGRESS) / dur));

    const tens = Math.floor(p * 10);
    if (tens > this.uploadTens && tens < 10) {
      this.uploadTens = tens;
      Sound.play("tick");
    }

    if (!this.uploadDone && since >= PRE_PROGRESS + dur) {
      this.uploadDone = true;
      Sound.play("approve");
      this.engine.triggerEmote("happy");
    }
    // The extra second is the grow-back, after which the choose card is up.
    if (since >= PRE_PROGRESS + dur + 1 && State.view === "uploading") {
      this.setView("choose");
    }
  }

  // ── Geometry ────────────────────────────────────────────────────────────────

  /**
   * Where the island is drawn: at the character's place, or — open with
   * `islandPlace` set — centred at the top, middle or bottom of the screen.
   */
  private get placement(): Placement {
    const home = this.homePlacement;
    if (!this.away) return home;
    const place = this.awayPlace;
    const v = place === "bottom" ? "bottom" : place === "center" ? "middle" : "top";
    const glue = State.settings.glueEdges !== false && v !== "middle";
    return { ...home, h: "center", v, glueX: false, glueY: glue };
  }

  /** The window opens at the chosen place; it goes there before the island grows. */
  private openAway() {
    this.openOffset = { x: 0, y: 0 };
    if (this.awayClosing != null) {
      window.clearTimeout(this.awayClosing);
      this.awayClosing = null;
    }
    // The greeting plays at its own place (Impostazioni → Posizione e aspetto).
    const greeting = State.view === "greeting";
    this.awayPlace = greeting ? (State.settings.greetingPlace ?? "center") : (State.settings.islandPlace ?? "character");
    this.away = this.awayPlace !== "character";
    void Bridge.setExpanded(true, greeting ? this.awayPlace : null);
  }

  /** Opened elsewhere: it retracts there, then the window goes back to the character. */
  private closeAway() {
    if (!this.away) {
      void Bridge.setExpanded(false);
      return;
    }
    if (this.awayClosing != null) window.clearTimeout(this.awayClosing);
    this.awayClosing = window.setTimeout(() => {
      this.awayClosing = null;
      if (State.mode === "expanded") return;
      this.away = false;
      void Bridge.setExpanded(false);
      this.animateGeometry(false);
    }, 320);
  }

  /** The character's place: settings, in the shape the layout helpers take. */
  private get homePlacement(): Placement {
    const s = State.settings;
    return {
      h: s.anchorH,
      v: s.anchorV,
      iconStyle: s.iconStyle,
      iconSize: s.iconSize,
      hoverStyle: s.hoverStyle,
      hoverSize: s.hoverSize,
      ...glueFor(s.anchorH, s.anchorV, s.offsetX ?? 0, s.offsetY ?? 0, s.glueEdges ?? true),
    };
  }

  /** The strip beside the compact island's character is up (src/views/strip.ts). */
  private get stripShown(): boolean {
    return State.mode === "compact" && this.strip.item != null && this.stripW > 0;
  }

  /**
   * The compact island: the badge (or the bar), or with the strip the character
   * in a square of the badge's height and the strip beside it.
   */
  private compactBox(): { w: number; h: number } {
    const c = compactSize(this.placement);
    if (!this.stripShown) return c;
    const side = Math.max(c.h, STRIP_H);
    return { w: side + this.stripW, h: side };
  }

  /**
   * A request or a call the strip can answer, with the island closed: shown
   * there (the compact island comes up and stays) instead of opening. False
   * when the island should open as before: strip off, island open, greeting.
   */
  /** Impostazioni → Isola, «Permessi e chiamate»: they open the island by themselves. */
  alertsOpen(): boolean {
    return State.settings.alertsOpen !== false;
  }

  /**
   * «Permessi e chiamate» off: the request waits with the island closed. The
   * compact island peeks so the badge is seen; nothing opens.
   */
  peek() {
    if (!State.quiet && this.fsm.state === "hidden") this.fsm.reveal();
    State.notify();
  }

  showInStrip(): boolean {
    if ((State.settings.compactStrip ?? "right") === "off" || State.mode === "expanded" || this.fsm.state === "greeting") return false;
    if (this.fsm.state === "hidden") {
      this.quietLaunch = true; // the request's own sound, not the peek
      this.fsm.reveal();
    }
    State.notify();
    return true;
  }

  private targetSize(): { w: number; h: number; r: number } {
    const compact = this.compactBox();
    const measured = this.fit.view === State.view ? this.fit.h : 0;
    // With the menu, the views start below the top bar's gap (BODY_GAP).
    const fit = measured > 0 && this.railShown ? measured + BODY_GAP : measured;
    let { w, h } = islandSize(State.mode, State.view, State.chatHistory.length, compact, fit);
    // The user's size of the open island (its corner, or Impostazioni → Posizione).
    // Greeting and drop sequence are drawn at a fixed size and keep theirs.
    const max = islandMax(this.limits);
    if (State.mode === "expanded" && !FIXED_SIZE_VIEWS.has(State.view)) {
      const s = State.settings;
      w = this.openWidth(max.w);
      if (s.islandHeight > 0) h = Math.max(h, Math.min(max.h, Math.round(s.islandHeight)));
      // The menu sits beside the views and keeps all its rows in sight.
      if (this.railShown) {
        w = Math.min(max.w, w + this.railRoom);
        h = Math.max(h, Math.min(max.h, this.railMinH));
      }
      if (State.maximized) ({ w, h } = { w: Math.max(PANEL_W, this.limits.w), h: Math.max(PANEL_H, this.limits.h) });
    }
    // Height the user added beyond the view's own: lists and text boxes grow by
    // it (CSS max-height: calc(… + var(--extra-h))) instead of keeping their
    // scroll bar in an island that has room. Measured against the natural
    // height so a list that grows does not feed back into the island's size.
    const natural = islandSize(State.mode, State.view, State.chatHistory.length, compact, fit).h;
    const extra = State.mode === "expanded" ? Math.max(0, h - natural) : 0;
    this.fitPanel();
    // Closing far from the character: it retracts where it is.
    if (this.away && State.mode !== "expanded") h = 0;
    this.islandEl.style.setProperty("--extra-h", `${extra}px`);
    this.islandEl.style.setProperty("--extra-w", `${State.mode === "expanded" ? Math.max(0, w - EXPANDED_W) : 0}px`);
    // Windows 11 look: close to a window's corner, open or closed (pill and badge stay round).
    let r = windowsLook() ? 10 : State.mode === "expanded" ? EXPANDED_CORNER : ROUNDED_CORNER;
    // The hover badge is a circle; a floating bar is a pill.
    if (State.mode !== "expanded" && this.placement.hoverStyle === "icon") r = Math.min(compact.w, compact.h) / 2;
    else if (State.mode !== "expanded" && !isGlued(this.placement)) r = compact.h / 2;
    if (State.maximized && State.mode === "expanded" && !FIXED_SIZE_VIEWS.has(State.view)) r = 0;
    return { w, h, r };
  }

  /**
   * The open island's least height on this view: its content (or the view's
   * own size) and, with the menu, all the menu's rows. The corner stops here.
   */
  private minOpenHeight(): number {
    const measured = this.fit.view === State.view ? this.fit.h : 0;
    const fit = measured > 0 && this.railShown ? measured + BODY_GAP : measured;
    let h = islandSize("expanded", State.view, State.chatHistory.length, this.compactBox(), fit).h;
    if (this.railShown) h = Math.max(h, this.railMinH);
    return Math.min(islandMax(this.limits).h, h);
  }

  /** The open island's least height with the menu: all its rows in sight. */
  private get railMinH(): number {
    return Math.ceil(ISLAND_CHROME_H + BODY_GAP + (this.rail.fitHeight?.() ?? 0));
  }

  /**
   * The window follows the user's size of the open island (search bar included):
   * the usual 720×560, or bigger up to the work area. It does not change with
   * the view, only when the user resizes or the menu grows, so it never cuts an
   * island in mid-animation. An island taller than its window, anchored at the
   * bottom or in the middle, lost its top bar off the window.
   */
  private fitPanel() {
    const s = State.settings;
    const max = islandMax(this.limits);
    const w = Math.min(max.w, this.openWidth(max.w) + RAIL_W + RAIL_GAP);
    const user = s.islandHeight > 0 ? s.islandHeight : 0;
    const menu = this.railNeed > 0 ? ISLAND_CHROME_H + BODY_GAP + this.railNeed : 0;
    const h = Math.min(max.h, Math.max(user, menu));
    // Full screen: the whole room (work area) is the window.
    const next = State.maximized ? { w: Math.max(PANEL_W, this.limits.w), h: Math.max(PANEL_H, this.limits.h) } : panelFor(w, Math.min(h, max.h), this.limits);
    if (next.w === this.panel.w && next.h === this.panel.h) return;
    this.panel = next;
    void Bridge.setPanelSize(next.w, next.h);
  }

  /**
   * The open island's width: the user's, or wider when the header's tabs and
   * buttons need more room (many integrations as tabs), up to the work area.
   */
  private openWidth(maxW: number): number {
    const s = State.settings;
    return Math.round(Math.min(maxW, Math.max(ISLAND_MIN_W, s.islandWidth || EXPANDED_W, this.headerNeed)));
  }

  /**
   * What the header needs (its tabs at their own width, the buttons, a gap):
   * measured after every header sync; a change resizes the island.
   */
  private measureHeader() {
    const buttons = this.header.el.querySelector<HTMLElement>(".header-actions");
    if (!buttons || !buttons.offsetWidth) return;
    const need = Math.ceil(buttons.offsetWidth + HEADER_MIN) - this.railRoom;
    if (Math.abs(need - this.headerNeed) <= 1) return;
    this.headerNeed = need;
    if (State.mode === "expanded") this.animateGeometry(false);
  }

  /** The work area of the island's screen, asked again when screen or settings change. */
  async refreshLimits() {
    const l = await Bridge.panelLimits();
    if (!l) return;
    const [w, h] = l;
    if (Math.abs(w - this.limits.w) < 1 && Math.abs(h - this.limits.h) < 1) return;
    this.limits = { w, h };
    this.animateGeometry(false);
  }

  private animateGeometry(shrinking: boolean) {
    const { w, h, r } = this.targetSize();
    // The views are laid out at the open island's final width, not the animated
    // one (CSS: `.view` width from --view-w, anchored on the island's side): text
    // that rewrapped and scroll bars that came and went at every frame changed
    // the measured content height (fitHeight) while the island grew, and the
    // island chased it in jerks. Closing keeps the last width while it fades.
    if (State.mode === "expanded") {
      this.viewsEl.style.setProperty("--view-w", `${Math.round(w - 20 - this.railRoom)}px`);
      this.viewsEl.dataset.anchor = this.placement.h;
    }
    if (shrinking) {
      this.width.curveTowards(w);
      this.height.curveTowards(h);
      this.radius.curveTowards(r);
    } else {
      this.width.springTo(w);
      this.height.springTo(h);
      this.radius.springTo(r);
    }
    this.ensureRunning();
  }

  private applyGeometry() {
    const w = this.width.value;
    const hh = this.height.value;
    const r = this.radius.value;
    const p = this.framePlacement;
    const o = anchoredOrigin(p, w, hh, this.panel.w, this.panel.h);
    this.islandEl.style.left = `${o.x}px`;
    this.islandEl.style.top = `${o.y}px`;
    this.islandEl.style.width = `${w}px`;
    this.islandEl.style.height = `${hh}px`;
    // Square where it meets a screen edge; a floating island is rounded all round,
    // and so is one being carried or the open one dragged off the edge.
    const rr = Math.min(r, w / 2, hh / 2);
    const off = State.mode === "expanded" ? this.openOffset : { x: 0, y: 0 };
    const edges = { ...p, glueX: p.glueX && !this.carried && off.x === 0, glueY: p.glueY && !this.carried && off.y === 0 };
    this.islandEl.style.borderRadius = cornerRadii(edges, rr);
    // These follow the island as it resizes, so they belong here rather than in
    // the state-driven DOM sync.
    this.miniGrid.style.left = `${w - 40 - 14.5}px`;
    this.miniGrid.style.top = `${hh / 2 - 14.5}px`;
    // The resize corner: opposite the anchored side, on the free edge.
    const grip = this.resizeGrip.style;
    const showGrip = State.mode === "expanded" && !FIXED_SIZE_VIEWS.has(State.view) && !this.uploadActive;
    grip.display = showGrip ? "block" : "none";
    if (showGrip) {
      const left = p.h === "right";
      const up = p.v === "bottom";
      grip.left = left ? "0px" : "";
      grip.right = left ? "" : "0px";
      grip.top = up ? "0px" : "";
      grip.bottom = up ? "" : "0px";
      grip.cursor = left !== up ? "nesw-resize" : "nwse-resize";
      this.resizeGrip.dataset.corner = `${up ? "t" : "b"}${left ? "l" : "r"}`;
    }
    this.greetingCanvas.style.left = `${(w - EXPANDED_W) / 2}px`;
    this.uploadCanvas.el.style.left = `${(w - EXPANDED_W) / 2}px`;

    const rect = { x: o.x, y: o.y, w, h: hh };
    const pr = this.pushedRect;
    if (
      Math.abs(pr.x - rect.x) > 0.5 || Math.abs(pr.y - rect.y) > 0.5 ||
      Math.abs(pr.w - rect.w) > 0.5 || Math.abs(pr.h - rect.h) > 0.5
    ) {
      this.pushedRect = rect;
      void Bridge.setIslandRect(rect.x, rect.y, rect.w, rect.h);
    }
  }

  /** Island rect in window coordinates (origin top-left of the 720×320 window). */
  /** Within DROP_MARGIN of the island shape: where a dragged file is taken. */
  private nearIsland(x: number, y: number): boolean {
    const r = this.islandRect();
    return r.w > 0 && x >= r.x - DROP_MARGIN && x <= r.x + r.w + DROP_MARGIN
      && y >= r.y - DROP_MARGIN && y <= r.y + r.h + DROP_MARGIN;
  }

  /** Inside the island shape (client px). */
  private overIsland(x: number, y: number): boolean {
    const r = this.islandRect();
    return r.w > 0 && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  private islandRect(): { x: number; y: number; w: number; h: number } {
    const w = this.width.value;
    const hh = this.height.value;
    const o = anchoredOrigin(this.framePlacement, w, hh, this.panel.w, this.panel.h);
    return { x: o.x, y: o.y, w, h: hh };
  }

  /** Full screen (▢): glued to every edge, so it fills the window to the pixel. */
  private get framePlacement(): Placement {
    return State.maximized && State.mode === "expanded" ? { ...this.placement, glueX: true, glueY: true } : this.placement;
  }

  // ── Rest icon / wake strip ──────────────────────────────────────────────────

  /**
   * Places the rest icon and the wake strip against the window edges on the
   * anchored side. Using left/right/top/bottom (not absolute coordinates) keeps
   * them on the same screen pixel whether the window is the small collapsed box
   * or the full panel — both are pinned to the same corner.
   */
  private placeRestElements() {
    const p = this.homePlacement;
    const pin = (el: HTMLElement, w: number, hh: number, margin: number) => {
      el.style.width = `${w}px`;
      el.style.height = `${hh}px`;
      el.style.left = p.h === "left" ? `${margin}px` : p.h === "center" ? "50%" : "";
      el.style.right = p.h === "right" ? `${margin}px` : "";
      el.style.transform = p.h === "center" ? "translateX(-50%)" : "";
      el.style.top = p.v === "top" ? `${margin}px` : "";
      el.style.bottom = p.v === "bottom" ? `${margin}px` : "";
    };
    const box = collapsedBox(p);
    pin(this.wakeStrip, box.w, box.h, 0);
    pin(this.restIcon, p.iconSize, p.iconSize, EDGE_MARGIN);
    this.wakeStrip.style.display = p.iconStyle === "none" ? "block" : "none";
  }

  /**
   * Draws the rest icon once. It is a still frame on purpose: a resting island
   * runs no animation loop at all.
   */
  private drawRestIcon() {
    const p = this.homePlacement;
    const state = State.effectiveState;
    const key = `${window.devicePixelRatio}|${p.iconStyle}|${p.iconSize}|${state}|${State.paused}|${State.settings.theme.slimeColor}|${character().id}`;
    if (key === this.restKey) return;
    this.restKey = key;

    const size = p.iconSize;
    this.restCanvas.style.display = p.iconStyle === "character" ? "block" : "none";
    this.restDot.style.display = p.iconStyle === "dot" ? "block" : "none";
    this.restIcon.classList.toggle("paused", State.paused);

    if (p.iconStyle === "dot") {
      const color = state === "idle" || state === "sleeping" ? "#8E939C" : botGlowColor(state);
      const d = Math.max(6, Math.round(size * 0.5));
      this.restDot.style.width = `${d}px`;
      this.restDot.style.height = `${d}px`;
      this.restDot.style.background = color;
    } else if (p.iconStyle === "character") {
      // The body is ~68 % of the engine canvas wide; size the canvas so the body
      // fills ~90 % of the icon box and let the canvas overflow it.
      const w = Math.round(size * 1.3);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.restCanvas.width = Math.round(w * dpr);
      this.restCanvas.height = Math.round(w * dpr);
      this.restCanvas.style.width = `${w}px`;
      this.restCanvas.style.height = `${w}px`;
      const engine = new BotEngine();
      engine.bodyColor = this.themeBody();
      engine.setState(state, true);
      engine.update(0);
      const ctx = this.restCanvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, w);
      engine.draw(ctx, w, w);
    }
  }

  /**
   * The corner opposite the anchored side resizes the open island: width and
   * a minimum height, saved in the settings on release. A centred island grows
   * on both sides, so the width moves twice as fast as the pointer.
   */
  private wireResize() {
    const g = this.resizeGrip;
    let start: { x: number; y: number; w: number; h: number } | null = null;
    const dirs = () => {
      const p = this.placement;
      return { fx: p.h === "right" ? -1 : p.h === "center" ? 2 : 1, fy: p.v === "bottom" ? -1 : p.v === "middle" ? 2 : 1 };
    };
    g.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      this.cancelHoverOpen();
      // The width the user sets is the views' own: the menu beside them is
      // not counted, or the island jumped by the menu's width on the first move.
      start = {
        x: e.screenX, y: e.screenY,
        w: this.width.value - this.railRoom, h: this.height.value,
      };
      g.setPointerCapture(e.pointerId);
    });
    g.addEventListener("pointermove", (e) => {
      if (!start) return;
      const { fx, fy } = dirs();
      const s = State.settings;
      const max = islandMax(this.limits);
      s.islandWidth = Math.round(Math.min(max.w, Math.max(ISLAND_MIN_W, this.headerNeed, start.w + (e.screenX - start.x) * fx)));
      // Not below what the view needs: a height under it was saved as it was
      // (the island stopped, the number went on with the pointer), so the
      // corner no longer followed the pointer on the way back, and the island
      // reopened at another size on a view of another height.
      s.islandHeight = Math.round(Math.min(max.h, Math.max(this.minOpenHeight(), start.h + (e.screenY - start.y) * fy)));
      State.lastActivity = performance.now();
      this.animateGeometry(false);
    });
    const end = () => {
      if (!start) return;
      start = null;
      void Bridge.saveSettings(State.settings);
    };
    g.addEventListener("pointerup", end);
    g.addEventListener("pointercancel", end);
    g.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      State.settings.islandWidth = EXPANDED_W;
      State.settings.islandHeight = 0;
      this.animateGeometry(false);
      void Bridge.saveSettings(State.settings);
    });
  }

  /** Until when the hover hello runs (the character looks at the cursor meanwhile). */
  private helloUntil = 0;

  /**
   * The cursor reached the closed island (rest icon, wake strip or compact
   * view): the character hops, looks at you and lifts a hand. The rest icon
   * gives way to the compact view on that same hover, so the hello is the
   * compact character's. Not more than once per hello.
   */
  private hoverHello() {
    if (State.mode === "expanded" || State.paused || State.quiet) return;
    const t = performance.now();
    if (t < this.helloUntil) return;
    this.helloUntil = t + 1500;
    this.engine.hello();
    this.ensureRunning();
  }

  /** The character's body colour from the theme; null keeps the slime green. */
  private themeBody() {
    const c = State.settings.theme?.slimeColor;
    return c && /^#[0-9a-f]{6}$/i.test(c) ? hexToRGB(c) : null;
  }

  /**
   * "Sfondo a isola chiusa" off: while the island is not open, its background
   * goes away and only the character is left. The launch greeting is always
   * the character alone, with its halo and particles.
   */
  private applyBare() {
    const greeting = State.mode === "expanded" && State.view === "greeting";
    const bare = greeting || (State.mode !== "expanded" && State.settings.theme?.compactBackground === false);
    this.islandEl.classList.toggle("bare", bare);
    this.islandEl.classList.toggle("greeting", greeting);
  }

  /** Island colour/opacity and per-family volumes from the theme. */
  private applyTheme() {
    const t = State.settings.theme;
    setCharacter(t.character);
    applyUiStyle(t.style);
    let hex = /^#[0-9a-f]{6}$/i.test(t.islandColor) ? t.islandColor : "#000000";
    // Windows 11 look: the untouched black becomes the grey of Windows' dark surfaces.
    if (uiStyle(t.style) === "windows" && hex === "#000000") hex = WINDOWS_ISLAND;
    const n = parseInt(hex.slice(1), 16);
    const a = Math.max(0.5, Math.min(1, t.islandOpacity));
    this.islandEl.style.background = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    this.applyBare();
    Sound.setFamilyGains({ alerts: t.volumeAlerts, ui: t.volumeUi, emotes: t.volumeEmotes });
  }

  /** Re-reads placement settings: icon, anchors and the window box. */
  private applyPlacement() {
    this.restKey = "";
    this.placeRestElements();
    this.drawRestIcon();
    this.animateGeometry(false);
    if (this.collapsed) {
      const box = collapsedBox(this.homePlacement);
      void Bridge.setCollapsed(true, box.w, box.h);
    } else {
      void Bridge.reposition();
    }
  }

  /** Resting the pointer on the compact island opens it after `openDelay`. */
  private scheduleHoverOpen() {
    const delay = State.settings.openDelay;
    if (delay <= 0 || this.hoverOpenTimer != null || this.press) return;
    // Its buttons are there to be clicked: the island opens only on a click.
    if (this.stripShown && this.strip.item?.buttons.length) return;
    this.hoverOpenTimer = window.setTimeout(() => {
      this.hoverOpenTimer = null;
      if (State.mode !== "compact" || this.press) return;
      // Judged on the last known cursor, not on enter/leave bookkeeping: the
      // island may have grown under a pointer that never moved.
      const r = this.islandRect();
      const { x, y } = State.mouse;
      const inside = x >= r.x - HIT_MARGIN && x <= r.x + r.w + HIT_MARGIN &&
        y >= r.y - HIT_MARGIN && y <= r.y + r.h + HIT_MARGIN;
      if (inside) this.openByUser();
    }, delay * 1000);
  }

  /** Opened by the user (hover, click): the search bar takes the keyboard. */
  private openByUser() {
    this.openedByUser = true;
    this.fsm.click();
    this.openedByUser = false;
    this.stayIfAsked();
  }

  /** Impostazioni → "Resta aperta quando la apro io": 📌 on by itself. */
  private stayIfAsked() {
    if (State.settings.stayOpenByUser && State.mode === "expanded" && !State.keepOpen) {
      this.toggleKeepOpen();
      State.keptByItself = true;
    }
  }

  /** Opened from the tray icon or from EasyIsland pinned to the taskbar (started again). */
  openFromTaskbar() {
    if (State.mode !== "expanded") {
      this.openedByUser = true;
      this.alert(State.defaultView());
      this.openedByUser = false;
    }
    this.stayIfAsked();
  }

  /** ▢: the open island fills the work area; again, back to its own size. */
  toggleMaximized() {
    State.maximized = !State.maximized;
    this.animateGeometry(false);
    State.notify();
  }

  /**
   * The search bar takes the keyboard. Only when the user opened the island,
   * never for an alert (it would steal the keys from the app being typed in),
   * and not over a request waiting for its N / Y keys.
   */
  private focusSearchSoon() {
    window.setTimeout(() => {
      if (State.mode !== "expanded" || !this.searchShown || State.pendingApproval) return;
      this.keyboard = true;
      this.search.focus();
    }, 120);
  }

  private cancelHoverOpen() {
    if (this.hoverOpenTimer != null) window.clearTimeout(this.hoverOpenTimer);
    this.hoverOpenTimer = null;
  }

  // ── Window collapse (hidden → tiny wake strip, zero polling) ────────────────

  private updateWindowCollapsed() {
    if (this.collapseTimer != null) {
      window.clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
    if (State.mode === "hidden") {
      // Let the island finish retracting, then drop the window to the wake strip:
      // from there the OS delivers no cursor events, so nothing polls at all.
      this.collapseTimer = window.setTimeout(() => {
        this.collapseTimer = null;
        if (State.mode !== "hidden") return;
        this.collapsed = true;
        const box = collapsedBox(this.homePlacement);
        void Bridge.setCollapsed(true, box.w, box.h);
      }, 420);
    } else if (this.collapsed) {
      // Grow the window back before the island animates open.
      this.collapsed = false;
      void Bridge.setCollapsed(false);
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  /** True for the open island's header background, where a drag moves the island. */
  private isHeaderGrab(target: EventTarget | null): boolean {
    const t = target as HTMLElement | null;
    return !!t?.closest?.("#header") && !t.closest("button, input, select, [data-id]");
  }

  private wireInput() {
    // The rest icon (or the wake strip) is the only thing the OS can hit while
    // the island is hidden.
    const wake = () => {
      Sound.resume();
      if (State.mode !== "hidden") return;
      this.fsm.mouseEntered();
      this.scheduleHoverOpen();
    };
    this.wakeStrip.addEventListener("mouseenter", wake);
    this.restIcon.addEventListener("mouseenter", () => { wake(); this.hoverHello(); });
    this.wakeStrip.addEventListener("mouseenter", () => this.hoverHello());
    this.islandEl.addEventListener("mouseenter", () => { if (State.mode === "compact") this.hoverHello(); });
    // The island can be moved in every state: the rest icon, the compact island and,
    // by its header, the open one. A still press keeps doing what it did (open);
    // moving past the threshold drags, and the place is remembered (end_drag).
    const startPress = (e: PointerEvent, el: HTMLElement, expanded: boolean) => {
      Sound.resume();
      State.lastActivity = performance.now();
      this.cancelHoverOpen();
      this.press = { x: e.screenX, y: e.screenY, moved: false, expanded };
      el.setPointerCapture(e.pointerId);
    };
    const movePress = (e: PointerEvent) => {
      const p = this.press;
      if (!p) return;
      const dx = e.screenX - p.x;
      const dy = e.screenY - p.y;
      if (!p.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      // An open island must not close under the pointer while it is carried.
      if (!p.moved && p.expanded) this.fsm.pinned = true;
      if (!p.moved) {
        this.carried = true;
        this.applyGeometry();
      }
      p.moved = true;
      p.x = e.screenX;
      p.y = e.screenY;
      void Bridge.dragIsland(dx, dy);
      // The slime wobbles as it is carried around.
      this.engine.jiggle(dx, dy);
      this.ensureRunning();
    };
    const endPress = (e: PointerEvent, el: HTMLElement, cancelled: boolean, click: () => void) => {
      const p = this.press;
      if (!p) return;
      this.press = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (p.moved) {
        const expanded = p.expanded;
        void Bridge.endDrag().then((end) => {
          const off = end?.offset;
          if (expanded && off) this.openOffset = { x: off[0], y: off[1] };
          if (end?.path) this.pathToChat([end.path]);
          this.carried = false;
          this.applyGeometry();
        });
        if (p.expanded) this.fsm.pinned = State.isPinned;
      } else if (!cancelled) {
        click();
      }
    };

    // Rest icon: a click opens, a drag moves it.
    this.restIcon.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      startPress(e, this.restIcon, false);
    });
    this.restIcon.addEventListener("pointermove", movePress);
    const openFromRest = () => {
      wake();
      this.openByUser();
    };
    this.restIcon.addEventListener("pointerup", (e) => endPress(e, this.restIcon, false, openFromRest));
    this.restIcon.addEventListener("pointercancel", (e) => endPress(e, this.restIcon, true, openFromRest));
    // Right click on the resting character: the same menu as the notification-area
    // icon. Hovering the rest icon already wakes the compact island, so that is
    // usually the one that gets the click.
    const restMenu = (e: MouseEvent) => {
      if (State.mode === "expanded") return;
      e.preventDefault();
      if (this.press) return;
      void Bridge.showIslandMenu();
    };
    this.restIcon.addEventListener("contextmenu", restMenu);
    this.islandEl.addEventListener("contextmenu", restMenu);
    // The open island: never WebView2's menu (Indietro, Ricarica, Ispeziona…),
    // ours instead, made for what is under the mouse. Text fields keep the
    // native one, for Taglia / Copia / Incolla.
    document.addEventListener("contextmenu", (e) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
      if (State.mode !== "expanded") return;
      const menu = this.contextItems(el);
      showMenu(this.islandEl, e.clientX, e.clientY, menu.title, menu.items);
    });

    // Chat tab: the character carried onto another app's window attaches that
    // window to the chat (window_drop.rs). A still press stays a pat. Registered
    // before the island's own press, which it keeps from starting.
    this.islandEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.canPickWindow() || !this.isBotHit(e.clientX, e.clientY)) return;
      e.stopImmediatePropagation();
      Sound.resume();
      State.lastActivity = performance.now();
      this.cancelHoverOpen();
      this.windowPress = { x: e.screenX, y: e.screenY, moved: false, cancelled: false, busy: false, again: false };
      this.islandEl.setPointerCapture(e.pointerId);
      // The window keeps the mouse from the press on: a quick drag used to leave
      // the island before window_pick(true) landed, and the window let go.
      this.fsm.pinned = true;
      void Bridge.windowPick(true);
    });
    this.islandEl.addEventListener("pointermove", (e) => {
      const p = this.windowPress;
      if (!p || p.cancelled) return;
      const dx = e.screenX - p.x;
      const dy = e.screenY - p.y;
      if (!p.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        p.moved = true;
        this.startWindowPick();
      }
      p.x = e.screenX;
      p.y = e.screenY;
      this.carryAt = { x: e.clientX, y: e.clientY };
      this.placeCarry();
      // It wobbles as it is carried, and looks the way it goes.
      this.engine.jiggle(dx, dy);
      this.pickLook = {
        x: clamp(this.pickLook.x * 0.6 + dx / 25, -1, 1),
        y: clamp(this.pickLook.y * 0.6 + dy / 25, -1, 1),
      };
      this.ensureRunning();
      // Over the island itself nothing would be attached.
      if (this.overIsland(e.clientX, e.clientY)) {
        this.pickFace(false);
        if (State.windowPick?.over) {
          State.windowPick = { over: "" };
          State.notify();
        }
        return;
      }
      this.askPickWindow(p);
    });
    const endWindowPress = (e: PointerEvent, cancelled: boolean) => {
      const p = this.windowPress;
      if (!p) return;
      this.windowPress = null;
      if (this.islandEl.hasPointerCapture(e.pointerId)) this.islandEl.releasePointerCapture(e.pointerId);
      if (!p.moved) {
        // A pat, not a drag.
        void Bridge.windowPick(false);
        this.fsm.pinned = State.isPinned;
        return;
      }
      if (p.cancelled) return;
      void this.endWindowPick(!cancelled && !this.overIsland(e.clientX, e.clientY));
    };
    this.islandEl.addEventListener("pointerup", (e) => endWindowPress(e, false));
    this.islandEl.addEventListener("pointercancel", (e) => endWindowPress(e, true));
    // Esc gives up while it is carried (before the chat field, which keeps its keys).
    window.addEventListener("keydown", (e) => {
      const p = this.windowPress;
      if (e.key !== "Escape" || !p?.moved || p.cancelled) return;
      e.preventDefault();
      e.stopPropagation();
      p.cancelled = true;
      void this.endWindowPick(false);
    }, true);

    // Compact island: a press opens on release, a drag moves it. Open island: the
    // header's empty space drags it (tabs, buttons and fields keep their clicks).
    this.islandEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const expanded = State.mode === "expanded";
      if (expanded && !this.isHeaderGrab(e.target)) return;
      startPress(e, this.islandEl, expanded);
    });
    this.islandEl.addEventListener("pointermove", movePress);
    this.wireResize();
    const openFromCompact = () => {
      if (State.mode !== "expanded") this.openByUser();
    };
    this.islandEl.addEventListener("pointerup", (e) => endPress(e, this.islandEl, false, openFromCompact));
    this.islandEl.addEventListener("pointercancel", (e) => endPress(e, this.islandEl, true, openFromCompact));

    this.islandEl.addEventListener("mousedown", (e) => {
      Sound.resume();
      State.lastActivity = performance.now();
      if (State.mode !== "expanded") return;
      if (this.isBotHit(e.clientX, e.clientY)) {
        this.cancelBotHover();
        this.engine.slap();
      }
    });

    window.addEventListener("keydown", (e) => {
      // Esc on a permission or a question folds the island: the request keeps waiting.
      if (e.key === "Escape" && State.mode === "expanded" && State.pendingApproval && (State.view === "approval" || State.view === "ask")) this.foldCard();
      else if (e.key === "Escape" && State.mode === "expanded" && State.view === "rewrite") this.closeRewrite();
      else if (e.key === "Escape" && State.mode === "expanded" && !State.isPinned && !State.pendingApproval) this.collapse();
      else this.onIslandKey(e);
      State.lastActivity = performance.now();
    });

    // A file of the tray being dragged out is never taken back.
    void onDragDrop((e) => this.onDragDrop(e), (x, y) => !State.draggingOut && this.nearIsland(x, y));

    // Outside Tauri (plain browser) drive the cursor from DOM events so the
    // island can be inspected with `npm run dev`.
    if (!IS_TAURI) {
      window.addEventListener("mousemove", (e) => {
        // The preview frames the window somewhere on the page; island
        // coordinates are relative to that frame.
        const r = this.root.getBoundingClientRect();
        this.onCursor(e.clientX - r.left, e.clientY - r.top);
      });
    }
  }

  /** Cursor in window-logical coordinates. */
  onCursor(x: number, y: number) {
    State.mouse = { x, y };
    const rect = this.islandRect();
    State.mouseInIsland = { x: x - rect.x, y: y - rect.y };

    // Windows sends no cursor position with an OLE drag, so the drop sequence is
    // fed from the Win32 cursor poll instead — it runs throughout the drag.
    if (UploadSeq.isActive && !UploadSeq.dropped) {
      UploadSeq.updateCursor(State.mouseInIsland.x, State.mouseInIsland.y);
    }

    const inIsland =
      x >= rect.x - HIT_MARGIN && x <= rect.x + rect.w + HIT_MARGIN &&
      y >= rect.y - HIT_MARGIN && y <= rect.y + rect.h + HIT_MARGIN;

    if (inIsland && !this.wasInIsland) {
      if (this.fsm.state === "greeting") this.greeting.hover();
      this.fsm.mouseEntered();
      this.homeCollapseAt = null;
    }
    if (inIsland && State.mode === "compact") this.scheduleHoverOpen();
    if (!inIsland && this.wasInIsland) {
      this.cancelHoverOpen();
      this.fsm.mouseLeft();
      if (this.fsm.state === "home" && !State.isPinned && !State.keepOpen && !State.pendingApproval && !this.search.open && !State.windowPick) {
        this.homeCollapseAt = performance.now() + State.settings.autoCloseInterval * 1000;
      }
    }
    this.wasInIsland = inIsland;

    // Bot hover → love
    const overBot = State.mode === "expanded" && State.stateOverride == null && this.isBotHit(x, y);
    if (overBot && !this.botHovering) this.botHoverIn(x, y);
    if (!overBot && this.botHovering) this.cancelBotHover();
    this.botHovering = overBot;
    if (this.botHovering) {
      const d = Math.hypot(x - this.botHoverStart.x, y - this.botHoverStart.y);
      if (d > 40) {
        this.botHoverStart = { x, y };
        this.scheduleLove();
      }
    }

    // Far from the island the gaze is already as far as it goes (tanh): a cursor
    // that moves without changing where the character looks must not wake the frame loop.
    const lx = this.lookX();
    const ly = this.lookY();
    const gazeMoved = this.followsCursor() &&
      (Math.abs(lx - this.drawnLook.x) > LOOK_EPS || Math.abs(ly - this.drawnLook.y) > LOOK_EPS);
    if (inIsland || this.botHovering || gazeMoved) {
      this.ensureRunning();
    }
  }

  private isBotHit(x: number, y: number): boolean {
    const rect = this.islandRect();
    const cx = rect.x + this.botCx.value;
    const cy = rect.y + this.botCy.value;
    const radius = this.botSize.value / 2;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
  }

  private botHoverIn(x: number, y: number) {
    if (performance.now() / 1000 - this.lastLoveTime < 6) return;
    this.botHoverStart = { x, y };
    this.engine.blink();
    this.engine.tgEs = 1.08;
    Sound.play("hover");
    this.scheduleLove();
  }

  private scheduleLove() {
    if (this.botHoverTimer != null) window.clearTimeout(this.botHoverTimer);
    this.botHoverTimer = window.setTimeout(() => {
      this.botHoverTimer = null;
      if (!this.botHovering || State.stateOverride != null) return;
      if (performance.now() / 1000 - this.lastLoveTime < 6) return;
      this.lastLoveTime = performance.now() / 1000;
      this.engine.triggerEmote("love");
      Sound.play("love");
    }, 1900);
  }

  private cancelBotHover() {
    if (this.botHoverTimer != null) window.clearTimeout(this.botHoverTimer);
    this.botHoverTimer = null;
    this.engine.tgEs = 1;
  }

  /** Three slaps → dizzy + confused view for 3.3 s, then back. */
  private handleDizzy() {
    this.prevViewBeforeConfused = State.view;
    State.stateOverride = "dizzy";
    this.engine.setState("dizzy");
    Sound.play("dizzy");
    this.alert("confused");
    if (this.confusedRecovery != null) window.clearTimeout(this.confusedRecovery);
    this.confusedRecovery = window.setTimeout(() => {
      this.confusedRecovery = null;
      State.stateOverride = null;
      this.engine.setState(State.effectiveState);
      if (State.view === "confused") {
        const fallback = State.defaultView();
        this.setView(this.prevViewBeforeConfused === "confused" ? fallback : this.prevViewBeforeConfused);
      }
      this.engine.triggerEmote("happy");
    }, 3300);
  }

  // ── Frame loop ──────────────────────────────────────────────────────────────

  ensureRunning() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (nowMs: number) => {
    const dt = Math.min(0.05, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;

    this.width.step(dt, nowMs);
    this.height.step(dt, nowMs);
    this.radius.step(dt, nowMs);
    this.applyGeometry();

    if (this.dirty) {
      this.dirty = false;
      guard("sync", () => this.syncDom());
    }

    this.updateBotTargets();
    this.botCx.step(dt);
    this.botCy.step(dt);
    this.botSize.step(dt);

    const greetingActive = State.mode === "expanded" && State.view === "greeting";
    if (greetingActive) {
      const gctx = this.greetingCanvas.getContext("2d");
      if (gctx) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.greeting.draw(gctx);
      }
    } else {
      // Kept running even while the drop canvas is up, so the island's own the character
      // is already in the right place the moment the canvas fades out.
      guard("character", () => this.drawBot(dt));
      if (State.windowPick) guard("pick", () => this.refreshPickCursor(nowMs));
    }

    const uploadActive = this.uploadActive;
    if (uploadActive) guard("drop", () => this.uploadCanvas.draw(UploadSeq.frame(), nowMs / 1000));
    this.uploadCanvas.el.classList.toggle("on", uploadActive);
    this.viewsEl.classList.toggle("hidden-by-upload", uploadActive);

    tickMiniBots(dt);
    guard(`tick ${State.view}`, () => this.views.get(State.view)?.tick?.(nowMs));
    if (UploadSeq.isActive) this.stepSequence();
    this.updateCountdown(nowMs);

    // Nothing is drawn while the island is hidden, so nothing may keep the loop
    // alive either. This used to read `... || this.engine.busy || State.mode !==
    // "hidden"`, and engine.busy is permanently true for any state with a
    // looping animation — breathing, ratelimit sweat, sleeping z's, the search
    // sweep — so a hidden island went on burning frames in exactly the states it
    // spends most of its life in. Geometry still has to finish retracting.
    const settling =
      this.width.animating || this.height.animating || this.radius.animating;
    const busy = State.mode === "hidden"
      ? settling
      : settling ||
        !this.botCx.settled || !this.botCy.settled || !this.botSize.settled ||
        greetingActive || this.engine.busy || UploadSeq.isActive || !!State.windowPick;

    // Only following the cursor: 30 fps is plenty for a gaze and halves the cost.
    // Tweens, geometry, particles, the greeting and the drop keep the full rate.
    const lookOnly = busy && !settling &&
      this.botCx.settled && this.botCy.settled && this.botSize.settled &&
      !greetingActive && !UploadSeq.isActive && !this.engine.busyBeyondLook;

    if (lookOnly) {
      window.setTimeout(() => requestAnimationFrame(this.frame), LOOK_FRAME_MS);
    } else if (busy) {
      requestAnimationFrame(this.frame);
    } else {
      this.running = false;
      Sound.idle();
    }
  };

  private updateBotTargets() {
    // Centred on the views, not on the search bar under them.
    const compact = this.compactBox();
    const p = botPosition(
      State.mode, State.view, this.height.value, State.uploadProgress,
      compact, this.railShown ? railBotSize() : 0,
    );
    if (this.stripShown) {
      // In its square at one end, the strip on the other side.
      const side = compact.h;
      p.cx = State.settings.compactStrip === "left" ? this.width.value - side / 2 : side / 2;
      p.cy = side / 2;
      p.diameter = side * 0.56;
    }
    this.botCx.target = p.cx;
    this.botCy.target = p.cy;
    this.botSize.target = p.diameter / 0.6;

    const greetingActive = State.mode === "expanded" && State.view === "greeting";
    // The drop canvas draws its own the character; two of them would overlap.
    const visible = p.opacity > 0 && !greetingActive && !this.uploadActive;
    this.botCanvas.style.opacity = visible ? "1" : "0";

    if (State.mode === "expanded" && State.view !== "uploading" && !greetingActive && !this.uploadActive) {
      const d = p.diameter;
      const color = botGlowColor(State.effectiveState);
      this.botGlow.style.display = "block";
      this.botGlow.style.width = `${d * 2.2}px`;
      this.botGlow.style.height = `${d * 2.2}px`;
      this.botGlow.style.left = `${this.botCx.value - d * 1.1}px`;
      this.botGlow.style.top = `${this.botCy.value - d * 1.1}px`;
      this.botGlow.style.background = `radial-gradient(circle, ${color} 0%, transparent 62%)`;
      this.botGlow.style.opacity = String(botGlowOpacity(State.effectiveState));
    } else {
      this.botGlow.style.display = "none";
    }
  }

  private drawBot(dt: number) {
    const size = this.botSize.value;
    const w = Math.max(1, Math.round(size));
    const hCss = w + BOT_OVERHANG;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvasPx !== w) {
      this.canvasPx = w;
      this.botCanvas.width = Math.round(w * dpr);
      this.botCanvas.height = Math.round(hCss * dpr);
      this.botCanvas.style.width = `${w}px`;
      this.botCanvas.style.height = `${hCss}px`;
    }
    this.botCanvas.style.left = `${this.botCx.value - w / 2}px`;
    this.botCanvas.style.top = `${this.botCy.value - BOT_OVERHANG / 2 - hCss / 2}px`;

    const ctx = this.botCanvas.getContext("2d");
    if (!ctx) return;

    // The open island's character wears the focused integration's colour. Claude
    // Code (white for its pill), the ⌂ summary and the compact island keep the
    // character's own (theme) colour: the tab is no longer on screen there.
    const focus = State.characterTask;
    const wears = State.mode === "expanded" && focus?.isIntegration && focus.id !== "integration_claude" && character().wearsIntegrationColor;
    this.engine.bodyColor = wears ? hexToRGB(focus.color) : this.themeBody();
    this.engine.particleOverhang = BOT_OVERHANG;
    const follow = this.followsCursor() || performance.now() < this.helloUntil;
    this.engine.lookX = follow ? this.lookX() : this.wanderLook.x;
    this.engine.lookY = follow ? this.lookY() : this.wanderLook.y;
    if (follow) this.drawnLook = { x: this.engine.lookX, y: this.engine.lookY };
    // Carried as the pointer: it looks the way it is moving, not at itself.
    if (State.windowPick) {
      this.engine.lookX = this.pickLook.x;
      this.engine.lookY = this.pickLook.y;
    }
    if (this.engine.morph > 0.3) {
      this.engine.slotHTarget = State.fileDragOver ? 0.2 : 0;
    } else {
      this.engine.slotHTarget = 0;
      if (this.engine.morph < 0.05) {
        this.engine.slotH = 0;
        this.engine.slotHVel = 0;
      }
    }
    this.engine.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hCss);
    this.engine.draw(ctx, w, hCss);
  }

  /** BotCanvasView.lookX / lookY — tanh of the distance to the bot. */
  private lookX(): number {
    const rect = this.islandRect();
    const botScreenX = rect.x + this.botCx.value;
    return Math.tanh((State.mouse.x - botScreenX) / 260);
  }

  private lookY(): number {
    const rect = this.islandRect();
    return -Math.tanh((State.mouse.y - rect.y - this.botCy.value) / 200);
  }

  private updateCountdown(nowMs: number) {
    if (State.mode !== "expanded" || State.isPinned || State.keepOpen || State.pendingApproval || this.homeCollapseAt == null) {
      this.countdown.style.width = "0px";
      return;
    }
    const autoClose = State.settings.autoCloseInterval;
    const windowS = Math.min(10, autoClose * 0.6);
    const remaining = (this.homeCollapseAt - nowMs) / 1000;
    this.countdown.style.width =
      remaining < windowS ? `${Math.max(0, clamp(remaining / windowS, 0, 1) * 160)}px` : "0px";
  }

  // ── DOM sync ────────────────────────────────────────────────────────────────

  private syncDom() {
    const expanded = State.mode === "expanded";
    const greetingActive = expanded && State.view === "greeting";

    this.contentEl.style.opacity = expanded && !greetingActive ? "1" : "0";
    this.contentEl.style.pointerEvents = expanded && !greetingActive ? "auto" : "none";
    this.greetingCanvas.style.display = greetingActive ? "block" : "none";
    this.applyBare();

    guard("header", () => this.header.sync());
    this.measureHeader();
    // The menu: shown with the open island, the views beside it with no room
    // kept for the character any more (--bot-room in style.css).
    const railed = this.railShown;
    this.islandEl.classList.toggle("railed", railed);
    this.islandEl.classList.toggle("open", expanded);
    if (railed) {
      guard("menu", () => this.rail.sync());
      // An integration switched on or off changes the menu's height: the island follows.
      const need = Math.round(this.rail.fitHeight?.() ?? 0);
      if (Math.abs(need - this.railNeed) > 1) {
        this.railNeed = need;
        this.animateGeometry(false);
      }
    }
    this.search.el.style.display = this.searchShown ? "" : "none";
    guard("search", () => this.search.sync());
    for (const [name, view] of this.views) {
      const on = name === State.view;
      view.el.classList.toggle("on", on);
      if (on) guard(`view ${name}`, () => view.sync());
    }

    // Views that know how tall their content is make the island grow (or
    // shrink back) to show all of it.
    if (expanded) {
      const fitH = this.measureFit();
      const prev = this.fit;
      if (prev.view !== State.view || Math.abs(prev.h - fitH) > 1) {
        this.fit = { view: State.view, h: fitH };
        this.animateGeometry(prev.view === State.view && fitH < prev.h);
      }
    }

    // The chat is the only view with a text field, so it is the only time the
    // island is allowed to take keyboard focus.
    if (this.lastSyncedView !== State.view) {
      const wasChat = this.lastSyncedView === "prompt";
      this.lastSyncedView = State.view;
      if (State.view === "prompt") {
        void Bridge.focusWindow(true);
        window.setTimeout(() => this.views.get("prompt")?.focus?.(), 120);
      } else if (wasChat && !this.keyboard) {
        void Bridge.focusWindow(false);
      }
    }

    // Compact mini grid
    guard("strip", () => this.syncStrip());
    const showGrid = State.mode === "compact" && this.placement.hoverStyle === "bar" && !this.stripShown;
    this.miniGrid.style.opacity = showGrid ? "1" : "0";
    if (showGrid) {
      // Four slots: past four, alerts first, three of them and "+N" for the rest.
      const all = [...State.otherTasks].sort((a, b) => Number(!!b.pillBadge) - Number(!!a.pillBadge));
      const others = all.length > 4 ? all.slice(0, 3) : all;
      const more = all.length - others.length;
      const key = `${others.map((t) => t.id).join("|")}+${more}`;
      if (this.miniGrid.dataset.key !== key) {
        this.miniGrid.dataset.key = key;
        this.miniGrid.replaceChildren();
        for (const t of others) {
          this.miniGrid.append(createMiniBot(t, 13));
        }
        if (more > 0) {
          this.miniGrid.append(h("span", { class: "mini-more", text: `+${more}` }));
        }
        pruneMiniBots();
      }
    }

    syncMiniBotStates(State.tasks);
    this.engine.setState(State.effectiveState);
    this.engine.sky = State.characterSky;

    // The rest icon shows only while the island is hidden — and not over a
    // full-screen app.
    const p = this.placement;
    const showRest = State.mode === "hidden" && p.iconStyle !== "none" &&
      !State.quiet;
    this.restIcon.classList.toggle("on", showRest);
    if (showRest) this.drawRestIcon();
  }

  /**
   * The strip beside the compact character: drawn, measured (a new width
   * resizes the island) and placed on the chosen side. When what it held for
   * is over, the compact island may hide again as usual.
   */
  private syncStrip() {
    const changed = this.strip.sync();
    const el = this.strip.el;
    const item = this.strip.item;
    if (changed) {
      const w = item ? Math.ceil(el.offsetWidth) : 0;
      if (w !== this.stripW) {
        this.stripW = w;
        if (State.mode === "compact") this.animateGeometry(false);
      }
    }
    const shown = this.stripShown;
    const side = Math.max(compactSize(this.placement).h, STRIP_H);
    const left = State.settings.compactStrip === "left";
    el.classList.toggle("on", shown);
    el.classList.toggle("left", left);
    el.style.height = `${side}px`;
    el.style.left = left ? "" : `${side}px`;
    el.style.right = left ? `${side}px` : "";
    const held = item?.urgent === true;
    if (this.stripHeld && !held && this.fsm.state === "petit" && !this.wasInIsland) this.fsm.mouseLeft();
    this.stripHeld = held;
  }

  /** "Sempre visibile": a resting island comes straight back as the compact view. */
  private keepCompactUp() {
    if (State.settings.revealDuration > 0 || this.fsm.state !== "hidden") return;
    // Paused from the tray, or quiet over a full-screen app: stay out of the way.
    if (State.paused || State.quiet) return;
    this.fsm.reveal();
  }

  /** Applies settings coming from Rust at boot. */
  applySettings() {
    Sound.setEnabled(State.settings.soundEnabled);
    Sound.setVolume(State.settings.soundVolume);
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    this.fsm.petitToHiddenDelay = State.settings.revealDuration;
    this.applyTheme();
    this.applyPlacement();
    void this.refreshLimits();
    this.keepCompactUp();
    this.scheduleWander();
    // Width or minimum height changed in the settings window.
    this.animateGeometry(false);
    State.notify();
  }

  get panelSize() {
    return this.panel;
  }

  get chatHeight() {
    return chatPromptHeight(State.chatHistory.length);
  }
}
