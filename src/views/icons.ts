// SVG paths standing in for the SF Symbols used by the macOS island.
// Drawn on a 24×24 grid so they read at the same optical size.

export const ICONS = {
  // minus — minimize the island as an app
  minimize: "M5 11h14v2H5z",
  // square / two squares — full screen on and off
  maximize: "M5 5h14v14H5V5zm2 2v10h10V7H7z",
  restore: "M8 4h12v12h-3v3H5V8h3V4zm2 2v2h7v7h1V6h-8zM7 10v7h8v-7H7z",
  // house.fill
  house: "M12 3.2 2.8 10.6V21h6.6v-5.4h5.2V21h6.6V10.6L12 3.2z",
  // bubble.left.fill
  bubble: "M12 3.6c-5 0-9 3.3-9 7.4 0 2.3 1.3 4.4 3.3 5.7-.2 1.2-.8 2.4-1.7 3.4 1.9-.2 3.6-.9 4.9-1.9 .8.2 1.6.3 2.5.3 5 0 9-3.3 9-7.5s-4-7.4-9-7.4z",
  // bolt.fill — quick actions
  bolt: "M13.5 2 4.5 13.5h6l-1.5 8.5 9-11.5h-6L13.5 2z",
  // Claude's asterisk-like spark — the Claude Code tab
  spark: "M11 2h2l.6 6.2 4.4-4.4 1.4 1.4-4.4 4.4L22 11v2l-6.2.6 4.4 4.4-1.4 1.4-4.4-4.4L13 22h-2l-.6-6.2-4.4 4.4-1.4-1.4 4.4-4.4L2 13v-2l6.2-.6-4.4-4.4 1.4-1.4 4.4 4.4L11 2z",
  // terminal prompt ">_" — the Agenti tab (coding agents: Claude Code, Codex, opencode…)
  terminal: "M3 5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-13zm4.2 3.3-1.4 1.4 2.8 2.8-2.8 2.8 1.4 1.4 4.2-4.2-4.2-4.2zM12 15.5v2h6v-2h-6z",
  // plus
  plus: "M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4z",
  // book.closed with a person, drawn as a stroke — the 3CX phonebook tab
  book: "M6.5 3h11a1.5 1.5 0 0 1 1.5 1.5v15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3zM12 8a2.2 2.2 0 1 1 0 4.4A2.2 2.2 0 0 1 12 8zM8.6 16.8c.6-1.7 1.9-2.6 3.4-2.6s2.8.9 3.4 2.6M3.5 7.5H5M3.5 12H5M3.5 16.5H5",
  // slider.horizontal.3 — Impostazioni (opens the settings window)
  sliders: "M3 5.2h18v1.6H3zM8 3.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6zM3 11.2h18v1.6H3zM16 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6zM3 17.2h18v1.6H3zM10 15.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z",
  // speaker.wave.2
  speakerOn: "M11 4.5 6.5 8.2H3.4v7.6h3.1L11 19.5v-15zm3.2 3a5.3 5.3 0 0 1 0 9 .9.9 0 0 0 .9 1.55 7.1 7.1 0 0 0 0-12.1.9.9 0 0 0-.9 1.55zm2.6-3.1a8.9 8.9 0 0 1 0 15.2.9.9 0 0 0 .92 1.55 10.7 10.7 0 0 0 0-18.3.9.9 0 0 0-.92 1.55z",
  // speaker.slash
  speakerOff: "M11 4.5 6.5 8.2H3.4v7.6h3.1L11 19.5v-15zm3.6 4.1 1.27-1.27 2.33 2.33 2.33-2.33 1.27 1.27L19.47 11l2.33 2.33-1.27 1.27-2.33-2.33-2.33 2.33-1.27-1.27L16.93 11 14.6 8.6z",
  // arrow.up.right
  arrowUpRight: "M8.5 7h8.5v8.5h-2V10.4l-7.1 7.1-1.4-1.4 7.1-7.1H8.5V7z",
  // chevron.right
  chevronRight: "M9 5.5 15.5 12 9 18.5",
  chevronLeft: "M15 5.5 8.5 12 15 18.5",
  // checkmark
  check: "M5 12.5 9.5 17 19 7.5",
  // arrow.up (send)
  arrowUp: "M12 4.5 5.5 11l1.5 1.5 4-4V19.5h2V8.5l4 4L18.5 11 12 4.5z",
  // exclamationmark
  bang: "M11 4h2v10h-2V4zm0 12.2h2v2.2h-2v-2.2z",
  // xmark
  xmark: "M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5z",
  // clock.arrow.circlepath — the chat history (draw with a stroke)
  history: "M4.2 12a7.8 7.8 0 1 0 2.3-5.5M4.2 3.8v3.6h3.6M12 7.8v4.6l3 1.8",
  // ellipsis
  ellipsis: "M6 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zm6 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zm6 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z",
  // star.fill
  star: "M12 3.2l2.6 5.55 5.9.82-4.3 4.3 1.05 6.13L12 17.1l-5.25 2.9L7.8 13.87 3.5 9.57l5.9-.82L12 3.2z",
  // square.stack.fill
  stack: "M5 8h14v11.5H5V8zm1.8-3h10.4v1.6H6.8V5zm1.6-2.6h7.2V4H8.4V2.4z",
  // doc.text
  // Musica / Appunti
  play: "M8 5.2v13.6L19 12 8 5.2z",
  pause: "M6.5 5h4v14h-4V5zm7 0h4v14h-4V5z",
  stop: "M7 7h10v10H7z",
  prev: "M6 5h2v14H6V5zm3.5 7L19 5.2v13.6L9.5 12z",
  next: "M16 5h2v14h-2V5zM5 5.2 14.5 12 5 18.8V5.2z",
  pin: "M14.6 2.8 21.2 9.4l-1.4 1.4-1-.6-3.7 3.7.3 4.1-1.4 1.4-3.6-3.6-4.6 4.6-1.3-1.3 4.6-4.6-3.6-3.6L6.9 9.5l4.1.3 3.7-3.7-.6-1 1.4-1.4z",
  copy: "M8 3h11v13h-2V5H8V3zM4.5 7h11v14h-11V7zm2 2v10h7V9h-7z",
  phone: "M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.12.37 2.33.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8z",
  hangup: "M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a1 1 0 0 1-1.41-.01L.29 13.08a1 1 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67a1 1 0 0 1 0 1.41l-2.48 2.48a1 1 0 0 1-1.41.01 11.3 11.3 0 0 0-2.67-1.85 1 1 0 0 1-.56-.9v-3.1A14.7 14.7 0 0 0 12 9z",
  doc: "M6.5 2.6h7l4 4v14.8h-11V2.6zm6.6 1.6v3.3h3.3l-3.3-3.3zM8.6 11h6.8v1.5H8.6V11zm0 3.4h6.8v1.5H8.6v-1.5z",
  // person.2.fill — 3CX team
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm0 1.5c-3.6 0-6.5 1.9-6.5 4.3V19h13v-2.2c0-2.4-2.9-4.3-6.5-4.3zM16.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm.7 1.6c1.9.6 3.3 1.9 3.3 3.6V19h3V16.8c0-2.2-2.4-4-6.3-4.2z",
  // arrowshape.turn.up.right.fill — transfer a call
  forward: "M13 5v4.2C6.8 9.8 4 13.6 3 19c2.4-3.4 5.4-4.8 10-4.8V19l8-7-8-7z",
  // recordingtape — voicemail (drawn with a stroke)
  voicemail: "M6.5 16.5a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm11 0a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM6.5 16.5h11",
  // paperplane.fill — send a chat message
  send: "M3 11.2 20.5 3.5 13 21l-2.3-7.7L3 11.2zm7.9 1.6 1.3 4.4 4.4-10.1-5.7 5.7z",
  // magnifyingglass — the search bar
  search: "M10.5 3.5a7 7 0 0 1 5.6 11.2l4.6 4.6-1.4 1.4-4.6-4.6A7 7 0 1 1 10.5 3.5zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
  // square.grid — a program of the Start menu
  apps: "M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z",
  // phone.arrow.down.left — 3CX missed calls (drawn with a stroke)
  missed: "M3.5 7.5 10 14l4.5-4.5L20.5 15.5M20.5 10v5.5H15",
  // mic / mic.slash — mute on a call of "Questo PC" (drawn with a stroke)
  mic: "M12 3.5a2.8 2.8 0 0 0-2.8 2.8v5.4a2.8 2.8 0 0 0 5.6 0V6.3A2.8 2.8 0 0 0 12 3.5zM6 11.2a6 6 0 0 0 12 0M12 17.2v3.3",
  micOff: "M12 3.5a2.8 2.8 0 0 0-2.8 2.8v5.4a2.8 2.8 0 0 0 5.6 0V6.3A2.8 2.8 0 0 0 12 3.5zM6 11.2a6 6 0 0 0 12 0M12 17.2v3.3M4 4l16 16",
  // bell / bell.slash — the island's notice of an incoming call (drawn with a stroke)
  bell: "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15L6 16.5zM10 20.5h4",
  bellOff: "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15L6 16.5zM10 20.5h4M4 4l16 16",
  // delete.left — the keypad's backspace (drawn with a stroke)
  backspace: "M9 5.5h10.5v13H9L3.5 12 9 5.5zM12 9.5l5 5M17 9.5l-5 5",
} as const;

