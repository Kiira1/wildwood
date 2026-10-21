// Offline visual checker: draws the game's own renderers from fake state, one scene per URL hash.
// Clocks and randomness are pinned before any game module loads, so every capture is the same frame.
import { installDeterminism } from "./determinism";

declare global {
  interface Window {
    __visualReady?: boolean;
    __visualError?: string;
    __visualScenes?: readonly string[];
  }
}

installDeterminism();

async function run() {
  const scene = decodeURIComponent(location.hash.replace(/^#/, "")) || "plates";
  const { SCENES } = await import("./scenes");
  window.__visualScenes = Object.keys(SCENES);
  const draw = SCENES[scene];
  if (!draw) throw new Error(`Unknown scene "${scene}". Scenes: ${Object.keys(SCENES).join(", ")}`);
  document.title = `Visual Check: ${scene}`;
  await draw();
  window.__visualReady = true;
}

run().catch(error => {
  console.error(error);
  window.__visualError = String(error?.stack ?? error);
  const pre = document.createElement("pre");
  pre.style.cssText = "color:#ff8080;white-space:pre-wrap;padding:8px";
  pre.textContent = window.__visualError;
  document.body.append(pre);
  window.__visualReady = true;
});
