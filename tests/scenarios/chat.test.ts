import { describe, expect, it, vi } from "vitest";
import { gameWorld, playAs, type GameTab } from "./harness/game";
import { scenarioWorld } from "./harness/server";
import { ConnectionId } from "spacetimedb";
import { PERMANENT_SUSPENSION_MICROS } from "../../spacetimedb/src/defeat-session";
import { guildOf, submit, tapNode, typeInto, withTextInput } from "./harness/social";
import type { ScenarioPlayer, ScenarioWorld } from "./harness/server";

const say = (who: ScenarioPlayer, message: string) => who.call("sendChatMessage", { message });
const sayIn = (who: ScenarioPlayer, channel: "guild" | "dm", message: string, target = "") =>
  who.call("sendSocialMessage", { channel, target, message, replyToMessageId: 0n });

/** What the player reads: the chat's text, the mini badge's count, a channel tab. */
const chatText = (tab: GameTab) => tab.element("chatMessages").textContent ?? "";
const badge = (tab: GameTab) => tab.shown("chatUnreadBadge") ? Number(tab.element("chatUnreadBadge").textContent) : 0;
const channelTab = (tab: GameTab, index: 0 | 1 | 2) => tab.document.querySelectorAll(".chat-channel-tabs [role=tab]")[index];
const channelUnread = (tab: GameTab, index: 0 | 1 | 2) => {
  const count = channelTab(tab, index).querySelector<HTMLElement>(".chat-channel-unread")!;
  return count.hidden ? 0 : Number(count.textContent);
};
const PUBLIC = 0, GUILD = 1, PRIVATE = 2;
/** Types and sends from the chat box. */
async function send(tab: GameTab, text: string) {
  typeInto(tab, tab.element("chatInput"), text);
  submit(tab, tab.element("chatForm"));
  await tab.play(4_000);
}
/** Opens the action sheet of the chat line showing `text`. */
async function openActions(tab: GameTab, text: string) {
  const line = [...tab.element("chatMessages").querySelectorAll("[data-message-id]")].find(node => node.textContent?.includes(text));
  if (!line) throw new Error(`No chat line "${text}"`);
  tapNode(tab, line.querySelector(".chat-text")!);
  await tab.play(200);
}
const rows = (world: ScenarioWorld, table: string) => [...world.db[table].iter()] as any[];

