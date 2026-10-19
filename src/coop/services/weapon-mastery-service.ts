import { tables, type DbConnection } from "../../module_bindings";
import { WEAPON_SCHOOLS, isWeaponSchool, type WeaponSchool } from "../../../shared/weapon-mastery";

const noPoints = (): Record<WeaponSchool, bigint> => Object.fromEntries(WEAPON_SCHOOLS.map(school => [school, 0n])) as Record<WeaponSchool, bigint>;

/** This account's Weapon Mastery points by school (my_weapon_mastery); a school with no row has none. */
export function createWeaponMasteryRows(notify: () => void) {
  let points = noPoints();

  function watch(connection: DbConnection, isCurrent: () => boolean) {
    points = noPoints();
    const read = () => {
      if (!isCurrent()) return;
      const next = noPoints();
      for (const row of connection.db.myWeaponMastery.iter()) if (isWeaponSchool(row.school)) next[row.school] = row.points;
      points = next;
      notify();
    };
    connection.db.myWeaponMastery.onInsert(read); connection.db.myWeaponMastery.onUpdate(read); connection.db.myWeaponMastery.onDelete(read);
    connection.subscriptionBuilder().onApplied(read).subscribe([tables.myWeaponMastery]);
  }

  return {
    watch,
    api: {
      weaponMastery: (): Readonly<Record<WeaponSchool, bigint>> => points,
    },
  };
}
