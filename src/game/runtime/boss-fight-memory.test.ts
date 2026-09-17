import { expect, it, vi } from "vitest";
import { createBossFightMemory } from "./boss-fight-memory";
import { createPersonalBosses } from "./personal-bosses";

function fixture(map = "tutorial_forest") {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
    removeItem: (key: string) => { data.delete(key); } };
  let now = 1000, owner = "alice", alive = true, ready = true;
  const defeated = vi.fn();
  const create = () => {
    const memory = createBossFightMemory(storage, () => owner, () => now);
    const bosses = createPersonalBosses({ fights: memory, now: () => now, identity: () => owner,
      mapId: () => map, alive: () => alive, ready: () => ready, defeated });
    return { memory, bosses };
  };
  return { create, storage, defeated, advance: (ms: number) => { now += ms; },
    owner: (value: string) => { owner = value; }, map: (value: string) => { map = value; },
    alive: (value: boolean) => { alive = value; }, ready: (value: boolean) => { ready = value; } };
}

it.each(["tutorial_forest", "ion_citadel", "endless_40"])("restores unfinished %s fights after an update without granting a defeat", map => {
  const f = fixture(map), first = f.create();
  const hp = first.bosses.state(map)!.hp;
  first.bosses.hit(map, hp * .4);
  first.bosses.hit(map, hp * .1);
  expect(f.storage.setItem).toHaveBeenCalledOnce();
  first.memory.flush();
  const restored = f.create();
  expect(restored.bosses.state(map)!.hp / hp).toBeCloseTo(.5);
  expect(f.defeated).not.toHaveBeenCalled();
  restored.bosses.hit(map, hp);
  expect(f.defeated).toHaveBeenCalledOnce();
  expect(f.create().memory.restore(map, hp)).toBeNull();
});

it("keeps the checkpoint while reconnecting, even before the correct map is hydrated", () => {
  const f = fixture("ion_citadel"), first = f.create();
  const hp = first.bosses.state("ion_citadel")!.hp;
  first.bosses.hit("ion_citadel", hp / 2);
  f.ready(false); f.map("tutorial_forest");
  const next = f.create();
  expect(next.bosses.state("tutorial_forest")).toBeNull();
  f.map("ion_citadel"); f.ready(true);
  expect(next.bosses.state("ion_citadel")!.hp).toBe(hp / 2);
});

it("resets on death and deliberate travel, and never shares progress across characters", () => {
  const f = fixture(), current = f.create(), map = "tutorial_forest";
  const hp = current.bosses.state(map)!.hp;
  current.bosses.hit(map, hp / 2); f.owner("bob");
  expect(current.bosses.state(map)!.hp).toBe(hp);
  f.owner("alice"); expect(current.bosses.state(map)!.hp).toBe(hp / 2);
  f.alive(false); current.bosses.resetFight(); f.alive(true);
  expect(current.bosses.state(map)!.hp).toBe(hp);
  current.bosses.hit(map, hp / 2);
  f.map("home_exterior"); current.bosses.state("home_exterior");
  f.map(map); expect(f.create().bosses.state(map)!.hp).toBe(hp);
});

it("rejects stale boss balance and tolerates unavailable storage", () => {
  const f = fixture(), memory = f.create().memory;
  memory.remember("tutorial_forest", 50, 100);
  expect(memory.restore("tutorial_forest", 200)).toBeNull();
  const broken = createBossFightMemory({ getItem: () => { throw Error(); }, setItem: () => { throw Error(); }, removeItem: () => { throw Error(); } }, () => "alice");
  expect(broken.restore("tutorial_forest", 100)).toBeNull();
  expect(() => { broken.remember("tutorial_forest", 50, 100); broken.clear(); }).not.toThrow();
});
