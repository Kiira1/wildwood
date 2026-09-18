import { spawnSync } from "node:child_process";
import { REBALANCE_MAIL_ID, REBALANCE_MAIL_TITLE, REBALANCE_MAIL_BODY, REBALANCE_MAIL_GEMS } from "../shared/mailbox";

// Explicit target: editing a draft must never publish to production implicitly.
const [server, database] = process.argv.slice(2);
if (!server || !database || process.argv.length !== 4) {
  console.error("Usage: npm run mail:publish -- <server> <database>");
  process.exit(1);
}
const result = spawnSync(process.env.SPACETIME_BIN || "spacetime", ["call", database,
  "dev_publish_mailbox_letter", JSON.stringify(REBALANCE_MAIL_ID), JSON.stringify(REBALANCE_MAIL_TITLE),
  JSON.stringify(REBALANCE_MAIL_BODY), REBALANCE_MAIL_GEMS.toString(), "--server", server], { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