describe("chat channels", () => {
  it("keeps World, Guild and Private apart: their own messages, drafts and unread counts", async () => {
    const world = gameWorld();
    const ann = world.join("Ann"), moss = world.join("Moss");
    guildOf(world, "OAKS", moss, [ann]);
    say(moss, "said before you came");
    ann.disconnect();
    const tab = withTextInput(await playAs(world, "Ann"));
    await tab.play(1_000);
    // What was said before Ann arrived is history, not unread.
    expect(badge(tab)).toBe(0);

    // One message on each channel while the chat is small: the badge counts all three.
    await tab.play(3_000);
    say(moss, "hello world");
    await tab.play(3_100);
    sayIn(moss, "guild", "guild news");
    await tab.play(3_100);
    sayIn(moss, "dm", "psst, Ann", ann.hex);
    await tab.play(500);
    expect(badge(tab)).toBe(3);

    // Opening the chat on World reads World only.
    tab.tap("chatSizeToggle");
    await tab.play(300);
    expect(chatText(tab)).toContain("hello world");
    expect(chatText(tab)).not.toContain("guild news");
    tab.tap("chatBackBtn");
    await tab.play(300);
    expect(badge(tab)).toBe(2);

    // A draft stays with its channel; Guild sends to the guild, never to World.
    tab.tap("chatSizeToggle");
    typeInto(tab, tab.element("chatInput"), "half a thought");
    tapNode(tab, channelTab(tab, GUILD));
    await tab.play(300);
    expect(chatText(tab)).toContain("guild news");
    expect(chatText(tab)).not.toContain("hello world");
    expect((tab.element("chatInput") as HTMLTextAreaElement).value).toBe("");
    await send(tab, "guild hello");
    expect(rows(world, "socialMessage").some(row => row.sender.isEqual(ann.identity) && row.channel === "guild" && row.message === "guild hello")).toBe(true);
    expect(rows(world, "chatMessage").some(row => row.sender.isEqual(ann.identity))).toBe(false);
    tapNode(tab, channelTab(tab, PUBLIC));
    await tab.play(300);
    expect((tab.element("chatInput") as HTMLTextAreaElement).value).toBe("half a thought");

    // Private opens on the people Ann talks with; Moss's conversation reads and answers privately.
    tapNode(tab, channelTab(tab, PRIVATE));
    await tab.play(300);
    tapNode(tab, tab.document.querySelector(`[data-identity="${moss.hex}"]`)!);
    await tab.play(300);
    expect(chatText(tab)).toContain("psst, Ann");
    await send(tab, "hi Moss");
    expect(rows(world, "socialMessage").some(row => row.sender.isEqual(ann.identity) && row.recipient.isEqual(moss.identity) && row.message === "hi Moss")).toBe(true);
    tab.tap("chatBackBtn");
    tab.tap("chatBackBtn");
    await tab.play(300);
    expect(badge(tab)).toBe(0);

    // A message that lands as the tab goes to the background stays unread, even with the chat open.
    // A hidden tab paints nothing, so the message lands just before the phone sleeps, with no paint between.
    tab.tap("chatSizeToggle");
    tapNode(tab, channelTab(tab, PUBLIC));
    await tab.play(300);
    say(moss, "anyone there?");
    await vi.advanceTimersByTimeAsync(0);
    tab.setHidden(true);
    await tab.play(500);
    expect(channelUnread(tab, PUBLIC)).toBe(1);
    tab.setHidden(false);
    await tab.play(300);
    expect(channelUnread(tab, PUBLIC)).toBe(0);
  }, 60_000);

  it("a message's actions reply, react, report privately and open a private conversation", async () => {
    const world = gameWorld();
    const ann = world.join("Ann"), moss = world.join("Moss");
    guildOf(world, "OAKS", moss, [ann]);
    ann.disconnect();
    const tab = withTextInput(await playAs(world, "Ann"));
    say(moss, "who wants to duel");
    await tab.play(3_100);
    sayIn(moss, "guild", "guild meeting at noon");
    await tab.play(500);
    tab.tap("chatSizeToggle");
    await tab.play(300);
    const mossLine = rows(world, "chatMessage").find(row => row.message === "who wants to duel");

    // Another player's message: reply, report and direct message are all on offer.
    await openActions(tab, "who wants to duel");
    for (const id of ["chatMessageReplyBtn", "chatMessageReportBtn", "chatMessageDirectMessageBtn", "chatMessageReactions"]) expect(tab.shown(id)).toBe(true);
    tab.tap("chatMessageReplyBtn");
    await tab.play(100);
    expect(tab.shown("chatReplyComposer")).toBe(true);
    await send(tab, "me!");
    expect(rows(world, "chatMessage").find(row => row.message === "me!")).toMatchObject({ replyToMessageId: mossLine.id });

    // Ann's own message offers no report and no message to herself.
    await openActions(tab, "me!");
    expect(tab.shown("chatMessageReportBtn")).toBe(false);
    expect(tab.shown("chatMessageDirectMessageBtn")).toBe(false);
    tab.tap("chatMessageActionsBackdrop");
    await tab.play(200);

    // A reaction is stored once for Ann.
    await openActions(tab, "who wants to duel");
    tapNode(tab, tab.element("chatMessageReactions").querySelector("[data-reaction=like]")!);
    await tab.play(500);
    expect(rows(world, "chatReaction").filter(row => row.actor.isEqual(ann.identity) && row.active)).toHaveLength(1);

    // A report on World goes to the chat reports, a report on Guild to the private social reports.
    await tab.play(3_000);
    await openActions(tab, "who wants to duel");
    tab.tap("chatMessageReportBtn");
    tapNode(tab, tab.element("chatMessageReportReasons").querySelector("button")!);
    submit(tab, tab.element("chatMessageReportForm"));
    await tab.play(500);
    expect(rows(world, "chatMessageReport").map(row => row.messageId)).toEqual([mossLine.id]);
    tapNode(tab, channelTab(tab, GUILD));
    await tab.play(3_000);
    await openActions(tab, "guild meeting at noon");
    tab.tap("chatMessageReportBtn");
    tapNode(tab, tab.element("chatMessageReportReasons").querySelector("button")!);
    submit(tab, tab.element("chatMessageReportForm"));
    await tab.play(500);
    expect(rows(world, "socialReport").filter(row => row.reporter.isEqual(ann.identity))).toHaveLength(1);
    expect(rows(world, "chatMessageReport")).toHaveLength(1);

    // "Message" on a World line opens the private conversation with its sender.
    tapNode(tab, channelTab(tab, PUBLIC));
    await tab.play(300);
    await openActions(tab, "who wants to duel");
    tab.tap("chatMessageDirectMessageBtn");
    await tab.play(300);
    await send(tab, "duel me privately");
    expect(rows(world, "socialMessage").find(row => row.message === "duel me privately")).toMatchObject({ channel: "dm" });
    expect(rows(world, "socialMessage").find(row => row.message === "duel me privately").recipient.isEqual(moss.identity)).toBe(true);
  }, 60_000);
});

