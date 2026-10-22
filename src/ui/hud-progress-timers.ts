import { formatTimerMs } from "../../shared/timer-format";
import type { ActiveItemUpgrade } from "../wildstat-coop";
import type { ActiveResearch } from "./tech-tree-controller";
import { setAttr, setHidden, setText } from "./dom-write";

type TimerElements = {
  research: HTMLElement;
  slotOne: HTMLElement;
  slotTwo: HTMLElement;
  slotThree: HTMLElement;
};

type TimerSources = {
  connected: () => boolean;
  research: () => ActiveResearch | null;
  upgrades: () => ActiveItemUpgrade[];
  visible: () => { research: boolean; slotOne: boolean; slotTwo: boolean; slotThree: boolean };
  nowMs?: () => number;
};

export function hudProgressTimers(
  connected: boolean,
  research: ActiveResearch | null,
  upgrades: readonly ActiveItemUpgrade[],
  nowMs: number,
) {
  const active = connected ? upgrades : [];
  const slot = (number: 1 | 2 | 3) => {
    const job = active.find((upgrade) => upgrade.slot === number);
    if (!job) return null;
    const remaining = job.paused ? job.remainingMs : job.completesAtMs - nowMs;
    return { remaining: formatTimerMs(remaining), paused: job.paused };
  };
  return {
    research: connected && research ? formatTimerMs(research.completesAtMs - nowMs) : null,
    slotOne: slot(1),
    slotTwo: slot(2),
    slotThree: slot(3),
  };
}

export function createHudProgressTimers(elements: TimerElements, sources: TimerSources) {
  const render = (element: HTMLElement, label: string, remaining: string | null, paused = false) => {
    setHidden(element, remaining === null);
    if (remaining === null) return;
    setText(element, `${label} ${remaining}`);
    setAttr(element, "aria-label", `${label === "Tech" ? "Tech research" : `Slot Upgrade ${label}`} ${paused ? "paused with" : "finishes in"} ${remaining}`);
  };

  function tick() {
    const timers = hudProgressTimers(sources.connected(), sources.research(), sources.upgrades(), (sources.nowMs ?? Date.now)());
    const visible = sources.visible();
    render(elements.research, "Tech", visible.research ? timers.research : null);
    render(elements.slotOne, "Queue 1", visible.slotOne ? timers.slotOne?.remaining ?? null : null, timers.slotOne?.paused);
    render(elements.slotTwo, "Queue 2", visible.slotTwo ? timers.slotTwo?.remaining ?? null : null, timers.slotTwo?.paused);
    render(elements.slotThree, "Queue 3", visible.slotThree ? timers.slotThree?.remaining ?? null : null, timers.slotThree?.paused);
  }

  tick();
  return { tick };
}
