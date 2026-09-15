import { describe, expect, it, vi } from "vitest";
import { Identity } from "spacetimedb";
import {
  acceptedGeneratedBatchHits,
  damageProceduralBoss,
  ensureProceduralBoss,
  generatedMapUnlocked,
  clearProceduralProgress,
  mergeProceduralProgress,
} from "./procedural-maps";
import type { GameReducerContext } from "./index";

vi.mock(
  "spacetimedb/server",
  () => import("../../tests/helpers/spacetime-module"),
);

function harness() {
  const identity = Identity.fromString("1".padStart(64, "0"));
  const rows = (key: string): Record<string, any> => {
    const data = new Map<string, any>();
    const id = (row: any) => String(row[key]?.toHexString?.() ?? row[key]);
    const lookup = (value: any) => String(value?.toHexString?.() ?? value);
    return {
      data,
      insert: (row: any) => data.set(id(row), row),
      [key]: {
        find: (value: any) => data.get(lookup(value)) ?? null,
        update: (row: any) => data.set(id(row), row),
        delete: (value: any) => data.delete(lookup(value)),
      },
    };
  };
  const boss = rows("key"),
    progress = rows("identity"),
    contribution = rows("key");
  contribution.byBoss = {
    filter: (bossKey: string) =>
      [...contribution.data.values()].filter((r) => r.bossKey === bossKey),
  };
  contribution.byIdentity = {
    filter: (id: Identity) =>
      [...contribution.data.values()].filter((r) => r.identity.equals(id)),
  };
  const ctx = {
    sender: identity,
    timestamp: { microsSinceUnixEpoch: 1_000_000n },
    db: {
      proceduralInstanceBoss: boss,
      proceduralBoss: { mapId: { find: () => null } },
      proceduralProgress: progress,
      proceduralInstanceContribution: contribution,
      proceduralContribution: {
        byMap: { filter: () => [] },
        byIdentity: { filter: () => [] },
      },
    },
  } as unknown as GameReducerContext;
  return { ctx, identity, boss, progress, contribution };
}
describe("generated shared boss and durable unlocks", () => {
  it("requires campaign completion and the previous generated boss", () => {
    expect(generatedMapUnlocked("endless_1", 0, false)).toBe(false);
    expect(generatedMapUnlocked("endless_1", 0, true)).toBe(true);
    expect(generatedMapUnlocked("endless_3", 1, true)).toBe(false);
    expect(generatedMapUnlocked("endless_3", 2, true)).toBe(true);
  });
  it("ignores stale encounters and remote attacks, rewards a shared clear once, then respawns", () => {
    const { ctx, progress } = harness();
    const boss = ensureProceduralBoss(ctx, "endless_1", "endless_1:root"),
      reward = vi.fn();
    const options = {
      mapId: "endless_1",
      bossKey: boss.key,
      encounter: boss.encounter,
      hits: 1,
      x: 4050,
      y: 4050,
      attackRange: 600,
      attackInterval: 0.5,
      projectiles: 1,
      damage: () => boss.maxHp,
      reward,
    };
    damageProceduralBoss(ctx, { ...options, encounter: 99n });
    damageProceduralBoss(ctx, { ...options, x: 100, y: 100 });
    expect(reward).not.toHaveBeenCalled();
    damageProceduralBoss(ctx, options);
    damageProceduralBoss(ctx, options);
    expect(reward).toHaveBeenCalledTimes(1);
    expect(progress.data.values().next().value.completed).toBe(1);
    expect(ensureProceduralBoss(ctx, "endless_1", "endless_1:root").hp).toBe(0);
    Object.assign(ctx, { timestamp: { microsSinceUnixEpoch: 62_000_000n } });
    expect(
      ensureProceduralBoss(ctx, "endless_1", "endless_1:root").encounter,
    ).toBe(2n);
    damageProceduralBoss(ctx, options);
    expect(reward).toHaveBeenCalledTimes(1);
  });
  it("merges guest progression and removes reset players from pending boss rewards", () => {
    const h = harness(),
      guest = Identity.fromString("2".padStart(64, "0"));
    h.progress.insert({ identity: guest, completed: 4 });
    mergeProceduralProgress(h.ctx, guest);
    expect(h.progress.identity.find(h.identity).completed).toBe(4);
    expect(h.progress.identity.find(guest)).toBeNull();
    clearProceduralProgress(h.ctx, h.identity);
    expect(h.progress.identity.find(h.identity)).toBeNull();
  });
  it("never pays contributors from a different instance of the same map", () => {
    const h = harness(),
      second = Identity.fromString("2".padStart(64, "0"));
    const a = ensureProceduralBoss(h.ctx, "endless_1", "endless_1:a");
    const b = ensureProceduralBoss(h.ctx, "endless_1", "endless_1:b");
    const reward = vi.fn();
    const attack = {
      mapId: "endless_1",
      bossKey: a.key,
      encounter: a.encounter,
      hits: 1,
      x: 4050,
      y: 4050,
      attackRange: 600,
      attackInterval: 0.5,
      projectiles: 1,
      damage: () => a.maxHp / 2,
      reward,
    };
    damageProceduralBoss(h.ctx, attack);
    Object.assign(h.ctx, { sender: second });
    damageProceduralBoss(h.ctx, {
      ...attack,
      bossKey: b.key,
      damage: () => b.maxHp,
    });
    expect(reward).toHaveBeenCalledExactlyOnceWith(second, expect.any(Number));
    expect(h.progress.identity.find(h.identity)).toBeNull();
    expect(h.boss.key.find(a.key).hp).toBe(a.maxHp / 2);
  });
});

it("bounds batches by earned attack cycles and cannot bank idle time or replay a spent batch", () => {
  const first = acceptedGeneratedBatchHits(100, 2, 50_000n, 1_000_000n, null);
  expect(first.hits).toBe(10);
  const previous = { windowAt: first.windowAt, hits: first.priorHits + first.hits };
  expect(acceptedGeneratedBatchHits(100, 2, 50_000n, 1_000_000n, previous).hits).toBe(0);
  expect(acceptedGeneratedBatchHits(100, 2, 50_000n, 1_050_000n, previous).hits).toBe(2);
  expect(acceptedGeneratedBatchHits(100, 2, 50_000n, 100_000_000n, previous).hits).toBe(10);
  expect(acceptedGeneratedBatchHits(100, 1, 1_000_000n, 1_000_000n, null).hits).toBe(1);
});
it("records participation once in meaning, validates batch damage, and pays each contributor once", () => {
  const h = harness();
  const boss = ensureProceduralBoss(h.ctx, "endless_1", "endless_1:root");
  const reward = vi.fn(), damage = vi.fn(() => boss.maxHp / 2);
  const action = { mapId: "endless_1", bossKey: boss.key, encounter: boss.encounter,
    hits: 5, x: 4050, y: 4050, attackRange: 600, attackInterval: .05, projectiles: 1, damage, reward };
  damageProceduralBoss(h.ctx, action);
  expect([...h.contribution.data.values()][0].damage).toBe(1);
  damageProceduralBoss(h.ctx, action);
  expect(damage).toHaveBeenCalledOnce();
  Object.assign(h.ctx, { timestamp: { microsSinceUnixEpoch: 1_250_000n } });
  damageProceduralBoss(h.ctx, action);
  damageProceduralBoss(h.ctx, action);
  expect(reward).toHaveBeenCalledExactlyOnceWith(h.identity, expect.any(Number));
});