describe("chat history on screen", () => {
  it("scrolling up loads older pages in order without repeats, and Original jumps to a message far back", async () => {
    const world = gameWorld();
    const moss = world.join("Moss"), cy = world.join("Cy");
    for (let i = 0; i < 130; i++) { say(moss, `old ${i}`); vi.advanceTimersByTime(3_100); }
    const first = rows(world, "chatMessage")[0];
    const tab = withTextInput(await playAs(world, "Ann"));
    tab.tap("chatSizeToggle");
    await tab.play(500);
    const box = tab.element("chatMessages");
    const mounted = () => [...box.querySelectorAll<HTMLElement>("[data-message-id]")].map(node => BigInt(node.dataset.messageId!));
    // The page's layout, which linkedom does not do: a 600 px box of 40 px rows.
    Object.defineProperty(box, "clientHeight", { configurable: true, get: () => 600 });
    Object.defineProperty(box, "scrollHeight", { configurable: true,
      get: () => [...box.children].reduce((sum, child) => sum + (parseFloat((child as HTMLElement).style.height) || 40), 0) });
    const scrollUp = async () => {
      for (const top of [400, 0]) { box.scrollTop = top; box.dispatchEvent(new (tab.window as any).Event("scroll")); await tab.play(500); }
    };
    let oldest = mounted()[0];
    for (let swipe = 0; swipe < 10 && oldest > first.id; swipe++) {
      await scrollUp();
      const ids = mounted();
      // Each screenful is in order with no message twice.
      expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : 1)));
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids[0]).toBeLessThanOrEqual(oldest);
      oldest = ids[0];
    }
    expect(oldest).toBe(first.id);

    // Back at the latest, a reply to the very first message jumps to it.
    tab.tap("chatBackBtn");
    await tab.play(300);
    cy.call("sendChatReply", { message: "remember this one?", replyToMessageId: first.id });
    tab.tap("chatSizeToggle");
    await tab.play(500);
    await openActions(tab, "remember this one?");
    expect(tab.shown("chatMessageOriginalBtn")).toBe(true);
    tab.tap("chatMessageOriginalBtn");
    await tab.play(500);
    expect(mounted()).toContain(first.id);
  }, 60_000);
});

describe("other players in chat", () => {
  it("show their portrait, their guild tag and their name as plain text, and a new portrait replaces the old", async () => {
    const world = gameWorld();
    const moss = world.join("Moss"), ann = world.join("Ann");
    guildOf(world, "OAKS", moss);
    const nasty = "<img src=x onerror=alert(1)>";
    moss.patch("playerProfile", { displayName: nasty });
    moss.call("setProfileIcon", { profileIcon: 12 });
    ann.disconnect();
    const tab = withTextInput(await playAs(world, "Ann"));
    say(moss, "look at my picture");
    tab.tap("chatSizeToggle");
    await tab.play(1_000);
    const line = () => [...tab.element("chatMessages").querySelectorAll("[data-message-id]")].find(node => node.textContent?.includes("look at my picture"))!;
    const portrait = () => line().querySelector<HTMLElement>(`[data-avatar-owner="${moss.hex}"]`)!;
    expect(portrait().dataset.profileIcon).toBe("12");
    // Guild tags show once Show Guild Tags is on, on the line already written.
    tab.tap("guildTagsToggle");
    await tab.play(500);
    const name = line().querySelector<HTMLElement>(".chat-name")!;
    expect(name.textContent).toContain("[OAKS]");
    expect(name.textContent).toContain(nasty);
    expect(tab.element("chatMessages").querySelector("img[src=x]")).toBeNull();

    // He picks another picture: the line he already wrote shows it.
    moss.call("setProfileIcon", { profileIcon: 30 });
    expect(await tab.until(() => portrait().dataset.profileIcon === "30", 120_000, 1_000)).toBe(true);
  }, 90_000);
});

