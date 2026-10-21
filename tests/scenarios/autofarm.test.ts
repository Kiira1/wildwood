import { describe, expect, it, vi } from "vitest";
import { simPlayer } from "./harness/sim";
import { scenarioWorld } from "./harness/server";
import { TERMS_VERSION } from "../../shared/legal";
import { VIRTUAL_PLAYER_TICKET_HEX_LENGTH } from "../../shared/virtual-player-load-test";
import { distance, farmedSeconds, fromCamp, killSimPlayer } from "./harness/farm";
import { DEFAULT_ATTACK_INTERVAL, PLAYER_BASE_REGEN } from "../../shared/rules";
import { BASIC_PAPER_HAT, STARTER_STONE } from "../../shared/items";
import { GRADE_GOLD_PRICE } from "../../shared/gear-grades";
import { AUTO_FARM_WEIGHTS_KEY } from "../../src/game/runtime/auto-farm/auto-farm-plan";
import { bossAggroRange } from "../../src/game/runtime/auto-farm/boss-zone";
import { createStatTrackerModel, RUN_SETTLE_MS } from "../../src/ui/stat-tracker-model";

// Auto Farm played headless on the game's own frame step (tests/scenarios/harness/sim.ts).
// Minutes of play take a few seconds each.
vi.setConfig({ testTimeout: 60_000 });

describe("Auto Farm interruptions (FARM-05)", () => {
  it("a held direction steers the player, and the farm takes its camp up again on release", async () => {
    const sim = simPlayer();
    const { player } = sim.parts;
    await sim.play(20, { autofarm: true });
    const farmed = sim.parts.autoFarm().state().selected!;
    const kills = sim.report().kills;
    expect(kills).toBeGreaterThan(0);

    // The player holds left for two seconds: the player goes left, wherever the farm wanted to go.
    const before = { x: player.x, y: player.y };
    await sim.walk(-1, 0, 2);
    expect(before.x - player.x).toBeGreaterThan(player.speed * 1.5);
    expect(Math.abs(player.y - before.y)).toBeLessThan(40);
    expect(sim.parts.autoFarm().state().active).toBe(true);

    // Let go: it walks back to the stat it was farming and kills there again.
    await sim.play(30, { autofarm: true });
    expect(sim.report().kills).toBeGreaterThan(kills);
    expect(fromCamp(sim, sim.parts.autoFarm().state().selected!)).toBeLessThan(300);
    expect(sim.parts.autoFarm().state().shares[farmed]).toBeGreaterThan(0);
  });

  it("holds through a death and farms the same stats after the respawn", async () => {
    const sim = simPlayer();
    const { player } = sim.parts;
    await sim.play(20, { autofarm: true });
    const shares = sim.parts.autoFarm().state().shares;

    killSimPlayer(sim);
    expect(sim.parts.running()).toBe(false);
    const fallen = { x: player.x, y: player.y };
    // Down: nobody moves the body.
    await sim.play(2, { autofarm: false });
    expect(distance(player, fallen)).toBe(0);

    // The death screen respawns the player at the start; the farm carries on by itself.
    await sim.play(4, { autofarm: false });
    expect(sim.parts.running()).toBe(true);
    const respawned = { x: player.x, y: player.y };
    const kills = sim.report().kills;
    await sim.play(40, { autofarm: false });
    expect(sim.parts.autoFarm().state()).toMatchObject({ active: true, shares });
    expect(distance(player, respawned)).toBeGreaterThan(100);
    expect(sim.report().kills).toBeGreaterThan(kills);
  });
});

/** A saved build: base stats as the server keeps them. */
const build = (damage: number, maxHp: number) => ({ damage, maxHp, armor: 0, regen: PLAYER_BASE_REGEN, attackRate: DEFAULT_ATTACK_INTERVAL });

