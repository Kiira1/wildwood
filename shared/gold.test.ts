import { expect, it } from "vitest";
import { goldDropChance, offlineGold, rollBossGold, rollKillGold } from "./gold";

const always = (value: number) => () => value;

it("drops 1 to 3 gold on a tenth of kill rolls, evenly", () => {
  expect(rollKillGold(1, always(0.1))).toBe(0);
  expect(rollKillGold(1, always(0.5))).toBe(0);
  expect(rollKillGold(1, always(0))).toBe(1);
  expect(rollKillGold(1, always(0.0333))).toBe(1);
  expect(rollKillGold(1, always(0.0334))).toBe(2);
  expect(rollKillGold(1, always(0.0667))).toBe(3);
  expect(rollKillGold(1, always(0.0999999))).toBe(3);
  expect(rollKillGold(4, always(0.05))).toBe(8);
  expect(rollKillGold(0, always(0))).toBe(0);
  expect(rollKillGold(-3, always(0))).toBe(0);
});

it("averages 0.2 gold a kill over evenly spread rolls, one roll a kill", () => {
  const steps = 10_000;
  let step = 0, calls = 0;
  const random = () => { calls++; return (step++ + 0.5) / steps; };
  const gold = rollKillGold(steps, random);
  expect(calls).toBe(steps);
  expect(gold / steps).toBeCloseTo(0.2, 3);
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < steps; i++) counts[rollKillGold(1, always((i + 0.5) / steps))]++;
  expect(counts).toEqual([9_000, 333, 334, 333]);
});

it("raises the drop chance by a multiplier (Treasure cards, Gold Luck), keeping the amounts even and never past certain", () => {
  expect(goldDropChance()).toBe(0.1);
  expect(goldDropChance(1.25)).toBeCloseTo(0.125, 12);
  expect(goldDropChance(20)).toBe(1);
  // Below one or nonsense leaves the chance as it was.
  for (const odd of [0.5, NaN, -1]) expect(goldDropChance(odd)).toBe(0.1);
  expect(rollKillGold(1, always(0.11))).toBe(0);
  expect(rollKillGold(1, always(0.11), 1.25)).toBe(3);
  expect(rollKillGold(1, always(0.04), 1.25)).toBe(1);
  expect(rollKillGold(1, always(0.125), 1.25)).toBe(0);
  const steps = 10_000, counts = [0, 0, 0, 0];
  for (let i = 0; i < steps; i++) counts[rollKillGold(1, always((i + 0.5) / steps), 2)]++;
  expect(counts).toEqual([8_000, 667, 666, 667]);
});

it("pays a boss 2 to 4", () => {
  expect(rollBossGold(always(0))).toBe(2);
  expect(rollBossGold(always(0.34))).toBe(3);
  expect(rollBossGold(always(0.9999999))).toBe(4);
  expect(rollBossGold(always(1))).toBe(4);
});

it("pays offline kills at half the rate: a gold every 10", () => {
  expect(offlineGold(9)).toBe(0);
  expect(offlineGold(10)).toBe(1);
  expect(offlineGold(2_537)).toBe(253);
  expect(offlineGold(Number.NaN)).toBe(0);
});
