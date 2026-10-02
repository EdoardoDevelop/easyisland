import { defineConfig } from "vite";
import { resolve } from "node:path";

// The sounds are synthesised in code (src/core/synth.ts): there are no audio files to serve.

export default defineConfig({
  clearScreen: false,
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
      },
    },
  },
});