describe("Auto Farm, the boss and the next map (FARM-03)", () => {
  it("fights the Dragon only once the fight projects a win, wins it, and walks on into the Desert", async () => {
    // Short of the Dragon: Move On farms the Forest and never starts the fight.
    const short = simPlayer({ advance: true, readiness: true, base: build(80, 4_000) });
    let report = await short.play(120, { autofarm: true });
    expect(report.bossAttempts).toEqual([]);
    expect(report.combat.hits.boss ?? 0).toBe(0);
    expect(report.endMap).toBe("tutorial_forest");
    short.dispose();

    // Ready for it: it goes for the Dragon, beats it, and takes the portal it opens.
    const ready = simPlayer({ advance: true, readiness: true, base: build(500, 50_000) });
    report = await ready.play(120, { autofarm: true });
    expect(report.bossAttempts.map(attempt => [attempt.map, attempt.outcome])).toEqual([["tutorial_forest", "won"]]);
    expect(report.travels.map(travel => [travel.from, travel.to])).toEqual([["tutorial_forest", "beginner_desert"]]);
    expect(report.endMap).toBe("beginner_desert");
    ready.dispose();

    // Move At 10x asks for ten times the strength: the same build waits.
    const careful = simPlayer({ advance: true, readiness: true, moveAt: 10, base: build(500, 50_000) });
    report = await careful.play(120, { autofarm: true });
    expect(report.bossAttempts).toEqual([]);
    expect(report.endMap).toBe("tutorial_forest");
  });

  it("starts the fight the moment the build it farms grows ready, not before", async () => {
    const growing = simPlayer({ advance: true, readiness: true, base: build(200, 20_000), economy: true });
    const report = await growing.play(240, { autofarm: true });
    expect(report.bossAttempts).toHaveLength(1);
    expect(report.bossAttempts[0]).toMatchObject({ map: "tutorial_forest", outcome: "won" });
    // It farmed first: the power it set off with is more than it started with.
    expect(report.bossAttempts[0].t).toBeGreaterThan(10);
    expect(report.bossAttempts[0].power).toBeGreaterThan(report.startPower);
    expect(report.deaths).toEqual([]);
  });

  it("with Move On off, farms on beside a boss it could beat", async () => {
    const stay = simPlayer({ advance: false, readiness: true, base: build(500, 50_000) });
    const report = await stay.play(90, { autofarm: true });
    expect(report.bossAttempts).toEqual([]);
    expect(report.endMap).toBe("tutorial_forest");
    expect(report.kills).toBeGreaterThan(0);
  });

  it("past a beaten boss, walks into the next map only once ready for its enemies", async () => {
    const weak = simPlayer({ advance: true, readiness: true, bossBeaten: true, base: build(30, 1_500) });
    let report = await weak.play(90, { autofarm: true });
    expect(report.travels).toEqual([]);
    weak.dispose();
    const ready = simPlayer({ advance: true, readiness: true, bossBeaten: true, base: build(500, 50_000) });
    report = await ready.play(90, { autofarm: true });
    // The Dragon is already down: no fight, straight through its portal.
    expect(report.bossAttempts).toEqual([]);
    expect(report.travels[0]).toMatchObject({ from: "tutorial_forest", to: "beginner_desert", direction: "forward" });
  });
});

describe("A Forest run (FARM-01)", () => {
  it("kills, grows its power, and buys the Smith's grades with the gold and Mastery its kills pay", async () => {
    const before = Date.now();
    const sim = simPlayer({ weapon: STARTER_STONE, head: BASIC_PAPER_HAT, gold: 3_400, masteryPoints: { archery: 10 }, economy: true, seed: 2 });
    const report = await sim.play(90, { autofarm: true });
    expect(report.kills).toBeGreaterThan(0);
    expect(report.endPower).toBeGreaterThan(report.startPower);
    // Every grade the gold pays for, cheapest first: the bow, then the armour.
    expect(report.purchases.map(entry => entry.itemId)).toEqual(["crude_bow", "crude_light_armor", "crude_light_helmet", "crude_ranger_boots"]);
    expect(report.gold).toBeGreaterThanOrEqual(3_400 - 4 * GRADE_GOLD_PRICE.crude);
    // Each kill is a Mastery point for the bow's school.
    expect(report.masteryPoints.archery).toBe(10 + report.kills);
    // A minute and a half of play took no real time, and the real clock is back once it is put away.
    sim.dispose();
    expect(Math.abs(Date.now() - before)).toBeLessThan(60_000);
  });
});

