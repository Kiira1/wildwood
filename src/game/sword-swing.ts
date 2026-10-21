import { WHIRLWIND_SECONDS, WHIRLWIND_TICKS } from "../../shared/sword-skills";
import { ATTACK_ANIMATION_SECONDS, ATTACK_WINDUP_SECONDS } from "./attack-timeline";

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// The hand swings on an arm from the shoulder; offsets are from the resting grip, facing right.
const ARM = 30, ARM_REST = 79 * Math.PI / 180;
const SHOULDER_X = -ARM * Math.cos(ARM_REST), SHOULDER_Y = -ARM * Math.sin(ARM_REST);
const RAISED = { arm: -145, blade: -145 }, STRIKE = { arm: 35, blade: 40 }, FOLLOW = { arm: 70, blade: 75 };
const REST = { arm: 79, blade: -28 };
const BEHIND_UNTIL = .055;
export type SwordSwingPose = { angle: number; trail: number; gripX?: number; gripY?: number; behind?: boolean };
/** Shares the normal attack clock: starts raised over the head and chops down to land at the damage release. */
export function swordSwingPose(throwClock: number): SwordSwingPose {
  if (throwClock <= 0) return { angle: REST.blade, trail: 0 };
  const elapsed = Math.max(0, ATTACK_ANIMATION_SECONDS - throwClock);
  let from = RAISED, to = STRIKE, t: number;
  if (elapsed < ATTACK_WINDUP_SECONDS) t = (elapsed / ATTACK_WINDUP_SECONDS) ** 2;
  else if (elapsed < .19) { from = STRIKE; to = FOLLOW; t = 1 - (1 - (elapsed - ATTACK_WINDUP_SECONDS) / .07) ** 2; }
  else { from = FOLLOW; to = REST; t = smooth(Math.min(1, (elapsed - .19) / .23)); }
  const arm = lerp(from.arm, to.arm, t) * Math.PI / 180;
  const trail = elapsed >= .04 && elapsed < .21 ? Math.sin((elapsed - .04) / .17 * Math.PI) : 0;
  return {
    angle: lerp(from.blade, to.blade, t), trail,
    gripX: SHOULDER_X + ARM * Math.cos(arm), gripY: SHOULDER_Y + ARM * Math.sin(arm), behind: elapsed < BEHIND_UNTIL,
  };
}

export function drawSwordTrail(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, angle: number, opacity: number) {
  if (opacity <= 0) return;
  ctx.save();
  ctx.lineCap = "round";
  for (const [width, alpha] of [[12, .12], [6, .28], [2, .85]]) {
    ctx.globalAlpha *= alpha * opacity;
    ctx.strokeStyle = "#f3f7ff";
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.arc(x, y, radius, angle - 1.15, angle); ctx.stroke();
    ctx.globalAlpha /= alpha * opacity;
  }
  ctx.restore();
}

/** Three complete turns, driven by combat time rather than the normal swing clock. */
export function swordWhirlwindPose(remaining: number): SwordSwingPose | null {
  if (remaining <= 0) return null;
  const progress = 1 - Math.min(1, remaining / WHIRLWIND_SECONDS);
  return { angle: progress * 360 * WHIRLWIND_TICKS - 28, trail: Math.min(1, remaining / .08) };
}
