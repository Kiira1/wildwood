import { resolve } from "node:path";
import { defineConfig } from "vite";
import { scanVendorWeapons } from "../scripts/sprite-aligner-vendor";
import { spriteAlignerStorage } from "../scripts/sprite-aligner-storage";

const repo = resolve(import.meta.dirname, "..");
const weapons = scanVendorWeapons(repo);

// Serve repo-native source and the optional vendor library on loopback only.
export default defineConfig({
  root: resolve(import.meta.dirname, ".."),
  publicDir: false,
  define: { __WILDSTAT_VENDOR_WEAPONS__: JSON.stringify(weapons) },
  plugins: [spriteAlignerStorage(repo, new Set(weapons.map(weapon => weapon.id)))],
  server: {
    host: "127.0.0.1", port: 4174, strictPort: true,
    watch: { usePolling: true, interval: 1000,
      ignored: ["**/art-source/**", "**/public/assets/**", "**/mobile/**", "**/local-data/**", "**/dist/**"] },
  },
  build: {
    outDir: resolve(import.meta.dirname, "../local-data/sprite-aligner-build"),
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, "../public/sprite-aligner.html") },
  },
});