describe("Auto Farm's stat shares (FARM-02)", () => {
  it("farms every stat by default; set shares split the time, damage counting twice, 0% never", async () => {
    const even = simPlayer();
    await even.play(300, { autofarm: true });
    const time = farmedSeconds(even);
    const stats = even.parts.autoFarm().choices().map(choice => choice.key);
    expect(stats.length).toBe(6);
    for (const stat of stats) expect(time[stat] ?? 0).toBeGreaterThan(0);
    even.dispose();

    // 80 / 10 / 10 of health, damage and speed: damage weighs 20, so 80 : 20 : 10 of the time.
    const set = simPlayer({ seed: 3 });
    set.parts.autoFarm().start({ "stat:health": 80, "stat:damage": 10, "stat:speed": 10, "stat:regen": 0, "stat:armor": 0, "stat:crit": 0 });
    await set.play(300, { autofarm: true });
    const split = farmedSeconds(set);
    const total = Object.values(split).reduce((sum, seconds) => sum + seconds, 0);
    expect(split["stat:health"] / total).toBeGreaterThan(.6);
    expect(split["stat:damage"] / total).toBeGreaterThan(.1);
    expect(split["stat:damage"]).toBeGreaterThan(split["stat:speed"]);
    expect(Object.keys(split).sort()).toEqual(["stat:damage", "stat:health", "stat:speed"]);
  });

  it("reads sliders saved by an old version: a stat left at 0% stays off, the rest are farmed by their weight", async () => {
    const sim = simPlayer({ seed: 2 });
    // The 0-200% sliders of before: damage at 200, health at 50, three stats at 0 (speed was never moved, so 100).
    sim.parts.storage.setItem(AUTO_FARM_WEIGHTS_KEY, JSON.stringify({ auto: false, weights: { "stat:damage": 200, "stat:health": 50, "stat:armor": 0, "stat:regen": 0, "stat:crit": 0 } }));
    const farm = sim.parts.autoFarm();
    farm.start(farm.savedShares());
    await sim.play(200, { autofarm: true });
    const time = farmedSeconds(sim);
    expect(Object.keys(time).sort()).toEqual(["stat:damage", "stat:health", "stat:speed"]);
    expect(time["stat:damage"]).toBeGreaterThan(time["stat:speed"]);
    expect(time["stat:speed"]).toBeGreaterThan(time["stat:health"]);
  });
});

