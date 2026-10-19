import { table, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import { isWeaponSchool, masteryPointsForReport, weaponSchool, type WeaponSchool } from "../../shared/weapon-mastery";
import { challengeActive } from "./prestige-challenge";

/** A school's Mastery points, one row per player and school, so a new school needs no new column. */
export const playerWeaponMastery = table({ name: "player_weapon_mastery", public: false }, {
  key: t.string().primaryKey(),
  identity: t.identity().index("btree"),
  school: t.string(),
  points: t.u64(),
});

type Ctx = any;
export const masteryKey = (identity: Identity, school: WeaponSchool) => `${identity.toHexString()}:${school}`;
const rowsOf = (ctx: Ctx, identity: Identity): any[] => [...ctx.db.playerWeaponMastery.identity.filter(identity)];

/** Each school's points, 0 for a school never trained. */
export function weaponMasteryPoints(ctx: Ctx, identity: Identity): Record<WeaponSchool, bigint> {
  const points = { archery: 0n, swordplay: 0n, sorcery: 0n } as Record<WeaponSchool, bigint>;
  for (const row of rowsOf(ctx, identity)) {
    const school: unknown = row.school;
    if (isWeaponSchool(school)) points[school] = row.points;
  }
  return points;
}

function addPoints(ctx: Ctx, identity: Identity, school: WeaponSchool, points: number) {
  if (!(points > 0)) return;
  const key = masteryKey(identity, school), row = ctx.db.playerWeaponMastery.key.find(key);
  if (row) ctx.db.playerWeaponMastery.key.update({ ...row, points: row.points + BigInt(points) });
  else ctx.db.playerWeaponMastery.insert({ key, identity, school, points: BigInt(points) });
}

/**
 * An accepted kill report trains the school of the weapon in hand, from the save the report already read. A boss pays only on its first clear in a run:
 * a boss clear is the client's claim, unbounded, so a repeat must not pay. Reflect Only kills are Reflect's, not
 * the weapon's, so they train nothing.
 */
export function awardWeaponMastery(ctx: Ctx, identity: Identity, weapon: string | undefined, kills: number, firstBossClear: boolean) {
  if (challengeActive(ctx, identity)) return;
  const points = masteryPointsForReport(kills, firstBossClear);
  if (!points) return;
  addPoints(ctx, identity, weaponSchool(weapon), points);
}

/** Reset Save clears every school. Prestige keeps them. */
export function removeWeaponMastery(ctx: Ctx, identity: Identity) {
  for (const row of rowsOf(ctx, identity)) ctx.db.playerWeaponMastery.key.delete(row.key);
}

/** A guest's save replaces the account's on link, as Mining does, its Mastery with it. */
export function mergeWeaponMastery(ctx: Ctx, guest: Identity, account: Identity) {
  removeWeaponMastery(ctx, account);
  for (const row of rowsOf(ctx, guest)) {
    ctx.db.playerWeaponMastery.key.delete(row.key);
    const school: unknown = row.school;
    if (isWeaponSchool(school)) ctx.db.playerWeaponMastery.insert({ ...row, key: masteryKey(account, school), identity: account });
  }
}
