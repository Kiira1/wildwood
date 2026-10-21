import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { bootGame, gameWorld, playAs, type GameTab } from "./harness/game";
import { scenarioWorld, SCENARIO_START_MS } from "./harness/server";
import { answerConfirm, buttonIn, confirmShown, guildOf, submit, tapNode, typeInto, withTextInput } from "./harness/social";
import { BAN_CHOICES, MUTE_CHOICES } from "../../src/ui/dev-review-format";
import { PERMANENT_SUSPENSION_MICROS } from "../../spacetimedb/src/defeat-session";
import type { ScenarioPlayer, ScenarioWorld } from "./harness/server";
import { formatCompactNumber } from "../../src/ui/number-format";
import { SAMURAI_HAT, WOODEN_SWORD } from "../../shared/items";
import { isSnapshotProfileIcon, profileIconBackground, profileIconIndex, profileIconsInCategory } from "../../shared/profile-icons";

const cards = (tab: GameTab, panel: string) => [...tab.element(panel).querySelectorAll<HTMLElement>("[data-key]")];
const card = (tab: GameTab, panel: string, key: string) => {
  const found = cards(tab, panel).find(node => node.dataset.key === key);
  if (!found) throw new Error(`No card ${key}`);
  return found;
};
const letters = (world: ScenarioWorld, who: ScenarioPlayer) => [...world.db.playerMail.identity.filter(who.identity)];

