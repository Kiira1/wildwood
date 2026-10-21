import { resolve } from "node:path";
import { defineConfig } from "vite";

// The offline visual checker (tools/visual-check). Built apart from the client, into a
// gitignored folder; capture.mjs serves it with public/ behind it for the art.
const outDir = process.env.VISUAL_CHECK_OUT_DIR
  ? resolve(process.env.VISUAL_CHECK_OUT_DIR)
  : resolve(import.meta.dirname, "../local-data/visual-check-build");

export default defineConfig({
  root: resolve(import.meta.dirname, "../tools/visual-check"),
  publicDir: false,
  base: "./",
  cacheDir: `${outDir}-cache`,
  build: {
    outDir,
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, "../tools/visual-check/visual-check.html"),
      output: {
        entryFileNames: "visual-check/[name]-[hash].js",
        chunkFileNames: "visual-check/[name]-[hash].js",
        assetFileNames: "visual-check/[name]-[hash][extname]",
      },
    },
  },
});
