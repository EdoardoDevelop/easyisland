// The island: DOM shell, sizing animation, the character placement, mouse handling.
// Mirrors IslandRootView.swift + IslandWindowController.swift.

import { Tracked, Spring, clamp } from "../core/anim";
import { Bridge, IS_TAURI, onDragDrop } from "../core/bridge";
import {
  EDGE_MARGIN, EXPANDED_CORNER, EXPANDED_W, NOTCH_W, PANEL_H, PANEL_W,
  ROUNDED_CORNER, VIEW_LAYOUTS, anchoredOrigin, botGlowColor, botGlowOpacity, botPosition,
  chatPromptHeight, collapsedBox, compactSize, cornerRadii, glueFor, isGlued, islandSize,
  type IslandMode, type IslandViewName, type Placement,
} from "../core/layout";
import type { Suggestion } from "./context";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { BotEngine, hexToRGB } from "../character/engine";
import { character, setCharacter } from "../character/character";
import { Greeting } from "../character/greeting";
import { createMiniBot, pruneMiniBots, syncMiniBotStates, tickMiniBots } from "../character/minibots";
import { UploadCanvas } from "../upload/canvas";
import { USC, UploadSeq } from "../upload/sequence";
import { buildHeader, buildViews, type ViewActions, type ViewHost } from "../views/views";
import { sendToChat } from "../views/chat";
import { tabActions } from "../views/actions";
import type { ApprovalInfo, Notice, QuickAction } from "../core/state";
import { h } from "../views/dom";
import { IslandStateMachine } from "./fsm";

const BOT_OVERHANG = 40;
/** Same margin as the Rust hit test (src-tauri/src/island.rs). */
const HIT_MARGIN = 14;
/** Pause between two gestures of the compact the character when it does not follow the cursor, ms. */
const WANDER_MIN_MS = 1800;
const WANDER_SPREAD_MS = 4200;
/** Smallest change of gaze (lookX / lookY, −1…1) worth a new frame. */
const LOOK_EPS = 0.01;
/** Frame interval while the character only follows the cursor (nothing else moving), ms. */
const LOOK_FRAME_MS = 33;
/** Pointer travel (px) that turns a press on the compact island into a drag. */
const DRAG_THRESHOLD = 4;

