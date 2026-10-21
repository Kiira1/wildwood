import { createAutoEquip } from "./auto-equip";
import { receiveDuplicateEquipment } from "./equipment-copies";
import { expect, it, vi } from 'vitest';
import { crystalFixture, server } from '../../tests/helpers/crystal-hollows-fixture';
import { IRON_BOW } from '../../shared/items';
import { equipmentLocked } from './equipment-locks';
import { progressOf } from "../../tests/helpers/progress";
vi.mock('spacetimedb/server', () => import('../../tests/helpers/spacetime-module'));
it('keeps locked gear in its slot against auto equip, while a better duplicate roll still upgrades it in place', () => {
  const f = crystalFixture();
  f.patch('playerProgress', { inventoryJson: JSON.stringify([IRON_BOW]), equippedRightHand: IRON_BOW });
  f.run(server.setEquipmentLocked, { itemId: IRON_BOW, copyId: 0n, locked: true });
  const key = `${f.ctx.sender.toHexString()}:${IRON_BOW}`;
  f.seed('playerBowSkill', { key, identity: f.ctx.sender, itemId: IRON_BOW, arrowStorm: 0, ricochet: 0, piercingShot: 0 });
  // Every skill appears, so each copy rolls better than the locked one.
  Object.assign(f.ctx, { random: Object.assign(() => .1, { integerInRange: (min: number) => min }) });
  receiveDuplicateEquipment(f.ctx as any, f.ctx.sender, IRON_BOW, 1);
  // The lock is the player's: it stays, and the weapon under it simply gets better.
  const upgraded = f.db.playerBowSkill.key.find(key);
  expect(upgraded.arrowStorm > 0 && upgraded.ricochet > 0 && upgraded.piercingShot > 0).toBe(true);
  expect(f.db.playerEquipmentLock.key.find(key)).toBeTruthy();
  expect([...f.db.pendingEquipmentOffer.identity.filter(f.ctx.sender)]).toEqual([]);
  const before = progressOf(f, f.ctx.sender);
  f.patch('playerProgress', { inventoryJson: JSON.stringify([IRON_BOW, 'ion_bow']), ionCitadelUnlocked: true });
  const write = vi.fn();
  createAutoEquip({ inventoryForProgress: p => JSON.parse(p.inventoryJson), itemUpgradeLevelFor: () => 0, writeProgressAndPresentation: write }).equipNewUpgrades(f.ctx as any, f.ctx.sender, before);
  expect(write).not.toHaveBeenCalled();
});

it.each([false, true])('equips a locked duplicate while preserving the bag copy lock (%s)', firstLocked => {
  const f = crystalFixture();
  f.patch('playerProgress', { inventoryJson: JSON.stringify([IRON_BOW]), equippedRightHand: '' });
  const copy = f.seed('playerEquipmentCopy', { id: 0n, identity: f.ctx.sender, itemId: IRON_BOW, arrowStorm: 7, ricochet: 0, piercingShot: 0, acquiredAt: f.ctx.timestamp });
  f.run(server.setEquipmentLocked, { itemId: IRON_BOW, copyId: copy.id, locked: true });
  if (firstLocked) f.run(server.setEquipmentLocked, { itemId: IRON_BOW, copyId: 0n, locked: true });
  f.run(server.selectEquipmentCopy, { copyId: copy.id });
  expect(equipmentLocked(f.ctx as any, f.ctx.sender, IRON_BOW)).toBe(true);
  expect(equipmentLocked(f.ctx as any, f.ctx.sender, IRON_BOW, copy.id)).toBe(firstLocked);
  expect(f.db.playerBowSkill.key.find(`${f.ctx.sender.toHexString()}:${IRON_BOW}`).arrowStorm).toBe(7);
});