describe("Where Auto Farm stands (FARM-04, FARM-08)", () => {
  /** The gap between the player and the nearest enemy, sampled each second the player is attacking. */
  async function attackGaps(weapon: string, profile: Parameters<typeof simPlayer>[0] = {}, shares?: Record<string, number>) {
    const sim = simPlayer({ weapon, base: build(20, 1_000), ...profile });
    if (shares) sim.parts.autoFarm().start(shares);
    const gaps: number[] = [];
    for (let second = 0; second < 120; second++) {
      await sim.play(1, { autofarm: true });
      const { player } = sim.parts;
      if (player.combatFacing == null) continue;
      gaps.push(Math.min(...sim.enemiesNear().map(enemy => distance(enemy, player) - enemy.r - player.r)));
    }
    if (!profile.reflectOnly) expect(sim.report().kills).toBeGreaterThan(5);
    return gaps;
  }

  it("a sword closes to its own reach to fight, where a bow fights from range", async () => {
    const sword = await attackGaps("wooden_sword"), bow = await attackGaps("starter_bow");
    expect(Math.max(...sword)).toBeLessThan(100);
    expect(bow.filter(gap => gap > 100).length).toBeGreaterThan(0);
  });

  it("in Reflect Only a bow walks up to enemies that shoot from range, since only hits thrown back hurt them", async () => {
    // Damage is paid by camps that keep their distance and shoot.
    const shooting = await attackGaps("starter_bow", {}, only("stat:damage"));
    const reflecting = await attackGaps("starter_bow", { reflectOnly: true, perks: { riposte: 5 } }, only("stat:damage"));
    const far = (gaps: number[]) => gaps.filter(gap => gap > 60).length / gaps.length;
    // Shooting, a fair share of its attacks land from range; reflecting, it stands against them.
    expect(far(shooting)).toBeGreaterThan(.2);
    expect(far(reflecting)).toBeLessThan(far(shooting) / 2);
  });

  it("after the boss kills it, it farms on and tries the boss again only once it is a quarter stronger", async () => {
    const sim = simPlayer({ advance: true, readiness: true, base: build(500, 50_000) });
    // It sets off for the Dragon at once; the Dragon kills it on the way in.
    await sim.play(1, { autofarm: true });
    expect(sim.parts.autoFarm().state().phase).toBe("boss");
    const fellAt = sim.power();
    killSimPlayer(sim);
    await sim.play(60, { autofarm: true });
    expect(sim.report().bossAttempts).toHaveLength(1);
    expect(sim.mapId()).toBe("tutorial_forest");
    expect(sim.power()).toBeLessThan(fellAt * 1.25);
    // Far stronger (gear, research): it goes back and wins.
    Object.assign(sim.parts.player, { damage: sim.parts.player.damage * 2, baseMaxHp: sim.parts.player.baseMaxHp * 2 });
    expect(sim.power()).toBeGreaterThan(fellAt * 1.25);
    const report = await sim.play(60, { autofarm: true });
    expect(report.bossAttempts.slice(0, 2).map(attempt => [attempt.map, attempt.outcome])).toEqual([["tutorial_forest", "died"], ["tutorial_forest", "won"]]);
  });

  it("walks round a live boss's range to reach its camp, never into it", async () => {
    const sim = simPlayer();
    const dragon = sim.parts.bosses.dragon!;
    // East of the Dragon, with the only stat on Farm (armor) at a camp to its west.
    Object.assign(sim.parts.player, { x: dragon.x + 960, y: dragon.y + 60 });
    sim.parts.autoFarm().start({ "stat:armor": 100, "stat:health": 0, "stat:damage": 0, "stat:speed": 0, "stat:regen": 0, "stat:crit": 0 });
    let closest = Infinity;
    for (let step = 0; step < 200; step++) {
      await sim.play(.1, { autofarm: false });
      closest = Math.min(closest, distance(dragon, sim.parts.player));
    }
    expect(fromCamp(sim, "stat:armor")).toBeLessThan(300);
    expect(closest).toBeGreaterThan(bossAggroRange("tutorial_forest")!);
    expect(sim.report().combat.hits.boss ?? 0).toBe(0);
  });
});

/** Shares with one stat on Farm and the rest Off. */
const only = (stat: string) => Object.fromEntries(["stat:health", "stat:damage", "stat:speed", "stat:regen", "stat:armor", "stat:crit"].map(key => [key, key === stat ? 100 : 0]));

