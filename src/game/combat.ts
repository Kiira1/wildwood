import { armorDamageReduction, damageAfterArmor } from "../../shared/combat";

/** The one armor rule (shared/combat.ts), the same the server, duels and offline progress use. */
export { armorDamageReduction, damageAfterArmor };

export function formatArmorReduction(armor: number) {
  const percentage = armorDamageReduction(armor) * 100;
  const decimals = percentage < 10 ? 1 : percentage < 99 ? 1 : 2;
  return `${percentage.toFixed(decimals).replace(/\.?0+$/, "")}%`;
}
