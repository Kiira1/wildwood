import { describe, expect, it } from "vitest";
import {
  deterministicRemoteCritical,
  mixInteger,
  regularEnemySiteUnit,
  regularEnemySeededUnit,
  quantizeRegularEnemyCoordinate,
  REGULAR_ENEMY_AGGRO_EDGE_TOLERANCE,
  REGULAR_ENEMY_AGGRO_RELEASE_PADDING,
  regularEnemyAggroRetainRadius,
  regularEnemyAmbientPose,
  selectRegularEnemyAggroTarget,
} from "./regular-enemy-simulation";

describe("regular enemy deterministic contract", () => {
  it("returns one addressable ambient pose for a map, site, and server time", () => {
    const first = regularEnemyAmbientPose("tutorial_forest", 7, 1_200, 900, 1_800_000_000_000);
    const repeated = regularEnemyAmbientPose("tutorial_forest", 7, 1_200, 900, 1_800_000_000_000);
    const otherSite = regularEnemyAmbientPose("tutorial_forest", 8, 1_200, 900, 1_800_000_000_000);

    expect(repeated).toEqual(first);
    expect(otherSite).not.toEqual(first);
    expect(Math.hypot(first.x - 1_200, first.y - 900)).toBeLessThanOrEqual(72);
  });

  it("selects the same closest target independent of input order", () => {
    const candidates = [
      { id: "player-b", x: 110, y: 100, radius: 17, local: false },
      { id: "player-a", x: 90, y: 100, radius: 17, local: true },
    ];
    const options = { enemyX: 100, enemyY: 100, acquireRadius: 50, retainRadius: 100 };

    expect(selectRegularEnemyAggroTarget({ ...options, candidates })?.id).toBe("player-a");
    expect(selectRegularEnemyAggroTarget({ ...options, candidates: [...candidates].reverse() })?.id).toBe("player-a");
  });

  it("keeps a current target through small interpolation differences", () => {
    const candidates = [
      { id: "current", x: 130, y: 100, radius: 17, local: false },
      { id: "challenger", x: 120, y: 100, radius: 17, local: true },
    ];
    expect(selectRegularEnemyAggroTarget({
      enemyX: 100,
      enemyY: 100,
      acquireRadius: 80,
      retainRadius: 140,
      currentTargetId: "current",
      candidates,
    })?.id).toBe("current");
  });

  it("honors a player's attack edge without losing an in-range pose to quantization", () => {
    const enemyX = 1.9;
    const playerX = 156.8;
    expect(playerX - enemyX).toBeLessThan(155);
    expect(selectRegularEnemyAggroTarget({
      enemyX,
      enemyY: 100,
      acquireRadius: 140,
      retainRadius: 420,
      candidates: [{
        id: "ranged-player",
        x: playerX,
        y: 100,
        radius: 17,
        local: false,
        acquireRadius: 155 + REGULAR_ENEMY_AGGRO_EDGE_TOLERANCE,
      }],
    })?.id).toBe("ranged-player");
  });

  it("keeps release beyond acquisition even when the authored leash is smaller", () => {
    expect(regularEnemyAggroRetainRadius(460, 420)).toBe(460 + REGULAR_ENEMY_AGGRO_RELEASE_PADDING);
    expect(regularEnemyAggroRetainRadius(140, 900)).toBe(900);
  });

  it("seeds remote critical hits from engagement and attack identity", () => {
    const first = deterministicRemoteCritical("water_reach", 4, "player", 12345, 7);
    expect(deterministicRemoteCritical("water_reach", 4, "player", 12345, 7)).toBe(first);
  });
});

describe("mixInteger", () => {
  // The string hash it stands in for, as regularEnemySeededUnit hashed numbers before.
  const viaString = (hash: number, value: number) => {
    let mixed = hash >>> 0;
    for (const char of `${Math.trunc(value)}`) mixed = Math.imul(mixed ^ char.charCodeAt(0), 0x01000193);
    return mixed >>> 0;
  };
  it("hashes a number exactly as its decimal string", () => {
    const values = [0, -0, 1, -1, 9, 10, 99, 100, -0.5, 0.5, 7.9, -7.9, 1e6, 123456789, 1_792_287_080_000, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER,
      2 ** 60, -(2 ** 60), 1e21, NaN, Infinity, -Infinity];
    for (let i = 0; i < 2_000; i++) values.push(Math.floor((Math.random() - .5) * 10 ** (1 + Math.floor(Math.random() * 15))));
    for (const value of values) for (const hash of [0, 1, 0x811c9dc5, 0xffffffff]) expect(mixInteger(hash, value)).toBe(viaString(hash, value));
  });
});

describe("selectRegularEnemyAggroTarget in one pass", () => {
  type Candidate = { id: string; x: number; y: number; acquireRadius?: number };
  // The copy-and-sort version it replaced.
  const sorted = (options: { enemyX: number; enemyY: number; acquireRadius: number; retainRadius: number; currentTargetId?: string | null; candidates: Candidate[] }) => {
    const q = quantizeRegularEnemyCoordinate;
    const d2 = (c: Candidate) => (q(c.x) - q(options.enemyX)) ** 2 + (q(c.y) - q(options.enemyY)) ** 2;
    const acquire = Math.max(0, options.acquireRadius), retain = Math.max(acquire, options.retainRadius);
    const ordered = [...options.candidates].sort((a, b) => (d2(a) - d2(b)) || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1));
    const best = ordered.find(c => { const r = Math.max(0, c.acquireRadius ?? acquire); return d2(c) <= r * r; }) ?? null;
    const current = options.currentTargetId ? ordered.find(c => c.id === options.currentTargetId) ?? null : null;
    if (!current || d2(current) > retain * retain) return best;
    if (!best || best.id === current.id) return current;
    return Math.sqrt(d2(best)) + 24 < Math.sqrt(d2(current)) ? best : current;
  };
  it("picks what sorting picked", () => {
    for (let round = 0; round < 3_000; round++) {
      const candidates: Candidate[] = Array.from({ length: Math.floor(Math.random() * 6) }, (_, i) => ({
        id: `p${Math.floor(Math.random() * 4)}${i % 2}`, x: Math.round(Math.random() * 40) * 10, y: Math.round(Math.random() * 40) * 10,
        ...(Math.random() < .3 ? { acquireRadius: Math.random() * 300 } : {}),
      }));
      const options = { enemyX: 200, enemyY: 200, acquireRadius: 150, retainRadius: 260, currentTargetId: Math.random() < .7 ? candidates[0]?.id ?? null : null, candidates };
      expect(selectRegularEnemyAggroTarget(options)).toBe(sorted(options));
    }
  });
});

describe("regularEnemySiteUnit", () => {
  it("is regularEnemySeededUnit for three and four parts", () => {
    for (let i = 0; i < 2_000; i++) {
      const map = ["town", "ion_citadel", "endless_36", ""][i % 4], site = Math.floor(Math.random() * 400) - 5, segment = Math.floor(Math.random() * 1e9) - 10;
      expect(regularEnemySiteUnit("ambient-angle", map, site, segment)).toBe(regularEnemySeededUnit("ambient-angle", map, site, segment));
      expect(regularEnemySiteUnit("ambient-phase", map, site)).toBe(regularEnemySeededUnit("ambient-phase", map, site));
    }
  });
});