describe("Pull and Aggro switches (FARM-10)", () => {
  /** Farms Max Health for a minute; returns the kinds pulled, how far the player walked after settling, and the closest a pulled enemy came. */
  async function farmHealth(profile: Parameters<typeof simPlayer>[0]) {
    const sim = simPlayer({ base: build(20, 1_000), ...profile });
    const farm = sim.parts.autoFarm();
    farm.start(only("stat:health"));
    const kinds = new Set<string>();
    let walked = 0, closest = Infinity, last = { x: sim.parts.player.x, y: sim.parts.player.y };
    for (let second = 0; second < 60; second++) {
      await sim.play(1, { autofarm: false });
      for (const enemy of sim.parts.enemies) if (farm.pulls(enemy)) {
        kinds.add(enemy.type);
        closest = Math.min(closest, distance(enemy, sim.parts.player));
      }
      if (second >= 20) walked += distance(last, sim.parts.player);
      last = { x: sim.parts.player.x, y: sim.parts.player.y };
    }
    return { kinds: [...kinds].sort(), walked, closest, kills: sim.report().kills, healthKinds: farm.choices().find(choice => choice.key === "stat:health")!.kinds };
  }

  it("Pull brings the farmed stat's whole camp to a player who stands and fights; off, nothing comes", async () => {
    const pulling = await farmHealth({ pull: true });
    expect(pulling.kinds.length).toBeGreaterThan(0);
    for (const kind of pulling.kinds) expect(pulling.healthKinds).toContain(kind);
    expect(pulling.closest).toBeLessThan(100);
    expect(pulling.walked).toBeLessThan(50);
    expect(pulling.kills).toBeGreaterThan(0);

    const walking = await farmHealth({ pull: false });
    expect(walking.kinds).toEqual([]);
    expect(walking.walked).toBeGreaterThan(200);
  });

  it("Target Lowest HP heads for the most wounded enemy of the stat across the map, where Closest takes the nearest", async () => {
    const walkFor = async (priority: "lowest" | "closest") => {
      const sim = simPlayer();
      const start = { x: sim.parts.player.x, y: sim.parts.player.y };
      // The King Slime across the map (it pays health too) is down to its last point; the Brambles are nearer.
      const wounded = sim.parts.enemies.find(enemy => enemy.type === "King Slime")!;
      wounded.hp = 1;
      sim.parts.autoFarm().setPriority(priority);
      sim.parts.autoFarm().start(only("stat:health"));
      await sim.play(8, { autofarm: false });
      return distance(wounded, start) - distance(wounded, sim.parts.player);
    };
    const lowest = await walkFor("lowest"), closest = await walkFor("closest");
    expect(lowest).toBeGreaterThan(1_200);
    expect(closest).toBeLessThan(lowest / 2);
  });

  it("an Aggro run's groups chase the player from arrival, as many as the run asks for, and Pull brings nothing else", async () => {
    for (const count of [1, 2]) {
      const sim = simPlayer({ aggro: count, pull: true, base: build(20, 1_000) });
      const farm = sim.parts.autoFarm();
      const chasing = new Set<string>();
      for (let second = 0; second < 10; second++) {
        await sim.play(1, { autofarm: true });
        for (const enemy of sim.parts.enemies) if (farm.forced(enemy)) chasing.add(enemy.type);
        expect(sim.parts.enemies.filter(enemy => farm.pulls(enemy) && !farm.forced(enemy))).toEqual([]);
      }
      const groups = new Set([...chasing].map(kind => farm.choices().find(choice => choice.kinds.includes(kind))!.key));
      expect(groups.size).toBe(count);
      sim.dispose();
    }
  });

  it("a stat switched to Aggro is pulled while another is farmed", async () => {
    const aggro = await farmHealth({ aggroGroups: ["stat:speed"] });
    expect(aggro.kinds).toEqual(["Needle"]);
    expect(aggro.closest).toBeLessThan(100);
  });
});

describe("Map changes Auto Farm did not make (FARM-06)", () => {
  it("walked through a portal by hand, it farms the next map with the same shares and stays there", async () => {
    const sim = simPlayer({ bossBeaten: true, base: build(60, 5_000) });
    const farm = sim.parts.autoFarm();
    farm.start(only("stat:damage"));
    await sim.play(10, { autofarm: false });
    // The player steers into the Forest's portal to the Desert while the farm runs.
    const portal = sim.parts.mapController.activePortal()!;
    for (let step = 0; step < 60 && sim.mapId() === "tutorial_forest"; step++) {
      const { player } = sim.parts, length = distance(portal, player);
      await sim.walk((portal.x - player.x) / length, (portal.y - player.y) / length, .5);
    }
    expect(sim.mapId()).toBe("beginner_desert");
    const arrival = { x: sim.parts.player.x, y: sim.parts.player.y };
    await sim.play(30, { autofarm: false });
    expect(farm.state()).toMatchObject({ active: true, selected: "stat:damage" });
    expect(farm.state().shares["stat:health"]).toBe(0);
    expect(distance(sim.parts.player, arrival)).toBeGreaterThan(200);
    expect(sim.mapId()).toBe("beginner_desert");
  });
});

