import { writeFileSync } from "node:fs";
import { miningLayoutSource } from "../shared/mining-layout-generate";

// npm run generate:mining-layout — lays the Copper Hills' rocks once and writes them to
// shared/mining-layout.generated.ts, which every client and the server read. Rerun after changing the layout.
writeFileSync(new URL("../shared/mining-layout.generated.ts", import.meta.url), miningLayoutSource());
console.log("Wrote shared/mining-layout.generated.ts. Commit it.");