describe("a muted player", () => {
  it("cannot write but keeps reading, and gets the chat box back by itself when the mute ends", async () => {
    const world = gameWorld();
    const moss = world.join("Moss");
    const tab = withTextInput(await playAs(world, "Ann"));
    const ann = tab.network.players.get("Ann")!;
    tab.tap("chatSizeToggle");
    await tab.play(300);
    world.player("Owner", "owner").connect().call("devSetChatMute", { identity: ann.identity, minutes: 1 });
    await tab.play(500);
    const input = tab.element("chatInput") as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    say(moss, "can you read this");
    await tab.play(500);
    expect(chatText(tab)).toContain("can you read this");
    await tab.play(60_000, 1_000);
    expect(input.disabled).toBe(false);
    await send(tab, "back again");
    expect(rows(world, "chatMessage").some(row => row.message === "back again")).toBe(true);
  }, 60_000);
});

describe("blocking and reporting", () => {
  it("a block hides past, future and quoted messages and survives a reload; a block that fails is not shown as saved; a report goes privately", async () => {
    const world = gameWorld();
    const ann = world.join("Ann"), moss = world.join("Moss"), cy = world.join("Cy");
    guildOf(world, "OAKS", moss, [ann]);
    say(moss, "moss was here");
    const original = rows(world, "chatMessage").at(-1).id;
    cy.call("sendChatReply", { message: "agreed with moss", replyToMessageId: original });
    ann.disconnect();
    let tab = withTextInput(await playAs(world, "Ann"));
    const annPlayer = tab.network.players.get("Ann")!;
    tab.tap("chatSizeToggle");
    await tab.play(500);
    expect(chatText(tab)).toContain("moss was here");

    // Open Moss's profile from his portrait.
    const openMoss = async () => {
      tapNode(tab, tab.element("chatMessages").querySelector(`[data-avatar-owner="${moss.hex}"]`)!);
      await tab.play(800);
      expect(tab.shown("playerProfile")).toBe(true);
    };
    const safetyDialog = () => tab.document.querySelector("dialog.player-safety-dialog")!;

    // Another tab has taken the account over: the block is refused, and nothing pretends it was saved.
    await openMoss();
    const controller = world.db.playerController.identity.find(annPlayer.identity);
    world.db.playerController.identity.update({ ...controller, connectionId: new ConnectionId(999_999n) });
    tab.tap("profileMoreBtn");
    tab.tap("profileMenuBlockBtn");
    submit(tab, safetyDialog().querySelector("form")!);
    await tab.play(300);
    expect(world.db.playerBlock.count()).toBe(0n);
    expect(tab.coop.isPlayerBlocked(moss.hex)).toBe(false);
    expect(chatText(tab)).toContain("moss was here");
    world.db.playerController.identity.update(controller);

    // Back in control, the block goes through: his message and the quote of it vanish, the reply stays.
    submit(tab, safetyDialog().querySelector("form")!);
    await tab.play(500);
    expect(world.db.playerBlock.count()).toBe(1n);
    expect(chatText(tab)).not.toContain("moss was here");
    expect(chatText(tab)).toContain("agreed with moss");
    tab.tap("closePlayerProfileBtn");

    // What he says later stays hidden, in World and in the guild; a reload remembers the block.
    await tab.play(3_000);
    say(moss, "can you hear me");
    await tab.play(3_100);
    sayIn(moss, "guild", "guild hello from moss");
    await tab.play(500);
    expect(chatText(tab)).not.toContain("can you hear me");
    tab = withTextInput(await tab.reload());
    expect(await tab.until(tab.playing, 20_000)).toBe(true);
    tab.tap("chatSizeToggle");
    await tab.play(500);
    expect(chatText(tab)).toContain("agreed with moss");
    expect(chatText(tab)).not.toContain("moss was here");
    expect(chatText(tab)).not.toContain("can you hear me");
    tapNode(tab, channelTab(tab, GUILD));
    await tab.play(500);
    expect(chatText(tab)).not.toContain("guild hello from moss");

    // A report on Cy goes to the moderators only.
    tapNode(tab, channelTab(tab, PUBLIC));
    await tab.play(300);
    tapNode(tab, tab.element("chatMessages").querySelector(`[data-avatar-owner="${cy.hex}"]`)!);
    await tab.play(800);
    tab.tap("profileMoreBtn");
    tab.tap("profileMenuReportBtn");
    typeInto(tab, safetyDialog().querySelector("select")!, "harassment");
    submit(tab, safetyDialog().querySelector("form")!);
    await tab.play(500);
    expect(rows(world, "playerReport")).toMatchObject([{ reason: "harassment" }]);
    expect(rows(world, "playerReport")[0].target.isEqual(cy.identity)).toBe(true);
  }, 90_000);
});