describe("The stat tracker's session (FARM-12)", () => {
  // The tracker's own model over a stored session and a clock, as the HUD card runs it each second.
  const stats = { power: 1_000, hp: 500, damage: 100, armor: 20, regen: 5, attackSpeed: 10, critDamage: 10, kills: 50 };
  const gains = (result: ReturnType<ReturnType<typeof createStatTrackerModel>["update"]>) => Object.fromEntries(result!.rows.map(row => [row.stat, row.gain]));
  function browser() {
    const saved = new Map<string, string>();
    let time = 1_000;
    const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
    return { open: () => createStatTrackerModel(storage, () => time), wait: (ms: number) => { time += ms; } };
  }

  it("an hour's gains survive a reload, and a gear swap never reads as a loss", async () => {
    const tab = browser();
    let tracker = tab.open();
    tracker.update("ann", stats, 0, { run: "main", basePower: 900 });
    tab.wait(1_800_000);
    let now = tracker.update("ann", { ...stats, damage: 100.25, kills: 60, power: 1_050 }, 0, { run: "main", basePower: 950 })!;
    expect(gains(now)).toMatchObject({ damage: .25, kills: 10, power: 50 });
    expect(now.rows.find(row => row.stat === "kills")!.perHour).toBe(20);
    tracker.save();
    // Reloaded: the same session, and another character's is its own.
    tracker = tab.open();
    expect(gains(tracker.update("bob", { ...stats, power: 9_000 })!).power).toBe(0);
    now = tracker.update("ann", { ...stats, damage: 100.25, kills: 60, power: 1_050 }, 0, { run: "main", basePower: 950 })!;
    expect(now.elapsedMs).toBe(1_800_000);
    expect(gains(now).kills).toBe(10);
    // Weaker gear: power and damage fall below where the session began, and show no gain, never a loss.
    now = tracker.update("ann", { ...stats, damage: 90, power: 900, kills: 61 }, 0, { run: "main", basePower: 950 })!;
    expect(gains(now)).toMatchObject({ damage: 0, power: 0, kills: 11 });
    expect(now.rows.every(row => row.gain >= 0 && row.perHour >= 0)).toBe(true);
  });

  it("starts over for a prestige (unless told to carry on), a challenge and an Aggro run started again after a death", async () => {
    const tab = browser();
    const tracker = tab.open();
    tracker.update("ann", stats, 1, { run: "main", basePower: 900 });
    tab.wait(60_000);
    // A prestige: the level goes up and the session starts over.
    expect(tracker.update("ann", { ...stats, damage: 4, kills: 60 }, 2, { run: "main", basePower: 50 })!.elapsedMs).toBe(0);
    // Reflect Only starts: once the new run has held a moment, its gains are its own.
    tab.wait(60_000);
    tracker.update("ann", { ...stats, power: 50, kills: 70 }, 2, { run: "reflect", basePower: 40 });
    tab.wait(RUN_SETTLE_MS);
    expect(tracker.update("ann", { ...stats, power: 50, kills: 70 }, 2, { run: "reflect", basePower: 40 })!.elapsedMs).toBe(0);
    // An Aggro run that dies starts again from its starting build: so does the session.
    tracker.update("ann", { ...stats, power: 50, kills: 70 }, 2, { run: "aggro", basePower: 40 });
    tab.wait(RUN_SETTLE_MS);
    tracker.update("ann", { ...stats, power: 400, kills: 90 }, 2, { run: "aggro", basePower: 300 });
    tab.wait(600_000);
    tracker.update("ann", { ...stats, power: 50, kills: 90 }, 2, { run: "aggro", basePower: 40 });
    tab.wait(RUN_SETTLE_MS);
    expect(tracker.update("ann", { ...stats, power: 50, kills: 90 }, 2, { run: "aggro", basePower: 40 })!.elapsedMs).toBe(0);

    // With "reset on prestige" off, a prestige carries the gains on and the timer runs on.
    const carrying = browser(), kept = carrying.open();
    kept.setResetOnPrestige(false);
    kept.update("ann", stats, 1, { run: "main", basePower: 1_000 });
    carrying.wait(1_800_000);
    kept.update("ann", { ...stats, damage: 150, kills: 80 }, 1, { run: "main", basePower: 1_500 });
    kept.update("ann", { ...stats, damage: 10, kills: 80 }, 2, { run: "main", basePower: 100 });
    carrying.wait(RUN_SETTLE_MS);
    kept.update("ann", { ...stats, damage: 10, kills: 80 }, 2, { run: "main", basePower: 100 });
    const carried = kept.update("ann", { ...stats, damage: 30, kills: 90 }, 2, { run: "main", basePower: 200 })!;
    expect(carried.elapsedMs).toBe(1_800_000 + RUN_SETTLE_MS);
    expect(gains(carried)).toMatchObject({ damage: 70, kills: 40 });
  });
});

