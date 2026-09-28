import { execSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// The built page must work when opened straight off disk by double-clicking, which is how the
// console has always been used.
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

// The build is dist/index.html. The release workflow publishes it; nothing local does.

// package.json sets "type": "module", so the config is ESM and __dirname does not exist.
const here = fileURLToPath(new URL(".", import.meta.url));

// Where this build came from, and where the published site is. The release workflow sets all four;
// a local build stamps its own commit, marked as local, and points at the project's site.
const gitCommit = (): string => {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: here }).toString().trim();
  } catch {
    return "unknown";
  }
};
const BUILD = {
  commit: process.env.TRIFOLIUM_BUILD_COMMIT?.slice(0, 7) ?? `${gitCommit()}-local`,
  date: process.env.TRIFOLIUM_BUILD_DATE ?? new Date().toISOString().slice(0, 10),
  siteUrl: process.env.TRIFOLIUM_SITE_URL ?? "https://davidpyo.github.io/trifolium-controller/",
  repoUrl: process.env.TRIFOLIUM_REPO_URL ?? "https://github.com/davidpyo/trifolium-controller",
};

// Vite's watcher only covers this root, so an edit to a board or a blaster reaches the dev server
// not at all. A full reload rather than an update: the sheets come in through an eager glob at
// module scope, which produces no HMR of its own.
const OUTSIDE_ROOT = ["../../boards", "../../blasters"];

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
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [
    react(),
    viteSingleFile(),
    classicScriptTag(),
    watchOutsideRoot(),
  ],
  server: {
    // The boards (trifolium/boards/<id>/, each its wiring and two drawings) and the blasters
    // (trifolium/blasters/) live outside this root, imported so the build inlines them, because a
    // folder of JSON/SVG beside the HTML would not survive file://. A build resolves them
    // regardless; the dev server refuses to serve outside the root without this.
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
