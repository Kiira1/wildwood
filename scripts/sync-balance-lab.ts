import { writeFileSync } from "node:fs";
import { readLiveBalance } from "./balance/live-head";
import { liveBalanceSource } from "./balance/live-balance-source";

const { revision, settings } = readLiveBalance();
const snapshot = { revision, capturedAt: new Date().toISOString(), database: "wildwood-coop", settings };
writeFileSync(new URL("../src/balance/live-balance.ts", import.meta.url), liveBalanceSource(snapshot));
console.log(`Balance Lab captured maincloud revision ${revision}. No server changes.`);