describe("developer desk", () => {
  it("opens only after the server confirms a developer, and never for anyone else", async () => {
    const world = gameWorld();
    // A regular player has no desk, and the server refuses its reads and actions.
    const guest = await playAs(world, "Ann");
    expect(guest.element("devAuditBtn").hidden).toBe(true);
    guest.tap("devAuditBtn");
    await guest.play(200);
    expect(guest.shown("devAudit")).toBe(false);
    const ann = guest.network.players.get("Ann")!;
    expect(() => ann.procedure("getDevReviewQueue")).toThrow();
    expect(ann.refusal("devSetChatMute", { identity: ann.identity, minutes: 60 })).not.toBeNull();

    const tab = await playAs(world, "Dev", { kind: "developer" });
    tab.tap("devAuditBtn");
    // Until the server answers, the desk is a closed gate: no tabs, no reports.
    expect(tab.shown("devAudit")).toBe(true);
    expect(tab.shown("devAuditTabs")).toBe(false);
    expect(tab.shown("devReportsPanel")).toBe(false);
    await tab.play(200);
    expect(tab.shown("devAuditTabs")).toBe(true);
    expect(tab.shown("devReportsPanel")).toBe(true);

    // The server stops seeing the signed-in developer account: the desk shuts, whatever the client thought.
    tab.tap("closeDevAuditBtn");
    tab.network.players.get("Dev")!.kind = "guest";
    tab.tap("devAuditBtn");
    await tab.play(200);
    expect(tab.shown("devAudit")).toBe(false);
    expect(tab.shown("devReportsPanel")).toBe(false);
  }, 60_000);

  it("lists reports oldest first and the developer's decisions reach the chat, the reporters and the log", async () => {
    const world = gameWorld();
    const tab = await playAs(world, "Dev", { kind: "developer" });
    const rude = world.join("Rude"), ann = world.join("Ann"), bob = world.join("Bob"), cy = world.join("Cy");

    // Bob reports Rude's profile first; Rude then says something nasty and Ann and Cy report it.
    bob.call("reportPlayer", { target: rude.identity, reason: "spam-scam", note: "selling gold" });
    await tab.play(2_000);
    rude.call("sendChatMessage", { message: "you are all <img src=x onerror=alert(1)> trash" });
    const nasty = [...world.db.chatMessage.iter()].find(row => row.sender.isEqual(rude.identity))!;
    await tab.play(2_000);
    ann.call("reportChatMessage", { messageId: nasty.id, reason: "harassment" });
    await tab.play(2_000);
    cy.call("reportChatMessage", { messageId: nasty.id, reason: "harassment" });
    ann.call("sendChatMessage", { message: "/bug the door is stuck" });
    const playerReport = `player:${[...world.db.playerReport.iter()][0].id}`;
    const [annReport, cyReport] = [...world.db.chatMessageReport.iter()]
      .sort((a, b) => Number(a.reportedAt.microsSinceUnixEpoch - b.reportedAt.microsSinceUnixEpoch)).map(row => `chat:${row.id}`);

    tab.tap("devAuditBtn");
    await tab.play(500);
    expect(cards(tab, "devReportsPanel").map(node => node.dataset.key)).toEqual([playerReport, annReport, cyReport]);

    // Remove the message: it leaves chat, both reports about it close, each reporter gets one letter, the evidence stays.
    tapNode(tab, buttonIn(card(tab, "devReportsPanel", annReport), "Remove message"));
    await tab.play(500);
    expect(world.db.chatMessage.id.find(nasty.id)).toMatchObject({ moderated: true });
    expect(world.db.chatMessage.id.find(nasty.id).message).not.toBe(nasty.message);
    expect([...world.db.chatMessageReport.iter()].map(row => row.status)).toEqual(["resolved", "resolved"]);
    expect([...world.db.chatMessageReport.iter()].every(row => row.message === nasty.message)).toBe(true);
    expect(letters(world, ann)).toHaveLength(1);
    expect(letters(world, cy)).toHaveLength(1);
    expect(letters(world, rude)).toHaveLength(0);
    expect(cards(tab, "devReportsPanel").map(node => node.dataset.key)).toEqual([playerReport]);

    // A reviewed report can put the message back.
    const openOnly = tab.element("devReportsPanel").querySelector("input[type=checkbox]")!;
    (openOnly as HTMLInputElement).checked = false;
    openOnly.dispatchEvent(new (tab.window as any).Event("change"));
    tapNode(tab, buttonIn(card(tab, "devReportsPanel", annReport), "Unmoderate"));
    await tab.play(500);
    expect(world.db.chatMessage.id.find(nasty.id)).toMatchObject({ moderated: false, message: nasty.message });
    // One letter per report however often it is decided, and it never names the accused.
    expect(letters(world, ann)).toHaveLength(1);
    expect(letters(world, ann)[0].body).not.toContain("Rude");

    // Mute from the profile report: Rude cannot chat for a day.
    tapNode(tab, buttonIn(card(tab, "devReportsPanel", playerReport), MUTE_CHOICES[1].label));
    await tab.play(10_000);
    const mute = world.db.playerChatMute.identity.find(rude.identity);
    expect(Number(mute.mutedUntilMicros / 1000n) - world.now()).toBeGreaterThan(23 * 3_600_000);
    expect(rude.refusal("sendChatMessage", { message: "hello again" })).not.toBeNull();
    expect(letters(world, bob)).toHaveLength(1);

    // The player card: a ban needs a confirm, and a "no" bans nobody.
    tapNode(tab, buttonIn(card(tab, "devReportsPanel", playerReport), "Player"));
    await tab.play(300);
    expect(tab.shown("devPlayersPanel")).toBe(true);
    const players = tab.element("devPlayersPanel");
    typeInto(tab, players.querySelector("input[placeholder^='Reason']")!, "Repeated slurs");
    tapNode(tab, buttonIn(players, BAN_CHOICES[1].label));
    await tab.play(100);
    expect(confirmShown(tab)).toBe(true);
    answerConfirm(tab, false);
    await tab.play(300);
    expect(world.db.defeatSessionRestriction.identity.find(rude.identity)).toBeNull();
    // A yes bans for seven days by the server's clock, inside the server's own limit.
    typeInto(tab, players.querySelector("input[placeholder^='Reason']")!, "Repeated slurs");
    tapNode(tab, buttonIn(players, BAN_CHOICES[1].label));
    await tab.play(100);
    answerConfirm(tab, true);
    await tab.play(500);
    const weekMs = Number(world.db.defeatSessionRestriction.identity.find(rude.identity).blockedUntilMicros / 1000n) - world.now();
    expect(weekMs).toBeGreaterThan(6.9 * 86_400_000);
    expect(weekMs).toBeLessThanOrEqual(7 * 86_400_000);
    typeInto(tab, players.querySelector("input[placeholder^='Reason']")!, "Repeated slurs");
    tapNode(tab, buttonIn(players, BAN_CHOICES[2].label));
    await tab.play(100);
    answerConfirm(tab, true);
    await tab.play(500);
    expect(world.db.defeatSessionRestriction.identity.find(rude.identity).blockedUntilMicros).toBe(PERMANENT_SUSPENSION_MICROS);

    // The developer cannot be muted.
    const dev = tab.network.players.get("Dev")!;
    expect(dev.refusal("devSetChatMute", { identity: dev.identity, minutes: 60 })).not.toBeNull();

    // A warning arrives as a letter and is not a chat strike.
    const strikes = world.db.playerChatMute.identity.find(rude.identity).strikeAtMicros.length;
    typeInto(tab, players.querySelector("input[placeholder^='Warning']")!, "Please keep chat friendly.");
    tapNode(tab, buttonIn(players, "Send warning"));
    await tab.play(100);
    answerConfirm(tab, true);
    await tab.play(500);
    expect(letters(world, rude)).toHaveLength(1);
    expect(world.db.playerChatMute.identity.find(rude.identity).strikeAtMicros).toHaveLength(strikes);

    // The card reads the player's chat across channels; a reset gives a generated name.
    const readCard = () => JSON.parse(dev.procedure("getDevPlayerCard", { identity: rude.identity }) as string);
    expect(readCard().recentChat.map((line: { text: string }) => line.text)).toContain(nasty.message);
    tapNode(tab, buttonIn(players, "Reset name"));
    await tab.play(100);
    answerConfirm(tab, true);
    await tab.play(500);
    expect(world.db.playerProfile.identity.find(rude.identity).displayName).not.toBe("Rude");

    // The bug report gets its own decision and letter.
    tab.tap("devBugReportsTab");
    await tab.play(300);
    const [bug] = cards(tab, "devBugReportsPanel");
    tapNode(tab, buttonIn(bug, "Resolved"));
    await tab.play(500);
    expect(letters(world, ann)).toHaveLength(2);

    // The moderation log filters by action type and shows evidence as text, never as markup.
    tab.tap("devModerationTab");
    await tab.play(300);
    const log = tab.element("devModerationPanel");
    const entries = () => log.querySelectorAll("details").length;
    expect(entries()).toBe(Number(world.db.moderationAction.count()));
    expect(log.querySelector("img")).toBeNull();
    const filter = log.querySelector("select")!;
    for (const [category, count] of [["mute", 2], ["ban", 2], ["warn", 1], ["bug", 1]] as const) {
      typeInto(tab, filter, category);
      submit(tab, log.querySelector("form")!);
      await tab.play(300);
      expect(entries()).toBe(count);
    }

    // The muted tab lists who cannot chat now; an unmute asks first.
    tab.tap("devMutedTab");
    await tab.play(300);
    const [muted] = tab.element("devMutedPanel").querySelectorAll("article");
    expect(tab.element("devMutedPanel").querySelectorAll("article")).toHaveLength(1);
    tapNode(tab, buttonIn(muted, "Unmute"));
    await tab.play(100);
    answerConfirm(tab, true);
    await tab.play(500);
    expect(Number(world.db.playerChatMute.identity.find(rude.identity).mutedUntilMicros / 1000n)).toBeLessThanOrEqual(world.now());

    // A deletion request waits on its own tab until the developer erases the account.
    cy.call("requestAccountDeletion", { confirmation: "DELETE" });
    tab.tap("devDeletionsTab");
    await tab.play(300);
    const [deletion] = tab.element("devDeletionsPanel").querySelectorAll("article");
    tapNode(tab, buttonIn(deletion, "Erase"));
    await tab.play(100);
    answerConfirm(tab, true);
    await tab.play(500);
    expect(world.db.playerProfile.identity.find(cy.identity)).toBeNull();
    expect(world.db.accountDeletionRequest.count()).toBe(0n);
    expect(tab.element("devDeletionsPanel").querySelectorAll("article")).toHaveLength(0);
  }, 60_000);
});