describe("Autofarm puppets on the server and load-test bots (FARM-13)", () => {
  it("holds one plan per visible farmer, anchored where the server last placed them; a repeat or a flicker within seconds writes nothing", () => {
    const world = scenarioWorld();
    const ann = world.join("Ann");
    ann.call("setMultiplayerEnabled", { enabled: true });
    const puppet = () => world.db.playerAutoFarmPuppet.identity.find(ann.identity);
    const at = world.db.player.identity.find(ann.identity);
    ann.call("setAutoFarmPuppet", { group: "stat:damage", camp: "" });
    expect(puppet()).toMatchObject({ mapId: at.mapId, group: "stat:damage", x: at.x, y: at.y });
    const first = puppet().startedAt.microsSinceUnixEpoch;
    // Every write goes to the whole map: the same plan a second later, or a new one straight after, is dropped.
    world.advance(1_000);
    ann.call("setAutoFarmPuppet", { group: "stat:damage", camp: "" });
    ann.call("setAutoFarmPuppet", { group: "stat:health", camp: "" });
    expect(puppet()).toMatchObject({ group: "stat:damage" });
    expect(puppet().startedAt.microsSinceUnixEpoch).toBe(first);
    world.advance(5_000);
    ann.call("setAutoFarmPuppet", { group: "stat:health", camp: "" });
    expect(puppet()).toMatchObject({ group: "stat:health" });
    // Stopping ends it at once; so does leaving.
    ann.call("setAutoFarmPuppet", { group: "", camp: "" });
    expect(puppet()).toBeFalsy();
    world.advance(5_000);
    ann.call("setAutoFarmPuppet", { group: "stat:damage", camp: "" });
    ann.disconnect();
    expect(puppet()).toBeFalsy();
  });

  it("a bot enters the world on its developer's Terms consent, and loses it when the test is cleared", () => {
    const world = scenarioWorld();
    const dev = world.join("Dev", { kind: "developer" });
    const ticket = "a".repeat(VIRTUAL_PLAYER_TICKET_HEX_LENGTH);
    dev.call("devBeginVirtualPlayerLoadTest", { ticket, maxCount: 2 });
    // The load generator connects a fresh identity: nobody accepts the Terms for it.
    const bot = world.player("Bot-1").connect();
    bot.call("joinVirtualPlayerLoadTest", { owner: dev.identity, ticket, mapId: "tutorial_forest", x: 900, y: 900 });
    expect(bot.row("playerLegalConsent")).toMatchObject({ termsVersion: TERMS_VERSION });
    // Joined again, it is lent nothing new.
    const lent = bot.row("playerLegalConsent").acceptedAt.microsSinceUnixEpoch;
    bot.call("joinVirtualPlayerLoadTest", { owner: dev.identity, ticket, mapId: "tutorial_forest", x: 900, y: 900 });
    expect(bot.row("playerLegalConsent").acceptedAt.microsSinceUnixEpoch).toBe(lent);
    expect(bot.refusal("enterWorldWithTutorial", { tabId: `tab-${bot.hex.slice(0, 12)}`, forceTakeover: false })).toBeNull();

    dev.call("devClearVirtualPlayers");
    expect(bot.row("playerLegalConsent")).toBeFalsy();
    expect(dev.row("playerLegalConsent")).toMatchObject({ termsVersion: TERMS_VERSION });
  });

  it("a bot is lent nothing when its developer's consent is out of date", () => {
    const world = scenarioWorld();
    const dev = world.join("Dev", { kind: "developer" });
    dev.patch("playerLegalConsent", { termsVersion: "2001-01-01" });
    const ticket = "b".repeat(VIRTUAL_PLAYER_TICKET_HEX_LENGTH);
    dev.call("devBeginVirtualPlayerLoadTest", { ticket, maxCount: 1 });
    const bot = world.player("Bot-2").connect();
    bot.call("joinVirtualPlayerLoadTest", { owner: dev.identity, ticket, mapId: "tutorial_forest", x: 900, y: 900 });
    expect(bot.row("playerLegalConsent")).toBeFalsy();
  });
});
