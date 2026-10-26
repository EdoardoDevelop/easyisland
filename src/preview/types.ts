// What preview.rs sends the preview's page.

export interface PreviewTab {
  id: number;
  kind: "web" | "file";
  /** The address or the file's full path. */
  target: string;
  title: string;
  /** A file drawn by the browser (HTML, PDF, SVG). */
  browser: boolean;
  loading: boolean;
  errors: number;
}

export interface PreviewView {
  preset: "fit" | "desktop" | "tablet" | "mobile" | "custom";
  width: number;
  height: number;
  /** "" = the page's own. */
  scheme: "" | "light" | "dark";
}

export interface PreviewState {
  tabs: PreviewTab[];
  active: number;
  view: PreviewView;
  /** Stuck to the island: no frame, so the page has its own ✕. */
  docked?: boolean;
}

export interface FileView {
  kind: "text" | "image" | "binary" | "missing" | "big";
  path: string;
  name: string;
  ext: string;
  size: number;
  text: string;
  dataUrl: string;
  /** The text before the chat changed it. */
  before: string | null;
  /** Seconds since 1970. */
  modified: number;
}

export interface ConsoleLine {
  level: "log" | "info" | "warn" | "error" | "debug";
  text: string;
  at: string;
}

export interface DevServer {
  url: string;
  port: number;
  process: string;
}