/** The three views the drop sequence owns; leaving them stops the engine. */
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
  private botCanvas!: HTMLCanvasElement;
  private botGlow!: HTMLElement;
  private greetingCanvas!: HTMLCanvasElement;
  private miniGrid!: HTMLElement;
  private countdown!: HTMLElement;
  private wakeStrip!: HTMLElement;
  /** What stays on screen while the island is hidden (the character or a dot). */
  private restIcon!: HTMLElement;
  private restCanvas!: HTMLCanvasElement;
  private restDot!: HTMLElement;
  private restKey = "";

  private header!: ViewHost;
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
  private collapseTimer: number | null = null;
  private wasInIsland = false;
  /** Last shape handed to Rust for the click-through test. */
  private pushedRect = { x: -1, y: -1, w: -1, h: -1 };
  private homeCollapseAt: number | null = null;
  /** Hovering the compact island for `openDelay` seconds opens it. */
  private hoverOpenTimer: number | null = null;

  // Bot hover → love (IslandWindowController.botHoverIn)
  private botHovering = false;
  private botHoverTimer: number | null = null;
  private lastLoveTime = 0;
  private botHoverStart = { x: 0, y: 0 };

  private confusedRecovery: number | null = null;
  private prevViewBeforeConfused: IslandViewName = "overview";
  /** Where the island was before a permission card took it (rememberBeforeCard). */
  private beforeCard: { view: IslandViewName | null; focusId: string | null } | null = null;
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
    State.subscribe(() => {
      this.dirty = true;
      this.ensureRunning();
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
        const urls: Record<string, string> = {
          integration_resend: "https://resend.com/emails",
          integration_vercel: "https://vercel.com/dashboard",
          integration_github: "https://github.com",
          integration_stripe: "https://dashboard.stripe.com/payments",
          integration_notion: "https://notion.so",
          integration_calcom: "https://app.cal.com/bookings",
        };
        if (task.id === "integration_claude") {
          // A session seen by the hooks goes back to its own app; otherwise VS Code.
          if (task.sessionHost) void Bridge.openSession(task.sessionHost, task.sessionCwd ?? null);
          else void Bridge.openInVSCode(task.sessionCwd ?? null);
        }
        else if (task.id === "integration_n8n") void Bridge.openN8n();
        else if (task.id === "integration_zammad") void Bridge.openZammad();
        else if (urls[task.id]) void Bridge.openUrl(urls[task.id]);
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
      toggleSound: () => {
        State.settings.soundEnabled = !State.settings.soundEnabled;
        Sound.setEnabled(State.settings.soundEnabled);
        void Bridge.saveSettings(State.settings);
        State.notify();
      },
      setVolume: (v) => {
        State.settings.soundVolume = v;
        Sound.setVolume(v);
        void Bridge.saveSettings(State.settings);
        State.notify();
      },
      setAutoClose: (s) => {
        State.settings.autoCloseInterval = s;
        this.fsm.homeToPetitDelay = s;
        void Bridge.saveSettings(State.settings);
        State.notify();
      },
      openSettingsWindow: () => void Bridge.openSettingsWindow(),
      blip: () => Sound.play("blip"),
      toggleKeepOpen: () => this.toggleKeepOpen(),
      installUpdate: () => void this.installUpdate(),
      answerSuggestion: (fp, choice) => void this.answerSuggestion(fp, choice),
      runAction: (a) => void this.runAction(a),
      runSuggestion: (sg, app) => void this.runSuggestion(sg, app),
      extractZip: (place) => void this.extractZip(place),
      openFiles: () => void this.openFiles(),
      refreshFiles: () => void this.refreshFiles(),
      askAboutFile: (f) => this.askAboutFile(f),
      captureScreen: () => void this.captureScreen(),
      reorder: (ids) => {
        State.reorder(ids);
        void Bridge.saveSettings(State.settings);
        State.notify();
      },
      reorderTabs: (ids) => {
        State.settings.tabOrder = ids;
        void Bridge.saveSettings(State.settings);
        State.notify();
      },
      askAboutPicture: (f) => this.askAboutPicture(f),
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
    this.contentEl = h("div", { id: "content" }, this.header.el, this.viewsEl);

    // The drop sequence draws the card, the bar and its own the character. It sits under
    // the header, which stays visible on top of it exactly as on macOS.
    this.uploadCanvas = new UploadCanvas({
      ask: () => {
        State.promptContext = State.droppedFile
          ? { kind: "file", name: State.droppedFile.name, path: State.droppedFile.path }
          : null;
        this.setView("prompt");
      },
      cancel: () => this.setView(State.defaultView()),
      runAction: (a) => void this.runAction(a),
    });

    this.clipEl = h(
      "div",
      { id: "island-clip" },
      this.greetingCanvas,
      this.uploadCanvas.el,
      this.contentEl,
    );
    this.islandEl = h(
      "div",
      { id: "island" },
      this.clipEl,
      this.botGlow,
      this.botCanvas,
      this.miniGrid,
      this.countdown,
    );

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.greetingCanvas.width = Math.round(EXPANDED_W * dpr);
    this.greetingCanvas.height = Math.round(150 * dpr);
    this.greetingCanvas.style.width = `${EXPANDED_W}px`;
    this.greetingCanvas.style.height = "150px";

    this.root.append(this.wakeStrip, this.restIcon, this.islandEl);
    this.applyGeometry();
  }

  // ── FSM ─────────────────────────────────────────────────────────────────────

  private wireFsm() {
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    this.fsm.waiting = () => State.pendingApproval != null;
    this.fsm.onTransition = (from, to) => {
      switch (to) {
        case "hidden":
          this.setMode("hidden");
          break;
        case "petit":
          if (from === "greeting") this.greeting.interrupt();
          else if (from === "hidden") Sound.play("peek");
          this.setMode("compact");
          if (from === "greeting") State.view = State.defaultView();
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "home":
          this.expand(State.defaultView());
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
    this.fsm.launch();
  }

  // ── Mode / view ─────────────────────────────────────────────────────────────

  private setMode(mode: IslandMode) {
    const prev = State.mode;
    if (mode === prev) return;
    State.mode = mode;
    // Before the animation: an open island that was dragged away goes back to
    // the character's place, so it shrinks there and the next opening starts there.
    if ((mode === "expanded") !== (prev === "expanded")) void Bridge.setExpanded(mode === "expanded");
    if (mode === "expanded") {
      Sound.play("open");
      void this.refreshForeground();
    }
    if (prev === "expanded") {
      Sound.play("close");
      State.isPinned = false;
      // 📌 lasts for one opening: closing by hand (Esc, ✕) ends it.
      State.keepOpen = false;
      this.fsm.keepOpen = false;
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
    State.updateTask("integration_claude", "working");
    State.setPillBadge("integration_claude", null);
    if (back?.focusId && back.focusId !== State.focusId) State.setFocus(back.focusId);
    // Somebody navigated away from the card meanwhile: leave them where they are.
    if (onCard) this.setView(back?.view ?? State.defaultView());
  }

  /**
   * Closes the island. A permission request waiting for an answer is never
   * closed this way (only ✕ hands it to the terminal): the island goes back to
   * its card instead. `force` is for stepping aside on purpose (Cattura una zona).
   */
  collapse(force = false) {
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

  /** Keeps the island open (or lets it close again on its own). */
  setPinned(on: boolean) {
    State.isPinned = on;
    this.fsm.pinned = on;
    State.notify();
  }

  /** Alert from the hook server: open on this view. Pinned alerts never auto-close. */
  alert(view: IslandViewName) {
    this.fsm.pinned = State.isPinned;
    this.fsm.forceHome();
    this.expand(view);
  }

  // ── Quick actions ─────────────────────────────────────────────────────────

  /** Shows a short message in the note view, then goes back to `back`. */
  private note(message: string, back: IslandViewName = "actions") {
    State.noteMessage = message;
    this.setView("note");
    Sound.play("error");
    window.setTimeout(() => {
      if (State.view === "note") this.setView(back);
    }, 2600);
  }

  /** Starts a fresh chat about `context` and asks `question` right away. */
  private startChat(question: string, context: { label: string; text: string } | null, keepFile: boolean) {
    State.chatHistory = [];
    void Bridge.chatReset();
    State.chatText = context;
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

  /** A suggestion: copy the selection in the app in front, then ask Claude. */
  async runSuggestion(s: Suggestion, app: string) {
    Sound.play("blip");
    const text = await Bridge.captureSelection();
    if (!text) {
      this.note(`Seleziona prima il testo${app ? ` in ${app}` : ""}, poi scegli l'azione.`);
      return;
    }
    this.startChat(s.prompt, { label: app ? `Testo da ${app}` : "Testo selezionato", text }, false);
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

  /** "File caricati": list the inbox and show it. */
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
    State.chatHistory = [];
    void Bridge.chatReset();
    this.setView("choose");
  }

  /**
   * "Cattura una zona" (scheda + or its shortcut): the island steps aside, Windows'
   * snipping overlay picks the zone, and the picture opens the chat as an attached file.
   */
  async captureScreen() {
    Sound.play("blip");
    this.collapse(true);
    let file: { name: string; path: string } | null;
    try {
      file = await Bridge.captureScreen();
    } catch (err) {
      this.note(String(err).replace(/^Error:\s*/, ""), State.defaultView());
      return;
    }
    if (!file) return;
    Sound.play("approve");
    this.askAboutPicture(file);
  }

  /** A picture already in the inbox goes straight to the chat, ready for the question. */
  askAboutPicture(f: { name: string; path: string }) {
    State.droppedFile = { name: f.name, path: f.path };
    State.promptContext = { kind: "file", name: f.name, path: f.path };
    State.chatText = null;
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
            this.note("Il link deve iniziare con http:// o https://");
            return;
          }
          await Bridge.openUrl(a.target.trim());
          this.collapse();
          break;
        case "app":
          await Bridge.actionOpenApp(a.target, a.args);
          this.collapse();
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
              this.note("Rilascia prima un file sull'isola, poi scegli l'azione.");
              return;
            }
            this.startChat(a.prompt, null, true);
            return;
          }
          let context: { label: string; text: string } | null = null;
          if (a.input === "clipboard") {
            const text = await Bridge.clipboardText();
            if (!text) {
              this.note("Gli appunti sono vuoti: copia prima il testo.");
              return;
            }
            context = { label: "Testo copiato", text };
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
      this.setView(tabActions().length > 0 ? "actions" : "prompt");
    } else if (name === "ask") {
      const text = await Bridge.clipboardText();
      // A picture copied (and no text): attach it instead.
      const picture = text ? null : await Bridge.clipboardPicture();
      if (picture) this.askAboutPicture(picture);
      else this.startChat("", text ? { label: "Testo copiato", text } : null, false);
    } else if (name === "screenshot") {
      await this.captureScreen();
    } else if (name === "clipboard") {
      if (!State.settings.activeIntegrations.includes("integration_clipboard")) return;
      State.setFocus("integration_clipboard");
      this.setView("overview");
    } else if (name.startsWith("action:")) {
      const a = (State.settings.actions ?? []).find((x) => x.id === name.slice(7));
      if (a) await this.runAction(a);
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
      title: `EasyIsland ${version} è disponibile`,
      text: `Ora hai la ${current}. Installando, l'app si chiude e si riapre da sola.`,
      level: "info",
      url: "",
      install: version,
    });
  }

  private async installUpdate() {
    State.noteMessage = "Scarico l'aggiornamento…";
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
  toggleKeepOpen() {
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

  private onDragDrop(e: { type: string; paths?: string[] }) {
    if (e.type !== "over") void Bridge.log(`drag ${e.type} ${e.paths?.length ?? 0} file(s), ${this.dropState()}`);
    if (State.paused) return;
    switch (e.type) {
      case "enter":
      case "over": {
        if (State.fileDragOver) return;
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
        // The island deliberately stays open: the drag session is still alive.
        UploadSeq.exitZone();
        State.notify();
        break;
      }
      case "drop": {
        State.fileDragOver = false;
        const path = e.paths?.[0];
        if (!path) {
          this.engine.animateMorph(0);
          this.setView(State.defaultView());
          return;
        }
        this.swallow(path);
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
    const name = path.split(/[\\/]/).pop() || "file";
    State.droppedFile = { name, path, source: path };
    State.promptContext = { kind: "file", name, path };
    State.chatText = null;
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
        State.droppedFile = { name: file.name, path: file.path, source: path };
        State.promptContext = { kind: "file", name: file.name, path: file.path };
        State.notify();
      })
      .catch((err) => {
        UploadSeq.deactivate();
        State.noteMessage = String(err).replace(/^Error:\s*/, "");
        this.engine.animateMorph(0);
        this.setView("note");
        Sound.play("error");
        window.setTimeout(() => this.setView(State.defaultView()), 2400);
      });
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

  /** Placement settings, in the shape the layout helpers take. */
  private get placement(): Placement {
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

  private targetSize(): { w: number; h: number; r: number } {
    const compact = compactSize(this.placement);
    const fit = this.fit.view === State.view ? this.fit.h : 0;
    const { w, h } = islandSize(State.mode, State.view, State.chatHistory.length, compact, fit);
    let r = State.mode === "expanded" ? EXPANDED_CORNER : ROUNDED_CORNER;
    // The hover badge is a circle; a floating bar is a pill.
    if (State.mode !== "expanded" && this.placement.hoverStyle === "icon") r = compact.w / 2;
    else if (State.mode !== "expanded" && !isGlued(this.placement)) r = compact.h / 2;
    return { w, h, r };
  }

  private animateGeometry(shrinking: boolean) {
    const { w, h, r } = this.targetSize();
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
    const p = this.placement;
    const o = anchoredOrigin(p, w, hh);
    this.islandEl.style.left = `${o.x}px`;
    this.islandEl.style.top = `${o.y}px`;
    this.islandEl.style.width = `${w}px`;
    this.islandEl.style.height = `${hh}px`;
    // Square where it meets a screen edge; a floating island is rounded all round.
    const rr = Math.min(r, w / 2, hh / 2);
    this.islandEl.style.borderRadius = cornerRadii(p, rr);
    // These follow the island as it resizes, so they belong here rather than in
    // the state-driven DOM sync.
    this.miniGrid.style.left = `${w - 40 - 14.5}px`;
    this.miniGrid.style.top = `${hh / 2 - 14.5}px`;
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
  private islandRect(): { x: number; y: number; w: number; h: number } {
    const w = this.width.value;
    const hh = this.height.value;
    const o = anchoredOrigin(this.placement, w, hh);
    return { x: o.x, y: o.y, w, h: hh };
  }

  // ── Rest icon / wake strip ──────────────────────────────────────────────────

  /**
   * Places the rest icon and the wake strip against the window edges on the
   * anchored side. Using left/right/top/bottom (not absolute coordinates) keeps
   * them on the same screen pixel whether the window is the small collapsed box
   * or the full panel — both are pinned to the same corner.
   */
  private placeRestElements() {
    const p = this.placement;
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
    const p = this.placement;
    const state = State.effectiveState;
    const key = `${p.iconStyle}|${p.iconSize}|${state}|${State.paused}|${State.settings.theme.slimeColor}|${character().id}`;
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
      const ctx = this.restCanvas.getContext("2d");
      if (!ctx) return;
      const engine = new BotEngine();
      engine.bodyColor = this.themeBody();
      engine.setState(state, true);
      engine.update(0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, w);
      engine.draw(ctx, w, w);
    }
  }

  /** The character's body colour from the theme; null keeps the slime green. */
  private themeBody() {
    const c = State.settings.theme?.slimeColor;
    return c && /^#[0-9a-f]{6}$/i.test(c) ? hexToRGB(c) : null;
  }

  /**
   * "Sfondo a isola chiusa" off: while the island is not open, its background
   * goes away and only the character is left.
   */
  private applyBare() {
    const bare = State.mode !== "expanded" && State.settings.theme?.compactBackground === false;
    this.islandEl.classList.toggle("bare", bare);
  }

  /** Island colour/opacity and per-family volumes from the theme. */
  private applyTheme() {
    const t = State.settings.theme;
    setCharacter(t.character);
    const hex = /^#[0-9a-f]{6}$/i.test(t.islandColor) ? t.islandColor : "#000000";
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
      const box = collapsedBox(this.placement);
      void Bridge.setCollapsed(true, box.w, box.h);
    } else {
      void Bridge.reposition();
    }
  }

  /** Resting the pointer on the compact island opens it after `openDelay`. */
  private scheduleHoverOpen() {
    const delay = State.settings.openDelay;
    if (delay <= 0 || this.hoverOpenTimer != null || this.press) return;
    this.hoverOpenTimer = window.setTimeout(() => {
      this.hoverOpenTimer = null;
      if (State.mode !== "compact" || this.press) return;
      // Judged on the last known cursor, not on enter/leave bookkeeping: the
      // island may have grown under a pointer that never moved.
      const r = this.islandRect();
      const { x, y } = State.mouse;
      const inside = x >= r.x - HIT_MARGIN && x <= r.x + r.w + HIT_MARGIN &&
        y >= r.y - HIT_MARGIN && y <= r.y + r.h + HIT_MARGIN;
      if (inside) this.fsm.click();
    }, delay * 1000);
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
        const box = collapsedBox(this.placement);
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
    this.restIcon.addEventListener("mouseenter", wake);
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
        void Bridge.endDrag();
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
      this.fsm.click();
    };
    this.restIcon.addEventListener("pointerup", (e) => endPress(e, this.restIcon, false, openFromRest));
    this.restIcon.addEventListener("pointercancel", (e) => endPress(e, this.restIcon, true, openFromRest));

    // Compact island: a press opens on release, a drag moves it. Open island: the
    // header's empty space drags it (tabs, buttons and fields keep their clicks).
    this.islandEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const expanded = State.mode === "expanded";
      if (expanded && !this.isHeaderGrab(e.target)) return;
      startPress(e, this.islandEl, expanded);
    });
    this.islandEl.addEventListener("pointermove", movePress);
    const openFromCompact = () => {
      if (State.mode !== "expanded") this.fsm.click();
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
      if (e.key === "Escape" && State.mode === "expanded" && !State.isPinned && !State.pendingApproval) this.collapse();
      State.lastActivity = performance.now();
    });

    void onDragDrop((e) => this.onDragDrop(e));

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
      if (this.fsm.state === "home" && !State.isPinned && !State.keepOpen && !State.pendingApproval) {
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
      this.syncDom();
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
      this.drawBot(dt);
    }

    const uploadActive = this.uploadActive;
    if (uploadActive) this.uploadCanvas.draw(UploadSeq.frame(), nowMs / 1000);
    this.uploadCanvas.el.classList.toggle("on", uploadActive);
    this.viewsEl.classList.toggle("hidden-by-upload", uploadActive);

    tickMiniBots(dt);
    this.views.get(State.view)?.tick?.(nowMs);
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
        greetingActive || this.engine.busy || UploadSeq.isActive;

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
    const p = botPosition(
      State.mode, State.view, this.height.value, State.uploadProgress, compactSize(this.placement),
    );
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

    const focus = State.focusTask;
    // The character wears the focused integration's colour, unless it has a fixed
    // look (the cube keeps the logo's). Claude Code (the default focus, white for its pill) keeps the
    // character's own colour, or the slime would be white most of the time.
    const wears = focus?.isIntegration && focus.id !== "integration_claude" && character().wearsIntegrationColor;
    this.engine.bodyColor = wears ? hexToRGB(focus.color) : this.themeBody();
    this.engine.particleOverhang = BOT_OVERHANG;
    const follow = this.followsCursor();
    this.engine.lookX = follow ? this.lookX() : this.wanderLook.x;
    this.engine.lookY = follow ? this.lookY() : this.wanderLook.y;
    if (follow) this.drawnLook = { x: this.engine.lookX, y: this.engine.lookY };
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

    this.header.sync();
    for (const [name, view] of this.views) {
      const on = name === State.view;
      view.el.classList.toggle("on", on);
      if (on) view.sync();
    }

    // Views that know how tall their content is make the island grow (or
    // shrink back) to show all of it.
    if (expanded) {
      const fitH = this.views.get(State.view)?.fitHeight?.() ?? 0;
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
      } else if (wasChat) {
        void Bridge.focusWindow(false);
      }
    }

    // Compact mini grid
    const showGrid = State.mode === "compact" && this.placement.hoverStyle === "bar";
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

    // The rest icon shows only while the island is hidden — and not over a
    // full-screen app.
    const p = this.placement;
    const showRest = State.mode === "hidden" && p.iconStyle !== "none" &&
      !State.quiet;
    this.restIcon.classList.toggle("on", showRest);
    if (showRest) this.drawRestIcon();
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
    this.keepCompactUp();
    this.scheduleWander();
    State.notify();
  }

  get panelSize() {
    return { w: PANEL_W, h: PANEL_H };
  }

  get chatHeight() {
    return chatPromptHeight(State.chatHistory.length);
  }
}