/** Line glyphs (draw with a 1.6 stroke) for the integrations with no brand logo,
 *  in the Windows 11 look where the classic one shows their emoji (markIcon in dom.ts). */
export const LINE_ICONS: Record<string, string> = {
  integration_network: "M2.5 9a14 14 0 0 1 19 0M5.5 12.3a9.5 9.5 0 0 1 13 0M8.6 15.5a5 5 0 0 1 6.8 0M12 19h.01",
  integration_weather: "M8 2.8v1.5M3.3 7.5H1.8M4.7 4.2l1 1M11.3 4.2l-1 1M5 10.8A3.4 3.4 0 1 1 11.4 6.6M7 20h10a3.8 3.8 0 0 0 .4-7.6 5 5 0 0 0-9.6 1.4A3.1 3.1 0 0 0 7 20z",
  integration_clipboard: "M9 3.5h6v3H9zM9 5H6.5A1.5 1.5 0 0 0 5 6.5v13A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 17.5 5H15M8.5 11h7M8.5 14.5h5",
  integration_media: "M9 18V5.5l10-2V16M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z",
  integration_claude_usage: "M4 20h16M7 16.5V11M12 16.5V5.5M17 16.5V13",
  integration_rdm: "M3.5 4.5h17v11h-17zM9 20h6M12 15.5V20",
  integration_teams: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5M16 11a2.5 2.5 0 1 0 0-5M17.5 14.6c1.8.5 3 2.1 3 4.4",
  integration_recorder: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  integration_system: "M7 7h10v10H7zM10 10h4v4h-4zM9.5 3.5V7M14.5 3.5V7M9.5 17v3.5M14.5 17v3.5M3.5 9.5H7M3.5 14.5H7M17 9.5h3.5M17 14.5h3.5",
  integration_security: "M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6L12 3zM9 12l2.2 2.2L15.5 10",
  integration_telegram: "M21 4 3 11l6.5 2.5L18 7l-6.5 7.5 6 5.5L21 4z",
  integration_remote: "M3.5 4.5h17v11h-17zM9 20h6M12 15.5V20M9.5 10h5M12.5 8l2 2-2 2",
};

/** The menu's sections drawn as lines (1.6 stroke) for the Windows 11 look (rail.ts). */
export const LINE_SECTIONS = {
  house: "M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4z",
  bubble: "M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z",
  bolt: "M13.5 2.5 5 13.5h6l-1 8 8.5-11h-6z",
  stack: "M8 3.5h6.5l4 4V17H8zM14.5 3.5v4h4M5 7v13.5h10",
  terminal: "M4.5 4.5h15a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM7.5 9.5l3 2.5-3 2.5M12.5 15h4",
};
