import { defaultBalanceSettings } from "../shared/map-balance";
import { balanceDifferences, readLiveBalance } from "./balance/live-head";

// npx tsx scripts/balance-check.ts — whether the live balance is the repo's (npm run ship runs it). Read-only.
const live = readLiveBalance();
const differences = balanceDifferences(live.settings, defaultBalanceSettings());
console.log(JSON.stringify({ revision: live.revision, onCurve: live.settings.curveVersion === 2, matches: differences.length === 0, differences: differences.slice(0, 12) }));