describe("your look", () => {
  it("picture, backdrop, snapshot, name colour, gender and skin reach your profile, the leaderboard and a linked account", async () => {
    const world = gameWorld();
    // Ann is past the Dragon, so she is on the leaderboard.
    const joined = world.join("Ann");
    joined.patch("playerProgress", { desertUnlocked: true });
    vi.advanceTimersByTime(16 * 60_000);
    world.runDue();
    joined.disconnect();
    const tab = await playAs(world, "Ann");
    const ann = tab.network.players.get("Ann")!;
    const profile = () => world.db.playerProfile.identity.find(ann.identity);
    expect(world.db.leaderboardEntry.identity.find(ann.identity)).not.toBeNull();
    tab.tap("playerHudProfileIcon");
    await tab.play(300);
    tab.tap("editPlayerNameBtn");
    await tab.play(300);
    expect(tab.shown("profileNameEditor")).toBe(true);

    // A picture from the picker, then the Black backdrop behind it.
    tab.tap("profileEditorPicture");
    await tab.play(300);
    expect(tab.shown("profileIconPicker")).toBe(true);
    tapNode(tab, tab.element("profileIconChoices").querySelectorAll("button")[4]);
    await tab.play(300);
    expect(profileIconIndex(profile().profileIcon)).toBe(profileIconsInCategory("people")[4]);
    tapNode(tab, tab.element("profileIconPicker").querySelector("[data-background=black]")!);
    await tab.play(300);
    expect(profileIconBackground(profile().profileIcon)).toBe("black");
    expect(profileIconIndex(profile().profileIcon)).toBe(profileIconsInCategory("people")[4]);
    expect(world.db.leaderboardEntry.identity.find(ann.identity)?.profileIcon).toBe(profile().profileIcon);

    // A snapshot of the character becomes the picture on the same backdrop; a second within 30 s is refused and changes nothing.
    const takeSnapshot = () => tapNode(tab, tab.element("profileIconPicker").querySelector(".profile-icon-snapshot-take")!);
    takeSnapshot();
    await tab.play(300);
    const first = world.db.playerProfileSnapshot.identity.find(ann.identity);
    expect(first).not.toBeNull();
    expect(isSnapshotProfileIcon(profile().profileIcon)).toBe(true);
    expect(profileIconBackground(profile().profileIcon)).toBe("black");
    await tab.play(5_000);
    takeSnapshot();
    await tab.play(300);
    expect(world.db.playerProfileSnapshot.identity.find(ann.identity)).toEqual(first);
    await tab.play(26_000, 500);
    takeSnapshot();
    await tab.play(300);
    expect(world.db.playerProfileSnapshot.identity.find(ann.identity).takenAt).not.toEqual(first.takenAt);
    // A picture outside the catalogue is refused and the snapshot stays.
    const before = profile().profileIcon;
    expect(ann.refusal("setProfileIcon", { profileIcon: 0x20000 })).not.toBeNull();
    expect(profile().profileIcon).toBe(before);
    tab.tap("closeProfileIconPickerBtn");
    await tab.play(300);

    // Name colour, gender (a second tap clears it) and skin tone.
    tab.tap("profileNameColorToggle");
    await tab.play(200);
    tapNode(tab, tab.element("profileNameColorChoices").querySelectorAll("button")[4]);
    await tab.play(300);
    expect(world.db.playerNameColor.identity.find(ann.identity)?.color).toBe(4);
    tab.tap("profileGenderToggle");
    await tab.play(200);
    tapNode(tab, tab.element("profileGenderChoices").querySelector("[data-gender='2']")!);
    await tab.play(300);
    expect(profile().gender).toBe(2);
    tapNode(tab, tab.element("profileGenderChoices").querySelector("[data-gender='2']")!);
    await tab.play(300);
    expect(profile().gender).not.toBe(2);
    tab.tap("profileSkinToneToggle");
    await tab.play(200);
    tapNode(tab, tab.document.querySelector("[data-skin-tone='3']")!);
    await tab.play(300);
    expect(profile().skinTone).toBe(3);

    // A snapshot copies the look from the server's own rows, whatever a modified client sends.
    await tab.play(31_000, 500);
    ann.call("snapshotProfileCharacter", { headItem: "developer_crown", skinTone: 1 });
    expect(world.db.playerProfileSnapshot.identity.find(ann.identity)).toMatchObject({ skinTone: 3, headItem: "" });

    // Signing the guest in to an account carries the colour and the snapshot over.
    const code = "a".repeat(40);
    ann.call("beginAccountLink", { code });
    const account = world.player("Ann's account", "account").connect();
    account.call("claimGuestAccount", { code });
    expect(world.db.playerNameColor.identity.find(account.identity)?.color).toBe(4);
    expect(world.db.playerProfileSnapshot.identity.find(account.identity)).not.toBeNull();
    expect(world.db.playerProfileSnapshot.identity.find(ann.identity)).toBeNull();
  }, 60_000);
});

