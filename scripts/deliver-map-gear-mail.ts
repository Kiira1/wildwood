import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { GEAR_MAIL_ID, GEAR_MAIL_TITLE, GEAR_MAIL_BODY } from "../shared/mailbox-equipment";
const [server, database, flag] = process.argv.slice(2);
if (!server || !database || flag !== "--deliver") throw new Error("Usage: tsx scripts/deliver-map-gear-mail.ts <server> <database> --deliver");
const bin = process.env.SPACETIME_BIN || "spacetime";
function invoke(args: string[]) {
  const result = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message);
  return result.stdout;
}
function query(sql: string): Record<string, any>[] {
  const [table] = JSON.parse(invoke(["sql", database, sql, "--server", server, "--format", "json"]));
  return table.rows.map((row: unknown[]) => Object.fromEntries(table.schema.elements.map((column: any, i: number) => [column.name.some, row[i]])));
}
const recipients = query("SELECT identity FROM player_progress").map(row => row.identity[0]);
if (!recipients.length || recipients.some(id => typeof id !== "string" || !/^(0x)?[0-9a-f]{64}$/i.test(id))) throw new Error("Invalid recipient snapshot");
const directory = `local-data/audits/gear-mail-${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(directory, { recursive: true });
writeFileSync(`${directory}/recipients.json`, JSON.stringify({ server, database, campaign: GEAR_MAIL_ID, recipients }, null, 2), { mode: 0o600 });
for (let i = 0; i < recipients.length; i += 100) {
  invoke(["call", database, "dev_deliver_equipment_mail", JSON.stringify(recipients.slice(i, i + 100).map(id => [id])), "--server", server]);
  console.log(`Prepared ${Math.min(i + 100, recipients.length)}/${recipients.length} recipients`);
}
const attachments = query("SELECT * FROM mailbox_equipment");
writeFileSync(`${directory}/attachments.json`, JSON.stringify(attachments, null, 2), { mode: 0o600 });
invoke(["call", database, "dev_publish_mailbox_letter", JSON.stringify(GEAR_MAIL_ID), JSON.stringify(GEAR_MAIL_TITLE), JSON.stringify(GEAR_MAIL_BODY), "0", "--server", server]);
const letter = query(`SELECT id, title, gems FROM mailbox_letter WHERE id = '${GEAR_MAIL_ID}'`);
const summary = { campaign: GEAR_MAIL_ID, scanned: recipients.length, delivered: attachments.length, letter };
writeFileSync(`${directory}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
console.log(`Audit: ${directory}`);
