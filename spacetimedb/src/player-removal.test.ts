import { ConnectionId, Identity } from "spacetimedb";
import { expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";

vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

// The two removal paths in account-lifecycle.ts, run for real: a player gets a
// row in every table that can hold an identity, the removal runs, and the test
// lists which tables still hold that identity. That list must match the one
// below exactly, so a new table fails here until someone decides whether the
// removal should clear it. (Privacy erasure is a separate path, generated from
// the schema and checked by `npm run check:erasure`.)

const DATABASE_OWNER = new Identity("c200383520521c925f3cf6deafb20cd6a7d6168d1c31cb3c0ddb731c197a2d79");
const tables = (server.default as any).schemaType.tables as Record<string, { columns: Record<string, any> }>;
const isIdentityColumn = (builder: any) =>
  builder.typeBuilder.algebraicType.tag === "Product" &&
  builder.typeBuilder.algebraicType.value.elements[0]?.name === "__identity__";
const identityColumns = (table: string) =>
  Object.entries(tables[table].columns).filter(([, builder]) => isIdentityColumn(builder)).map(([name]) => name);
const holds = (row: any, who: Identity) => Object.values(row).some(value => (value as any)?.toHexString?.() === who.toHexString());

// Blank rows are fine for most tables; these need a value the removal code parses.
const REALISTIC: Record<string, Record<string, unknown>> = {
  chatReaction: { messageKey: "public:999" },
};

type Fixture = ReturnType<typeof crystalFixture>;
function seedEverywhere(f: Fixture, who: Identity, skip: ReadonlySet<string>) {
  for (const table of Object.keys(tables)) {
    const columns = identityColumns(table);
    if (!columns.length || skip.has(table)) continue;
    f.seed(table, { ...REALISTIC[table], ...Object.fromEntries(columns.map(column => [column, who])) });
  }
}
const tablesHolding = (f: Fixture, who: Identity) =>
  Object.keys(tables).filter(table => [...(f.db as any)[table].iter()].some(row => holds(row, who))).sort();

// Rows that make a legacy delete refuse: online, in a duel, or a real account.
const REFUSES_DELETE = new Set(["player", "playerController", "playerSession", "playerAccountStatus", "duel", "virtualPlayer"]);

function legacyDelete(f: Fixture, target: Identity) {
  f.patch("playerProfile", { displayName: "Legacy" }, target);
  f.patch("playerProgress", { maxHp: 100, damage: 1, attackRate: 1, projectileSpeed: 1_000, projectileCount: 1, attackRange: 200, speed: 180, inventoryJson: "[]" }, target);
  f.patch("leaderboardEntry", { isGuest: false, powerLevel: 1 }, target);
  const sender = f.ctx.sender;
  f.ctx.sender = DATABASE_OWNER;
  f.run(server.devDeleteLegacyPlayer, { identity: target, expectedDisplayName: "Legacy" });
  f.ctx.sender = sender;
}

// What each removal leaves behind today. Most of it is features added after
// the removal lists were written (prestige, quests, aggro, offline progress,
// Gem commerce); the rest is logs and analytics. Taking a table off a list
// means the removal now clears it; adding one means a new table that neither
// removal touches, which should be a decision rather than an accident.
const LEFT_BY_LEGACY_DELETE = [
  "accountDeletionRequest", "accountEmail", "aggroChallengeRun", "analyticsConversion", "analyticsDailyMapPlayer",
  "analyticsDailyPlayer", "analyticsPlayer", "bossHitResult", "chatModerator", "connectionDiagnostic",
  "connectionDiagnosticRate", "dreadreaperAttackWindow", "dreadreaperContribution", "duelWideStats", "duelWireAccess",
  "endlessTravelAccess", "enemyDefeatReview", "forestRewardPrototype", "gemCommerceConfig", "gemCommerceHold",
  "gemKillProgress", "gemPurchase", "guild", "guildMemberQuestWeek", "guildRejoin", "homeReturnLocation",
  "leaderboardEntryLegacy", "loginMove", "mapBalanceVersion", "offlineProgress", "patreonAnnouncement",
  "patreonPreview", "playerAggroChallenge", "playerAggroChallengeParked", "playerBonusToggle", "playerDailyQuest",
  "playerEndgameRebaseBackup", "playerEndlessRebaseBackup", "playerFreeRespec", "playerGemDrop",
  "playerMotionDetailFrame", "playerOfflinePreference", "playerPowerRebaseBackup", "playerPrestige",
  "playerPrestigeChallenge", "playerPrestigeChallengeParked", "playerPrestigeExpansionPerk", "playerPrestigePerk",
  "playerQuestWeekTotal", "prestigeChallengeBackup", "prestigeChallengeRun", "prismshellAttackWindow",
  "prismshellContribution", "releaseAcknowledgement", "soloQuestWeek", "virtualPlayerLoad", "virtualPlayerRun",
];
// A simulated client also keeps its chat, duel and leaderboard rows (the owner
// clears those with the run), and its own load row goes with it.
const LEFT_BY_VIRTUAL_DISCONNECT = [
  ...LEFT_BY_LEGACY_DELETE.filter(table => table !== "virtualPlayerLoad"),
  "chatMessage", "chatMessageReport", "chatMessageReportRateLimit", "dailyGemBonus", "developerPresencePreference",
  "duel", "gemTransaction", "leaderboardPosition", "leaderboardPrestigePosition", "presenceChatCooldown",
  "proceduralContribution", "proceduralInstanceContribution", "proceduralProgress", "startupTelemetryRateLimit",
].sort();

it("a legacy delete clears every table except the known list", () => {
  const f = crystalFixture();
  const target = identity("7");
  seedEverywhere(f, target, REFUSES_DELETE);
  legacyDelete(f, target);
  expect(tablesHolding(f, target)).toEqual(LEFT_BY_LEGACY_DELETE);
});

it("a simulated client's last disconnect clears every table except the known list", () => {
  const f = crystalFixture();
  const target = identity("7");
  const connection = new ConnectionId(77n);
  seedEverywhere(f, target, new Set(["playerSession"]));
  f.seed("playerSession", { connectionId: connection, identity: target, enteredWorld: false, connectedAt: f.ctx.timestamp, tabId: "load-test" });
  f.ctx.sender = target;
  f.ctx.connectionId = connection;
  f.run(server.onDisconnect);
  expect(tablesHolding(f, target)).toEqual(LEFT_BY_VIRTUAL_DISCONNECT);
});