describe("inspecting another player", () => {
  it("shows their real build, power and online state, and their combat stats are the server's", async () => {
    const world = gameWorld();
    const moss = world.join("Moss");
    // Moss is past the Dragon with a sword, a hat, trained stats and some research.
    moss.patch("playerProgress", { desertUnlocked: true, damage: 40, maxHp: 300, armor: 12, regen: 2,
      inventoryJson: JSON.stringify([WOODEN_SWORD, SAMURAI_HAT]), equippedRightHand: WOODEN_SWORD, equippedHead: SAMURAI_HAT });
    moss.patch("playerResearch", { warcraft: 5, criticalChance: 7 });
    vi.advanceTimersByTime(16 * 60_000);
    world.runDue();
    const board = world.db.leaderboardEntry.identity.find(moss.identity);
    const tab = await playAs(world, "Ann");

    // Ann taps Moss's portrait in chat: his profile opens on his own build.
    moss.call("sendChatMessage", { message: "look at me" });
    await tab.play(500);
    tab.tap("chatSizeToggle");
    await tab.play(300);
    tapNode(tab, tab.element("chatMessages").querySelector(`[data-avatar-owner="${moss.hex}"]`)!);
    await tab.play(1_000);
    expect(tab.shown("playerProfile")).toBe(true);
    expect(tab.element("playerProfileName").textContent).toContain(board.displayName);
    expect(tab.element("playerProfilePower").textContent).toBe(formatCompactNumber(board.powerLevel));
    expect(tab.element("profileEquippedHeadSlot").dataset.itemId).toBe(SAMURAI_HAT);
    expect(tab.element("profileEquippedRightHandSlot").dataset.itemId).toBe(WOODEN_SWORD);
    expect(tab.coop.activePlayerMap(moss.hex)).toBe(world.db.player.identity.find(moss.identity).mapId);

    // The stats Ann's game fights him with are the ones the server ranks him by.
    expect(await tab.until(() => tab.coop.remoteCombatStats(moss.hex) !== null, 2_000)).toBe(true);
    const stats = tab.coop.remoteCombatStats(moss.hex)!;
    expect(stats).toMatchObject({ melee: true, maxHp: board.maxHp, armor: board.armor });
    expect(stats.damage).toBeCloseTo(board.damage);
    expect(stats.regen).toBeCloseTo(board.regen);

    // He logs off: opened again, his profile says so.
    tab.tap("closePlayerProfileBtn");
    moss.disconnect();
    await tab.play(500);
    tapNode(tab, tab.element("chatMessages").querySelector(`[data-avatar-owner="${moss.hex}"]`)!);
    await tab.play(1_000);
    expect(tab.shown("playerProfile")).toBe(true);
    expect(tab.coop.activePlayerMap(moss.hex)).toBe("");
  }, 60_000);
});

