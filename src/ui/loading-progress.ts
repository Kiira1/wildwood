type Fill = { style: { width: string } };

const TICK_MS = 250;

/**
 * The start screen's one loading bar, shared by the shell and the game.
 * It sits at what is really done and creeps toward the step in progress,
 * never reaching it until that step finishes, and never moves back.
 */
export function createLoadingProgress(fill: Fill) {
  let done = 0;
  let next = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const shown = () => Number.parseFloat(fill.style.width) || 0;
  const paint = (percent: number) => { fill.style.width = `${Math.round(percent * 10) / 10}%`; };

  function stop() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function tick() {
    timer = null;
    const current = shown();
    // Most of the way, never all of it: the step itself says when it is done.
    const limit = done + (next - done) * 0.9;
    if (current >= limit - 0.1) return;
    paint(Math.max(done, current + (limit - current) * 0.12));
    timer = setTimeout(tick, TICK_MS);
  }

  return {
    /** `finished` percent is done; creep toward `working` while the next step runs. */
    advance(finished: number, working = finished) {
      done = Math.max(finished, 0);
      next = Math.max(working, done);
      if (shown() < done || !fill.style.width) paint(Math.max(shown(), done));
      if (timer === null) timer = setTimeout(tick, TICK_MS);
    },
    /** Shows exactly this much (a failure or a fresh start) and stops creeping. */
    set(percent: number) {
      stop();
      done = next = percent;
      paint(percent);
    },
    stop,
  };
}
