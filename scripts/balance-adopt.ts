import { writeFileSync } from "node:fs";
import { DEFAULT_BALANCE_FACTORS } from "../shared/map-balance-types";
import { readLiveBalance } from "./balance/live-head";

// npm run balance:adopt — copies the controls changed live in the Balance Lab into shared/balance-tweaks.json, so
// the repo's balance is the live one again. Read-only on the server. Commit the file afterwards.
const live = readLiveBalance();
if (live.settings.curveVersion !== 2) throw new Error(`Live revision ${live.revision} is not on the balance curve; there is nothing to adopt.`);
const tweaks: Record<string, Record<string, number>> = {};
for (const [map, factors] of Object.entries(live.settings.maps)) for (const [field, value] of Object.entries(factors)) {
  if (value !== DEFAULT_BALANCE_FACTORS[field as keyof typeof DEFAULT_BALANCE_FACTORS]) (tweaks[map] ??= {})[field] = value;
}
writeFileSync(new URL("../shared/balance-tweaks.json", import.meta.url), `${JSON.stringify(tweaks, null, 2)}\n`);
const count = Object.values(tweaks).reduce((sum, map) => sum + Object.keys(map).length, 0);
console.log(`Adopted live revision ${live.revision}: ${count} tweaked control(s) in shared/balance-tweaks.json. Commit it.`);