describe("leaderboards", () => {
  it("rank by their own rule, show true ranks around your own, carry a linked guest's place and drop erased accounts", async () => {
    const world = gameWorld();
    const HOUR = 3_600_000_000n;
    const ranked = (who: ScenarioPlayer, damage: number, extra: { prestige?: number; hours?: number; joinedDaysAgo?: number } = {}) => {
      who.patch("playerProgress", { desertUnlocked: true, damage });
      const lifetime = world.db.playerLifetime.identity.find(who.identity);
      who.patch("playerLifetime", { playedMicros: BigInt(extra.hours ?? 1) * HOUR,
        joinedAt: new Timestamp(lifetime.joinedAt.microsSinceUnixEpoch - BigInt(extra.joinedDaysAgo ?? 0) * 24n * HOUR) });
      if (extra.prestige) world.setup(ctx => ctx.db.playerPrestige.insert({ identity: who.identity, level: extra.prestige, perkPoints: 0, peakPower: 0, prestigedAt: world.timestamp() }));
      return who;
    };
    // The strongest has never prestiged; the veteran joined first; the grinder has played longest.
    const strongest = ranked(world.join("Strongest"), 5_000);
    const prestiged = ranked(world.join("Prestiged"), 1_000, { prestige: 2 });
    const veteran = ranked(world.join("Veteran"), 900, { joinedDaysAgo: 300 });
    const grinder = ranked(world.join("Grinder"), 800, { hours: 900 });
    // A crowd between them and Ann, so her place is far down the board.
    const crowd = Array.from({ length: 120 }, (_, n) => ranked(world.join(`Crowd ${n}`), 700 - n));
    const ann = ranked(world.join("Ann"), 200);
    vi.advanceTimersByTime(16 * 60_000);
    world.runDue();
    ann.disconnect();
    const powerRank = 4 + crowd.length + 1;

    const tab = await playAs(world, "Ann");
    tab.tap("leaderboardBtn");
    await tab.play(500);
    const rows = () => [...tab.element("leaderboardRows").querySelectorAll<HTMLElement>(".leaderboard-row")]
      .map(row => ({ identity: row.dataset.identity, rank: Number(row.dataset.rank) }));
    const podium = () => [...tab.element("leaderboardPodium").querySelectorAll<HTMLElement>("[data-rank]")]
      .map(slot => Number(slot.dataset.rank)).sort();

    // Power: by power alone; Ann sees her true rank among the ranks around it, under the top three.
    tab.tap("leaderboardPowerTab");
    await tab.play(500);
    expect(rows().find(row => row.identity === ann.hex)?.rank).toBe(powerRank);
    const around = rows().map(row => row.rank).filter(rank => rank > 3);
    expect(around).toContain(powerRank - 50);
    expect(around.every((rank, i) => i === 0 || rank === around[i - 1] + 1)).toBe(true);
    expect(podium()).toEqual([1, 2, 3]);
    expect((await tab.coop.loadLeaderboardPage("power", 1, 3)).entries[0].identity).toBe(strongest.hex);

    // Prestige: the level first, then power. Time Played: hours.
    const topOf = async (tabId: string) => {
      tab.tap(tabId);
      await tab.play(500);
      const top = await tab.coop.loadLeaderboardPage(tabId === "leaderboardPrestigeTab" ? "prestige" : "time", 1, 3);
      return top.entries[0].identity;
    };
    expect(await topOf("leaderboardPrestigeTab")).toBe(prestiged.hex);
    expect(await topOf("leaderboardTimeTab")).toBe(grinder.hex);
    expect((await tab.coop.loadLeaderboardPage("created", 1, 3)).entries[0].identity).toBe(veteran.hex);
    // Rivals: only Ann's own prestige level.
    const rivals = await tab.coop.loadLeaderboardPage("rivals", 1, 5);
    expect(rivals.entries.some((row: { identity: string }) => row.identity === prestiged.hex)).toBe(false);
    expect(rivals.localRank).toBe(powerRank - 1);

    // A guest who links keeps their place under the account until the next snapshot.
    const code = "b".repeat(40);
    strongest.call("beginAccountLink", { code });
    const account = world.player("Strongest's account", "account").connect();
    account.call("claimGuestAccount", { code });
    const board = (who: ScenarioPlayer) => (who.procedure("getLeaderboardRanks", { board: "power", startRank: 1, count: 5 }) as { entries: { rank: number; entry: { identity: { toHexString(): string } } }[]; localRank: number });
    expect(board(account).localRank).toBe(1);

    // An erased account leaves the board.
    const owner = world.player("Owner", "owner").connect();
    owner.call("devEraseAccount", { identityHex: veteran.hex, confirmation: "ERASE", reason: "Deletion request" });
    expect(world.db.leaderboardStanding.identity.find(veteran.identity)).toBeNull();
    expect(board(account).entries.some(row => row.entry.identity.toHexString() === veteran.hex)).toBe(false);
  }, 90_000);
});