describe("chat on the server", () => {
  type Page = { messages: { id: bigint; message: string }[]; hasMore: boolean };
  it("history: public pages of fifty without gaps or repeats, a day's expiry that keeps evidence, private and guild history for members only", () => {
    const world = scenarioWorld();
    const ann = world.join("Ann"), moss = world.join("Moss"), cy = world.join("Cy");
    for (let i = 0; i < 253; i++) { world.advance(4_000); say(moss, `Message ${i}`); }
    expect(ann.view("latest_chat_messages_with_reactions")).toHaveLength(50);
    const seen = new Set<bigint>();
    let page = ann.procedure("getChatHistoryWithReactions", { beforeId: 0n }) as Page;
    for (;;) {
      expect(page.messages.length).toBeLessThanOrEqual(50);
      for (const row of page.messages) { expect(seen.has(row.id)).toBe(false); seen.add(row.id); }
      if (!page.hasMore) break;
      // New chat arriving while Ann scrolls back does not shift her pages.
      world.advance(4_000); say(cy, "interrupting");
      page = ann.procedure("getChatHistoryWithReactions", { beforeId: page.messages[0].id }) as Page;
    }
    expect([...seen].filter(id => world.db.chatMessage.id.find(id)?.sender.isEqual(moss.identity))).toHaveLength(253);

    // A filtered message expires with the rest after a day; the moderation log keeps what was said.
    world.advance(4_000);
    say(moss, "send nudes");
    world.advance(86_401_000);
    say(cy, "a new day");
    world.runDue();
    expect([...world.db.chatMessage.iter()].map(row => row.message)).toEqual(["a new day"]);
    expect([...world.db.moderationAction.iter()].some(row => row.before === "send nudes")).toBe(true);

    // A private conversation is read only by its two players; guild history only by members, and not after leaving.
    sayIn(ann, "dm", "just us", moss.hex);
    const dm = (who: typeof ann, peer: typeof ann) => (who.procedure("getSocialChatHistoryWithReactions", { channel: "dm", peer: peer.hex, beforeId: 0n }) as Page).messages.map(row => row.message);
    expect(dm(moss, ann)).toEqual(["just us"]);
    expect(dm(cy, moss)).toEqual([]);
    expect(dm(cy, ann)).toEqual([]);
    guildOf(world, "OAKS", moss, [ann]);
    world.advance(4_000);
    sayIn(moss, "guild", "guild plans");
    const guild = (who: typeof ann) => (who.procedure("getSocialChatHistoryWithReactions", { channel: "guild", peer: "", beforeId: 0n }) as Page).messages.map(row => row.message);
    expect(guild(ann)).toEqual(["guild plans"]);
    expect(() => guild(cy)).toThrow();
    ann.call("leaveGuild");
    expect(() => guild(ann)).toThrow();
    expect(ann.view("my_social_messages_with_reactions").map(row => row.message)).not.toContain("guild plans");
  });

  it("reactions count once per player, credit a heart once, never on your own message, thirty an hour and one every two seconds", () => {
    const world = scenarioWorld();
    const ann = world.join("Ann"), moss = world.join("Moss"), cy = world.join("Cy");
    say(moss, "rate my build");
    const post = [...world.db.chatMessage.iter()].at(-1).id;
    const react = (who: typeof ann, reaction: string, active = true, messageId = post, channel = "public") =>
      who.refusal("setChatMessageReaction", { channel, messageId, reaction, active });
    const reactions = (who: typeof ann, messageId = post, channel = "public") =>
      JSON.parse(who.procedure("getChatMessageReactions", { channel, messageId }) as string) as { counts: Record<string, number>; selected: string[] };
    const hearts = () => world.db.playerChatHearts.identity.find(moss.identity)?.chatHeartsReceived ?? 0n;

    expect(react(ann, "heart")).toBeNull();
    world.advance(2_000);
    expect(react(ann, "heart")).toBeNull();
    expect(reactions(ann)).toEqual({ counts: { heart: 1 }, selected: ["heart"] });
    expect(hearts()).toBe(1n);
    // Taking it back and giving it again credits Moss nothing more; switching keeps one reaction.
    world.advance(2_000); react(ann, "heart", false);
    world.advance(2_000); react(ann, "heart");
    world.advance(2_000); react(ann, "laugh");
    expect(reactions(ann).counts).toEqual({ laugh: 1 });
    expect(hearts()).toBe(1n);
    expect(react(cy, "heart")).toBeNull();
    expect(reactions(cy).counts).toEqual({ laugh: 1, heart: 1 });
    expect(hearts()).toBe(2n);

    // Not on your own message, not an unknown emoji, not a moderator's heart, and not twice inside two seconds.
    expect(react(moss, "heart")).not.toBeNull();
    world.advance(2_000);
    expect(react(ann, "anything")).not.toBeNull();
    expect(react(ann, "gemHeart")).not.toBeNull();
    expect(react(ann, "like")).toBeNull();
    expect(react(ann, "laugh")).not.toBeNull();
    world.advance(2_000);
    expect(react(ann, "laugh")).toBeNull();

    // Thirty new reactions an hour per giver; the budget is the giver's, not the recipient's.
    const posts: bigint[] = [];
    for (let i = 0; i < 31; i++) { world.advance(3_100); say(moss, `post ${i}`); posts.push([...world.db.chatMessage.iter()].at(-1).id); }
    const spent = world.db.chatHeartAllowance.identity.find(ann.identity)?.used ?? 0;
    let refused: string | null = null;
    for (const id of posts.slice(0, 30 - spent + 1)) { world.advance(2_000); refused = react(ann, "dislike", true, id); }
    expect(refused).not.toBeNull();
    expect(react(cy, "heart", true, posts[30])).toBeNull();
    world.advance(3_600_000);
    expect(react(ann, "dislike", true, posts[30])).toBeNull();

    // A private heart is a reaction only: it earns no profile heart.
    world.advance(3_100);
    sayIn(moss, "dm", "thanks", ann.hex);
    const dm = [...world.db.socialMessage.iter()].at(-1).id;
    const before = hearts();
    world.advance(2_000);
    expect(react(ann, "heart", true, dm, "social")).toBeNull();
    expect(reactions(ann, dm, "social").counts).toEqual({ heart: 1 });
    expect(hearts()).toBe(before);
    expect(() => reactions(cy, dm, "social")).toThrow();

    // Only the database owner hands out the moderator's gem heart.
    expect(cy.refusal("devGrantGemHeart", { identity: cy.identity, enabled: true })).not.toBeNull();
    world.player("Owner", "owner").connect().call("devGrantGemHeart", { identity: cy.identity, enabled: true });
    world.advance(2_000);
    expect(react(cy, "gemHeart")).toBeNull();

    // Ann signs in to an account: the heart she already gave is not credited again.
    const code = "c".repeat(40);
    ann.call("beginAccountLink", { code });
    const account = world.player("Ann's account", "account").connect();
    account.call("claimGuestAccount", { code });
    const credited = hearts();
    world.advance(2_000);
    account.refusal("setChatMessageReaction", { channel: "public", messageId: post, reaction: "heart", active: true });
    expect(hearts()).toBe(credited);
  });

  it("friends need both to agree, private messages reach only their two players, a link carries friends and messages, and a year-old message ages out", () => {
    const world = scenarioWorld();
    const ann = world.join("Ann"), moss = world.join("Moss"), cy = world.join("Cy");
    const hub = (who: typeof ann) => JSON.parse(who.view("my_social_hub")[0].snapshot) as { friends: { identity: string }[];
      incomingRequests: { id: string }[]; outgoingRequests: unknown[]; conversations: { identity: string }[] };
    const messages = (who: typeof ann) => who.view("my_social_messages_with_reactions").map(row => row.message);

    // A request waits for Moss; Cy cannot answer it for him.
    ann.call("friendAction", { action: "request", target: moss.hex });
    expect(hub(ann).friends).toEqual([]);
    const [request] = hub(moss).incomingRequests;
    expect(cy.refusal("friendAction", { action: "accept", target: request.id })).not.toBeNull();
    moss.call("friendAction", { action: "accept", target: request.id });
    expect(hub(ann).friends.map(friend => friend.identity)).toEqual([moss.hex]);
    expect(hub(moss).friends.map(friend => friend.identity)).toEqual([ann.hex]);

    // Private messages need no friendship, and only the two players read them; a filtered one is kept as evidence.
    sayIn(cy, "dm", "hi stranger", ann.hex);
    world.advance(3_100);
    sayIn(ann, "dm", "send nudes", moss.hex);
    expect(messages(ann)).toEqual(["hi stranger", expect.not.stringContaining("nudes")]);
    expect(messages(moss)).toHaveLength(1);
    expect(messages(cy)).toEqual(["hi stranger"]);
    expect([...world.db.moderationAction.iter()].map(row => row.before)).toContain("send nudes");
    // Reporting is for the recipient, once.
    const filtered = [...world.db.socialMessage.iter()].at(-1).id;
    expect(cy.refusal("reportSocialMessage", { messageId: filtered, reason: "harassment" })).not.toBeNull();
    moss.call("reportSocialMessage", { messageId: filtered, reason: "harassment" });
    expect(moss.refusal("reportSocialMessage", { messageId: filtered, reason: "harassment" })).not.toBeNull();
    expect(world.db.playerReport.count()).toBe(1n);

    // Removing a friend removes it for both.
    moss.call("friendAction", { action: "remove", target: ann.hex });
    expect(hub(ann).friends).toEqual([]);
    ann.call("friendAction", { action: "request", target: moss.hex });
    moss.call("friendAction", { action: "accept", target: hub(moss).incomingRequests[0].id });

    // Ann signs in to an account: her friend and her conversations come with her.
    const code = "d".repeat(40);
    ann.call("beginAccountLink", { code });
    const account = world.player("Ann's account", "account").connect();
    account.call("claimGuestAccount", { code });
    expect(hub(account).friends.map(friend => friend.identity)).toEqual([moss.hex]);
    expect(messages(account)).toHaveLength(2);
    expect(hub(moss).friends.map(friend => friend.identity)).toEqual([account.hex]);

    // A year and a day on, the old messages age out and the new ones stay.
    world.advance(366 * 86_400_000);
    sayIn(moss, "dm", "long time no see", account.hex);
    world.runDue();
    expect(messages(account)).toEqual(["long time no see"]);
  });

  it("three filtered messages in a day mute for an hour (a day when it repeats within a week); every send is refused but /bug, and reading goes on", () => {
    const world = scenarioWorld();
    const ann = world.join("Ann"), moss = world.join("Moss");
    guildOf(world, "OAKS", moss, [ann]);
    say(moss, "hello all");
    const post = [...world.db.chatMessage.iter()].at(-1).id;
    const mutedUntil = () => Number(world.db.playerChatMute.identity.find(ann.identity)?.mutedUntilMicros ?? 0n) / 1000;
    const strike = (send: () => void) => { world.advance(3_100); send(); };

    // Two strikes, on any channel, do nothing yet; strikes older than a day fall away.
    strike(() => say(ann, "send nudes"));
    strike(() => sayIn(ann, "guild", "send nudes"));
    expect(mutedUntil()).toBeLessThanOrEqual(world.now());
    world.advance(86_400_000);
    strike(() => sayIn(ann, "dm", "send nudes", moss.hex));
    expect(mutedUntil()).toBeLessThanOrEqual(world.now());
    // The third within a day mutes for an hour.
    strike(() => say(ann, "send nudes"));
    strike(() => say(ann, "send nudes"));
    expect(mutedUntil() - world.now()).toBe(3_600_000);

    // Every way to talk is refused, reactions too; a bug report still goes through and reading goes on.
    world.advance(3_100);
    expect(ann.refusal("sendChatMessage", { message: "hello" })).not.toBeNull();
    expect(ann.refusal("sendChatReply", { message: "hello", replyToMessageId: post })).not.toBeNull();
    expect(ann.refusal("sendSocialMessage", { channel: "guild", target: "", message: "hi", replyToMessageId: 0n })).not.toBeNull();
    expect(ann.refusal("sendSocialMessage", { channel: "dm", target: moss.hex, message: "hi", replyToMessageId: 0n })).not.toBeNull();
    expect(ann.refusal("setChatMessageReaction", { channel: "public", messageId: post, reaction: "like", active: true })).not.toBeNull();
    expect(ann.refusal("sendChatMessage", { message: "/bug the map froze" })).toBeNull();
    expect(world.db.bugReport.count()).toBe(1n);
    expect(ann.view("latest_chat_messages_with_reactions").some(row => row.id === post)).toBe(true);

    // It ends on time.
    world.advance(mutedUntil() - world.now() - 1);
    expect(ann.refusal("sendChatMessage", { message: "hello" })).not.toBeNull();
    world.advance(1);
    expect(ann.refusal("sendChatMessage", { message: "hello" })).toBeNull();

    // Three more within the week: a day this time.
    for (let i = 0; i < 3; i++) strike(() => say(ann, "send nudes"));
    expect(mutedUntil() - world.now()).toBe(86_400_000);
  });

  it("a suspension lasts at most seven days unless it is permanent, and a developer's mute or ban stops the player chatting", () => {
    const world = scenarioWorld();
    const ann = world.join("Ann"), rude = world.join("Rude");
    const owner = world.player("Owner", "owner").connect();
    const name = world.db.playerProfile.identity.find(rude.identity).displayName;
    const day = 86_400_000_000n, now = () => BigInt(world.now()) * 1000n;
    // Nobody else can.
    expect(ann.refusal("devSetChatMute", { identity: rude.identity, minutes: 60 })).not.toBeNull();
    expect(ann.refusal("devSuspendPlayerAccount", { identity: rude.identity, expectedDisplayName: name, untilMicros: 0n, reason: "x" })).not.toBeNull();

    owner.call("devSetChatMute", { identity: rude.identity, minutes: 30 });
    expect(rude.refusal("sendChatMessage", { message: "let me talk" })).not.toBeNull();
    owner.call("devSetChatMute", { identity: rude.identity, minutes: 0 });
    expect(rude.refusal("sendChatMessage", { message: "thanks" })).toBeNull();

    expect(owner.refusal("devSuspendPlayerAccount", { identity: rude.identity, expectedDisplayName: name, untilMicros: now() + 8n * day, reason: "too long" })).not.toBeNull();
    expect(world.db.defeatSessionRestriction.identity.find(rude.identity)).toBeNull();
    owner.call("devSuspendPlayerAccount", { identity: rude.identity, expectedDisplayName: name, untilMicros: now() + 7n * day, reason: "a week off" });
    // Banned: the session ends and the player cannot come back in to chat.
    world.advance(3_100);
    expect(rude.refusal("sendChatMessage", { message: "still here?" })).not.toBeNull();
    owner.call("devSuspendPlayerAccount", { identity: rude.identity, expectedDisplayName: name, untilMicros: 0n, reason: "for good" });
    expect(world.db.defeatSessionRestriction.identity.find(rude.identity).blockedUntilMicros).toBe(PERMANENT_SUSPENSION_MICROS);
    expect([...world.db.moderationAction.iter()].map(row => row.actorType)).not.toContain("automatic");
  });
});
