import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// The built page must work when opened straight off disk by double-clicking, which is how
// tools/serial-config.html has always been used.
//
// `file://` *is* a secure context - the W3C potentially-trustworthy algorithm returns true for the
// file scheme and Chromium implements that - so navigator.serial is available. What does not survive
// is anything that fetches: an opaque (null) origin makes CORS reject `<script src>`, dynamic
// import() and any fetch of a sibling asset. Hence everything inlined, one classic script, no code
// splitting, no runtime source maps, and no webfont from a CDN (see theme.ts).
const classicScriptTag = (): Plugin => ({
  name: "classic-script-tag",
  // Build only. In dev, Vite serves the entry as a real ES module (`<script type="module"
  // src="/src/main.tsx">`) and strips nothing - removing the attribute there makes the browser parse
  // TSX as a classic script, which fails immediately and renders a blank page.
  apply: "build",
  enforce: "post",
  // viteSingleFile() inlines the bundle but leaves type="module" on the tag. An inline module script
  // does run from file:// since nothing is fetched, but the output is a single IIFE by then, so
  // dropping the attribute removes the question entirely.
  transformIndexHtml: (html) => html.replace(/<script type="module"/g, "<script"),
});

// The shipped tool. This build *is* tools/serial-config.html now.
const SHIPPED_PATH = "../serial-config.html";

// package.json sets "type": "module", so the config is ESM and __dirname does not exist.
const here = fileURLToPath(new URL(".", import.meta.url));

const publishSingleFile = (): Plugin => ({
  name: "publish-single-file",
  apply: "build",
  closeBundle() {
    const from = resolve(here, "dist/index.html");
    const to = resolve(here, SHIPPED_PATH);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    this.info(`published ${to}`);
  },
});

// Vite's watcher only covers this root, so an edit inside a board folder reaches the dev server
// not at all. A full reload rather than an update: the sheets come in through an eager glob at
// module scope, which produces no HMR of its own.
const OUTSIDE_ROOT = ["../../boards"];

const watchOutsideRoot = (): Plugin => ({
  name: "watch-outside-root",
  apply: "serve",
  configureServer(server) {
    const dirs = OUTSIDE_ROOT.map((dir) => resolve(here, dir));
    server.watcher.add(dirs);
    server.watcher.on("change", (file) => {
      const changed = resolve(file);
      if (!dirs.some((dir) => changed.startsWith(dir))) return;
      server.hot.send({ type: "full-reload" });
      server.config.logger.info(`page reload ${relative(here, changed)}`, { timestamp: true });
    });
  },
});

export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
    classicScriptTag(),
    publishSingleFile(),
    watchOutsideRoot(),
  ],
  server: {
    // Every board lives in trifolium/boards/<id>/ - its wiring and its two drawings - outside
    // this root and imported so the build inlines them, because a folder of JSON/SVG beside the
    // HTML would not survive file://. A build resolves them regardless; the dev server refuses to
    // serve outside the root without this.
    fs: { allow: [here, ...OUTSIDE_ROOT.map((dir) => resolve(here, dir))] },
  },
  build: {
    target: "es2020",
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000, // never emit a separate asset file
    rollupOptions: {
      // One classic script, no chunks. viteSingleFile() already disables code splitting, which is
      // what makes inlineDynamicImports redundant - setting it as well only earns a warning.
      output: { format: "iife" },
    },
  },
});
