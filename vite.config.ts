import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
// @ts-expect-error plain JS helper
import { lightTheme } from "./scripts/light-css.mjs";

// The sounds are synthesised in code (src/core/synth.ts): there are no audio files to serve.

/** npm run dev: the libraries of the integrations' pages (custom.rs PAGE_LIBS) at /lib/…, as Rust serves them in the app. */
function pageLibs() {
  const libs: Record<string, string> = {
    "chart.js": "node_modules/chart.js/dist/chart.umd.min.js",
    "preact.js": "node_modules/htm/preact/standalone.umd.js",
  };
  return {
    name: "easyisland-page-libs",
    configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: { setHeader: (k: string, v: string) => void; end: (b: Buffer) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.match(/^\/lib\/([\w.-]+)$/)?.[1];
        const file = name ? libs[name] : undefined;
        if (!file) return next();
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.end(readFileSync(resolve(__dirname, file)));
      });
    },
  };
}

export default defineConfig({
  clearScreen: false,
  // The light theme: a light copy of the island's and settings' CSS (scripts/light-css.mjs).
  plugins: [lightTheme(), pageLibs()],
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    // Cargo's output (a running or half-written .exe is locked) crashed the
    // watcher with EBUSY during every Rust build.
    watch: { ignored: ["**/target/**", "**/release/**", "**/src-tauri/**", "**/hook/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "chrome110",
    minify: "esbuild",
    sourcemap: false,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        island: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html"),
        memoria: resolve(__dirname, "memoria.html"),
        flussi: resolve(__dirname, "flussi.html"),
        anteprima: resolve(__dirname, "anteprima.html"),
        personaggio: resolve(__dirname, "personaggio.html"),
        barra: resolve(__dirname, "barra.html"),
      },
    },
  },
});
