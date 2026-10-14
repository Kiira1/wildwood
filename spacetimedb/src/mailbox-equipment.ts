import { table, t, SenderError } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type { ModuleReducerCtx, ModuleViewCtx } from "./index";
import { bagCapacityFor } from "./bag-capacity";
import { upgradeSlotForItem } from "../../shared/slot-upgrades";
import { activeItemUpgradeEntriesFor } from "./upgrade-bench-slots";
import { inventoryForProgress, restoreItemToProgress, slotUpgradeKey } from "./progress-helpers";
import { oreKindsHeldFor } from "./item-refine";
import { ensureWeaponSkillRolls } from "./weapon-skills";
import { insertSnapshotRow, updateSnapshotRow } from "./snapshot-row-writes";
import { writeProgressAndPresentation } from "./player-power";
import { gearClaimSpace, gearForHighestMap, GEAR_MAIL_ID, GEAR_MAIL_LEVEL } from "../../shared/mailbox-equipment";
import { readPlayerProgress } from "./wide-stats";

export const mailboxEquipment = table({ name: "mailbox_equipment", public: false }, {
  key: t.string().primaryKey(), identity: t.identity().index("btree"), letterId: t.string(),
  itemIdsJson: t.string(), mapId: t.string(), upgradeLevel: t.u8(), createdAt: t.timestamp(),
});
export const equipmentMailKey = (id: string, identity: Identity) => `${id}:${identity.toHexString()}`;

/** Freeze recipients' own current map on delivery; retries never upgrade their gift's tier. */
export function deliverEquipmentMail(ctx: ModuleReducerCtx, recipients: Identity[]) {
  if (recipients.length > 100) throw new SenderError("Send at most 100 gifts at a time.");
  for (const identity of recipients) {
    const key = equipmentMailKey(GEAR_MAIL_ID, identity);
    if (ctx.db.mailboxEquipment.key.find(key)) continue;
    const progress = readPlayerProgress(ctx, identity);
    if (!progress || ctx.db.virtualPlayer.identity.find(identity)) continue;
    const gift = gearForHighestMap(progress);
    ctx.db.mailboxEquipment.insert({ key, identity, letterId: GEAR_MAIL_ID, itemIdsJson: JSON.stringify(gift.itemIds),
      mapId: gift.mapId, upgradeLevel: GEAR_MAIL_LEVEL, createdAt: ctx.timestamp });
  }
}

export function equipmentForMail(ctx: ModuleReducerCtx | ModuleViewCtx, id: string) {
  return ctx.db.mailboxEquipment.key.find(equipmentMailKey(id, ctx.sender));
}
export function mergeEquipmentMail(ctx: ModuleReducerCtx, guest: Identity, account: Identity) {
  for (const row of ctx.db.mailboxEquipment.identity.filter(guest)) {
    const key = equipmentMailKey(row.letterId, account);
    if (!ctx.db.mailboxEquipment.key.find(key)) ctx.db.mailboxEquipment.insert({ ...row, key, identity: account });
    ctx.db.mailboxEquipment.key.delete(row.key);
  }
}
export function removeEquipmentMail(ctx: ModuleReducerCtx, identity: Identity) {
  for (const row of ctx.db.mailboxEquipment.identity.filter(identity)) ctx.db.mailboxEquipment.key.delete(row.key);
}
/** Every player's gift from these letters, claimed or not, for letters taken out of the mailbox. */
export function removeEquipmentMailFor(ctx: ModuleReducerCtx, letterIds: ReadonlySet<string>) {
  for (const row of [...ctx.db.mailboxEquipment.iter()]) if (letterIds.has(row.letterId)) ctx.db.mailboxEquipment.key.delete(row.key);
}

/** Grant the validated equipment attachment, rolling native skills only for new first copies. */
export function claimEquipmentMail(ctx: ModuleReducerCtx, items: string[], level: number) {
  const progress = readPlayerProgress(ctx, ctx.sender);
  if (!progress) throw new SenderError("Player unavailable.");
  const upgrading = activeItemUpgradeEntriesFor(ctx, ctx.sender).map(({ active }) => active.itemId);
  if (items.some(id => upgrading.includes(id))) throw new SenderError("Finish or cancel the upgrade on your gifted gear, then claim it here.");
  const equipped = [progress.equippedHead, progress.equippedChest, progress.equippedFeet, progress.equippedRightHand, progress.equippedLeftHand];
  const capacity = bagCapacityFor(ctx, ctx.sender);
  const { missing, slotsToFree } = gearClaimSpace(inventoryForProgress(progress), equipped, upgrading, items, capacity, oreKindsHeldFor(ctx, ctx.sender));
  if (slotsToFree) throw new SenderError(`Free ${slotsToFree} inventory slot${slotsToFree === 1 ? "" : "s"}, then claim your gear. Your gift will stay in Mail.`);
  let next = progress;
  for (const id of missing) next = restoreItemToProgress(next, id);
  ensureWeaponSkillRolls(ctx, ctx.sender, missing);
  for (const slotName of new Set(items.map(upgradeSlotForItem).filter(Boolean) as string[])) {
    const key = slotUpgradeKey(ctx.sender, slotName), current = ctx.db.playerItemUpgrade.key.find(key);
    if ((current?.level ?? 0) >= level) continue;
    const upgraded = { key, identity: ctx.sender, itemId: slotName, level };
    if (current) updateSnapshotRow(ctx, "playerItemUpgrade", upgraded);
    else insertSnapshotRow(ctx, "playerItemUpgrade", upgraded);
  }
  writeProgressAndPresentation(ctx, next);
}