describe("names", () => {
  it("a filtered guild name is refused; the owner repairs a bad player name everywhere it shows, and nothing else", () => {
    const world = scenarioWorld();
    const founder = world.join("Founder"), rude = world.join("Rude"), other = world.join("Other");
    for (const name of ["CoCk", "COCK", "Cunt", "Dick", "Nazi", "Rape"]) expect(() => guildOf(world, name, founder), name).toThrow();
    expect(world.db.guild.count()).toBe(0n);
    const guild = guildOf(world, "SOUP", founder, [rude]);
    expect(guild).toBeTruthy();

    // An old bad name, from before the filter caught it, on the board, in the guild, in chat and in a duel.
    const bad = "A naked little boy";
    rude.patch("playerProfile", { displayName: bad });
    rude.patch("playerProgress", { desertUnlocked: true });
    world.advance(16 * 60_000);
    world.runDue();
    rude.patch("guildMember", { name: bad });
    world.setup(ctx => ctx.db.chatMessage.insert(world.storage.row("chatMessage", { id: 0n, sender: rude.identity, senderName: bad, message: "Hello", sentAt: world.timestamp() })));
    world.setup(ctx => ctx.db.duelReplay.insert(world.storage.row("duelReplay", { id: 0n, challengerIdentity: rude.hex, opponentIdentity: other.hex,
      challengerName: bad, opponentName: "Other", winnerName: bad, challengerDamageDealt: 123 })));
    const save = rude.progress();

    expect(other.refusal("devRepairDisplayName", { identity: rude.identity, expectedDisplayName: bad })).not.toBeNull();
    const owner = world.player("Owner", "owner").connect();
    expect(owner.refusal("devRepairDisplayName", { identity: rude.identity, expectedDisplayName: "Someone else" })).not.toBeNull();
    owner.call("devRepairDisplayName", { identity: rude.identity, expectedDisplayName: bad });
    const fixed = world.db.playerProfile.identity.find(rude.identity).displayName;
    expect(fixed).not.toBe(bad);
    expect(world.db.leaderboardEntry.identity.find(rude.identity).displayName).toBe(fixed);
    expect(world.db.guildMember.identity.find(rude.identity).name).toBe(fixed);
    expect([...world.db.chatMessage.iter()].find(row => row.message === "Hello").senderName).toBe(fixed);
    expect([...world.db.duelReplay.iter()][0]).toMatchObject({ challengerName: fixed, winnerName: fixed, challengerDamageDealt: 123 });
    expect(rude.progress()).toEqual(save);
    // A second repair of the new name changes nothing.
    owner.call("devRepairDisplayName", { identity: rude.identity, expectedDisplayName: fixed });
    expect(world.db.playerProfile.identity.find(rude.identity).displayName).toBe(fixed);
  });
});

describe("finding players", () => {
  it("the directory lists recently active real players, rebuilt every ten minutes", () => {
    // A day after the other worlds in this file: the directory is built once per server, for everyone.
    const world = scenarioWorld({ start: SCENARIO_START_MS + 86_400_000 });
    const ann = world.join("Ann"), zed = world.join("Zed"), gone = world.join("Gone"), bot = world.join("Bot");
    const named = (who: ScenarioPlayer, displayName: string) => who.patch("playerProfile", { displayName });
    named(ann, "Ann"); named(zed, "Zed"); named(gone, "Gone"); named(bot, "Bot");
    const back = (who: ScenarioPlayer, days: number) => who.patch("playerLifetime",
      { sessionStartedAt: new Timestamp(BigInt(world.now() - days * 86_400_000) * 1000n) });
    back(zed, 1); back(gone, 31);
    world.setup(ctx => ctx.db.virtualPlayer.insert(world.storage.row("virtualPlayer", { identity: bot.identity, owner: ann.identity })));
    const directory = () => JSON.parse(ann.procedure("getPlayerDirectory") as string) as [string, string][];
    expect(directory().map(([, name]) => name).sort()).toEqual(["Ann", "Zed"]);
    named(zed, "Zedd");
    world.advance(9 * 60_000);
    expect(directory().map(([, name]) => name)).toContain("Zed");
    world.advance(60_000);
    expect(directory().map(([, name]) => name)).toContain("Zedd");
  });

  it("player search lists the exact name first, then names starting with it, then later words; leaves out the searcher; a tap opens the conversation", async () => {
    const world = gameWorld({ start: SCENARIO_START_MS + 2 * 86_400_000 });
    const named = (name: string) => { const who = world.join(name); who.patch("playerProfile", { displayName: name }); return who; };
    named("Badger"); named("Snowbadger");
    const lucky = named("Lucky Badger 455");
    named("Kiira");
    const ann = world.join("Ann");
    ann.patch("playerProfile", { displayName: "Badgerfan" });
    ann.disconnect();
    const tab = withTextInput(await playAs(world, "Ann"));
    tab.tap("chatSizeToggle");
    await tab.play(300);
    tapNode(tab, tab.document.querySelectorAll(".chat-channel-tabs [role=tab]")[2]);
    await tab.play(300);
    const input = tab.document.querySelector<HTMLInputElement>(".chat-player-search input")!;
    input.dispatchEvent(new (tab.window as any).Event("focus"));
    await tab.play(500);
    typeInto(tab, input, "BADGER");
    await tab.play(100);
    const options = () => [...tab.document.querySelectorAll<HTMLElement>(".chat-player-search .player-search-option")];
    expect(options().map(option => option.textContent)).toEqual(["Badger", "Lucky Badger 455", "Snowbadger"]);
    expect(options().some(option => option.textContent === "Badgerfan")).toBe(false);

    // A finger that moves to scroll the list picks nothing; a tap picks.
    const touch = (node: Element, type: string, y: number) =>
      node.dispatchEvent(Object.assign(new (tab.window as any).Event(type, { bubbles: true, cancelable: true }), { pointerType: "touch", clientX: 50, clientY: y }));
    touch(options()[1], "pointerdown", 20);
    touch(options()[1], "pointerup", 80);
    await tab.play(100);
    expect(options()).toHaveLength(3);
    touch(options()[1], "pointerdown", 20);
    touch(options()[1], "pointerup", 21);
    await tab.play(300);
    typeInto(tab, tab.element("chatInput"), "found you");
    submit(tab, tab.element("chatForm"));
    await tab.play(500);
    const sent = [...world.db.socialMessage.iter()].find(row => row.message === "found you");
    expect(sent.recipient.isEqual(lucky.identity)).toBe(true);
  }, 60_000);
});
