import type { Readiness } from '../../../../shared/map-readiness';
import { isWeaponItem } from '../../../../shared/items';
import { isMeleeWeapon, weaponAttackRange } from "../../weapon-combat";
import { WORLD } from '../../constants';
import { monotonicNowMs } from '../../../app/trusted-clock';
import { ENEMY_TYPES, rewardStatLabel, type EnemyDefinition, type EnemyKind } from '../../enemies';
import type { SpawnSite } from '../../world';
import type { Circle, EnemyState, PlayerState, Position } from '../types';
import type { Movement } from '../player-input-controller';
import { isEnemyAttackingPlayer } from '../enemies/enemy-threat';
import { farmRoute } from './auto-farm-navigation';
import { bossSurfaceDistance, bossVerticalRadius } from '../../../../shared/boss-hitbox';
import { carryFarmGroup, compareAutoFarmTargets, farmGroupMatches, farmGroupOf, farmStatGroup, readAutoFarmPriority, soulFarmReward, readAutoFarmPull, readAutoFarmPullGroups, writeAutoFarmPriority, writeAutoFarmPull, writeAutoFarmPullGroups, type AutoFarmGroup, type AutoFarmPriority } from './auto-farm-priority';
import type { createAutoFarmResumeStore } from '../../../app/auto-farm-resume';
import {
  SHARE_REPLAN_SECONDS, decodeFarmPlan, encodeFarmPlan, legacyShares, readBossPower, writeBossPower, readMovePower, writeMovePower, powerStep, readFarmAdvance, readFightBosses, readSavedShares, sharesForGroups, shareFarmKey,
  writeFarmAdvance, writeFightBosses, writeSavedShares, type FarmReward, type FarmShares,
} from './auto-farm-plan';
import { formatCompactNumber } from '../../../../shared/compact-number';
import { isSoulMap, SOUL_STAT_DETAILS, type SoulStatId } from '../../../../shared/soul-dimension';
import { soulStatOfCampName } from '../../soul-world';

/** An attacker of another kind is fought off on the way only if it dies within this many seconds. */
const QUICK_DEFENCE_SECONDS = 3;

export type AutoFarmController = ReturnType<typeof createAutoFarmController>;
const idle = (): Movement => ({ x: 0, y: 0, source: 'none' });
/** How far inside its full reach autofarm stops: enough that a target at the stop point is still in range. */
export const AUTO_FARM_REACH_MARGIN = 6;
/** A waypoint this close is reached; the stop point gets the same slack. */
const WAYPOINT_REACHED = 2;
/** How long a pulled group may take to arrive before autofarm walks out to it. */
export const PULL_WAIT_SECONDS = 4;
/** How long after a boss win the way forward is looked at: the unlock reaches the map's portals in a moment. */
const BOSS_WIN_SETTLE_MS = 5_000;
/**
 * How long Move On waits for the enemies attacking the player to die before it goes anyway. It used to
 * leave the moment power was reached, dragging a half-killed group to the next map ("I killed one mob from
 * the agro group, time to move on"); an Aggro run's chasers never stop coming, so the wait has an end.
 */
export const MOVE_ON_FIGHT_MS = 20_000;
/**
 * After dying to a boss (or on the way to it), it is tried again only once power has grown this much. The
 * readiness check plays the fight with nobody dodging and misses some of a boss's damage; a build it judged
 * ready died to the forest dragon hundreds of times over in the autofarm sim.
 */
export const BOSS_RETRY_GROWTH = 1.25;
/** How long each Aggro group's turn at being pulled lasts when more are on Aggro than the pull limit. */
export const PULL_TURN_SECONDS = 60;
/** Damage gets this many times the farming time of each other stat on Farm: kills get faster, and every stat with them. */
export const DAMAGE_FARM_WEIGHT = 2;
/**
 * A campaign boss is fought from this close to its hitbox, whatever the
 * weapon's reach: its cones widen from its body, so near it one is a short
 * sidestep, and at the edge of a bow's reach a run that cannot be made in time.
 */
const BOSS_STAND_GAP = 40;

/** What autofarm fights: an enemy, a campaign boss's hitbox (isBoss) or an Endless boss, hit at its centre. */
type Fight = Position & { r: number; ry?: number; hitboxOffsetY?: number; isBoss?: boolean };

/**
 * Where autofarm stops walking (`stop`) and how far the destination may then
 * drift before it walks again (`resume`). Both sit inside the weapon's reach.
 */
export function autoFarmStandoff(options: {
  weaponRange: number;
  playerAttackRange: number;
  melee: boolean;
  playerRadius: number;
  destination: Position & { r?: number; type?: EnemyKind; definition?: EnemyDefinition };
  enemy: boolean;
}) {
  const reachPadding = options.melee && options.enemy ? options.destination.r ?? 0 : 0;
  const reach = Math.max(8, options.weaponRange) + reachPadding;
  // Fight from the edge of the full reach, research and Long Shot included: walk only until the target is in range.
  const stop = Math.max(8, reach - AUTO_FARM_REACH_MARGIN);
  // Walk again a little before the target leaves reach, so the shot is never lost.
  return { stop, resume: stop + (reach - stop) / 2 };
}

/**
 * Autofarm, with simple rules a player can predict:
 * - Stats: each stat group farmed for its slider's share of the time, the
 *   sliders adding up to 100%, 0% never farmed.
 * - Move On: to the next map once power reaches Move At times its
 *   recommended power.
 * - Fight Bosses: the boss once power reaches Fight At times its recommended
 *   power, fought until it or the player is down. A boss already beaten is left
 *   alone.
 * - Deaths: it respawns and goes on with the same settings. Nothing is
 *   remembered, nothing is retried later, it never steps back a map.
 * - Pull Whole Group: the whole camp at once, or one enemy at a time.
 * It walks to its target and fights standing.
 */
export function createAutoFarmController(options: {
  player: PlayerState;
  enemies: EnemyState[];
  spawnSites: SpawnSite[];
  mapId: () => string;
  equippedWeapon?: () => string;
  localIdentity?: () => string | undefined;
  connection?: () => 'ready' | 'recovering' | 'ended';
  now?: () => number;
  resumeStore?: ReturnType<typeof createAutoFarmResumeStore>;
  unavailable: () => string | null;
  paused: () => boolean;
  speed: () => number;
  obstacles: () => Circle[];
  priorityStorage?: () => Pick<Storage, 'getItem' | 'setItem'> | undefined;
  /** The live build's power, as the profile shows it before rounding. */
  power?: () => number;
  /** A map's recommended power (auto-farm-power.ts); null when it has none. */
  mapPower?: (mapId: string) => number | null;
  /** This map's boss's recommended power; null when it has none (the map's own is used). */
  bossPower?: () => number | null;
  /**
   * Whether the build is ready for a map's enemies made `margin` times as strong (map-readiness.ts): what Move On
   * goes by. Undefined while that map's live balance loads; null when the map has no regular enemies. Without
   * it (tests, the sim), the recommended power above is used.
   */
  mapReady?: (mapId: string, margin: number) => Readiness | null | undefined;
  /** The same for this map's boss and Fight Bosses; null when it cannot tell, and the boss's power is used. */
  bossReady?: (margin: number) => Readiness | null | undefined;
  /** This map's boss while it stands (null once it is down or respawning). */
  mapBoss?: () => (Fight & { dead?: boolean }) | null;
  /** Reflect Only: the bow does nothing, so enemies must be stood among to be hit and hit back. */
  reflectOnly?: () => boolean;
  /** The unlocked portal forward to the next map, at its trigger point. */
  nextPortal?: () => (Position & { destination: string }) | null;
  /** The portal back to the previous map. */
  previousPortal?: () => (Position & { destination: string }) | null;
  /** Whether beating this map's boss opens a locked way forward. */
  bossUnlocksNext?: () => boolean;
  /** How many picked camps (stat groups) Pull aggroes at once: one, one more per Aggro win, and none during a run. */
  pullCamps?: () => number;
  /** During an Aggro run: the stat groups the player picked and how many must chase them on every map, farming or not. */
  forcedGroups?: () => { groups: readonly string[]; needed: number } | null;
  /** Sends one line about a death while farming (deathReport), so where Auto Farm dies can be read from real play. */
  reportDeath?: (detail: string) => void;
  /** Whether a kill of this reward gives nothing now, the stat at its cap: the "Capped" its label shows (reward-labels.ts). */
  rewardCapped?: (reward: FarmReward, soul: SoulStatId | null) => boolean;
}) {
  const { player, enemies, spawnSites } = options;
  const now = options.now ?? monotonicNowMs;
  let priority: AutoFarmPriority = readAutoFarmPriority(options.priorityStorage);
  let pullAll = readAutoFarmPull(options.priorityStorage);
  /** The groups switched to Aggro beside their sliders; null until one is touched, when Pull Whole Group's own picks apply. */
  let pullPicks = readAutoFarmPullGroups(options.priorityStorage);
  let advance = readFarmAdvance(options.priorityStorage);
  let fightBosses = readFightBosses(options.priorityStorage);
  /** The sliders under the switches: the share of the next map's power, and of the boss's, to have before going (1 is even). */
  let movePower = readMovePower(options.priorityStorage);
  let bossPower = readBossPower(options.priorityStorage);
  /** This map's sliders, and its groups above 0%, the largest first. */
  let shares: FarmShares = {};
  let order: string[] = [];
  /** Seconds spent farming each group on this map (walking to it included), for its share. */
  let spent = new Map<string, number>(), spentMap = '';
  /** What it is doing now: a camp, the boss, or walking to another map. */
  let phase: 'farm' | 'boss' | 'portal' = 'farm';
  let travellingTo: string | null = null;
  /** A boss beaten that left the way forward shut: not fought again on that map. */
  const opensNothing = new Set<string>();
  let bossWin: { mapId: string; at: number } | null = null;
  let planClock = 0;
  /** How long it has stood waiting for a pulled group that never arrives. */
  let pullWait = 0;
  let selected: string | null = null;
  let selectedType: AutoFarmGroup | null = null;
  let selectedLabel = "";
  let active = false;
  let manualControl = false;
  let pendingResume = options.resumeStore?.read() ?? null;
  let startedMap = '';
  let startedIdentity: string | undefined;
  let recovering = false;
  let readySince: number | null = null;
  let status = 'Choose stats to begin';
  let target: EnemyState | null = null;
  let route: Position[] = [];
  let routeClock = 0;
  let lastGoal: Position | null = null;
  // True while standing in range; walking resumes only past the resume distance.
  let holding = false;
  const distance = (point: Position) => Math.hypot(point.x - player.x, point.y - player.y);
  const validEnemy = (enemy: EnemyState) => !enemy.dead && !enemy.remoteCombatGhost && !enemy.generatedBoss && selectedType !== null
    && farmGroupMatches(enemy, selectedType) && enemy.hp > 0;
  /** A stat with a share on Farm, or one an Aggro run chases. */
  const farmedGroup = (enemy: EnemyState) => order.includes(choiceKey(enemy)) || forcedGroups().has(choiceKey(enemy));
  // Power is read for every decision; the build changes a kill at a time, so twice a second is plenty.
  let powerAt = -Infinity, powerNow = 0;
  function currentPower() {
    const at = now();
    if (at - powerAt >= 500 || at < powerAt) { powerAt = at; powerNow = options.power?.() ?? 0; }
    return powerNow;
  }

  /**
   * One choice per stat: a camp's regulars and elites, and every camp paying
   * it, are one entry. In the Soul Dimension, one per soul stat the player's tier has woken.
   */
  const choiceKey = (site: Pick<SpawnSite, 'type' | 'definition' | 'campName'>) => farmGroupOf(site);
  function choices() {
    const counts = new Map<string, { key: AutoFarmGroup; type: EnemyKind; kinds: EnemyKind[]; label: string;
      alive: number; total: number; reward: FarmReward; maxReward: number; soul: SoulStatId | null }>();
    for (const site of spawnSites) {
      const key = choiceKey(site), definition = site.definition ?? ENEMY_TYPES[site.type];
      // A soul enemy pays its soul stat, flat, and nothing to the run.
      const soul = soulStatOfCampName(site.campName), reward: FarmReward = soul ? soulFarmReward(soul) : definition.reward;
      const choice = counts.get(key) ?? { key, type: site.type, kinds: [], label: soul ? `Soul ${SOUL_STAT_DETAILS[soul].label}` : rewardStatLabel(reward),
        alive: 0, total: 0, reward: { ...reward }, maxReward: reward.amount, soul };
      choice.total++;
      if (!choice.kinds.includes(site.type)) choice.kinds.push(site.type);
      choice.reward.amount = Math.min(choice.reward.amount, reward.amount);
      choice.maxReward = Math.max(choice.maxReward, reward.amount);
      counts.set(key, choice);
    }
    for (const enemy of enemies) if (!enemy.dead && !enemy.remoteCombatGhost && !enemy.generatedBoss && enemy.hp > 0) {
      const choice = counts.get(choiceKey(enemy));
      if (choice) choice.alive++;
    }
    return [...counts.values()];
  }
  const groups = () => choices().map(entry => entry.key);

  /** A stat picked on a campaign map is its soul stat in the Soul Dimension, and back (carryFarmGroup); an enemy kind saved before 0.873 is its stat. */
  function normalizeKey(key: string) {
    if (key.startsWith('stat:') || key.startsWith('soul:')) return carryFarmGroup(key, isSoulMap(options.mapId()));
    const [kind] = key.split(':') as [EnemyKind];
    return ENEMY_TYPES[kind] ? farmStatGroup(ENEMY_TYPES[kind].reward.type) : key;
  }
  /** Shares saved under another map's names, as this map names its groups; a merge keeps the larger. */
  function normalizeShares(next: FarmShares | null) {
    if (!next) return null;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(next)) { const group = normalizeKey(key); out[group] = Math.max(out[group] ?? 0, value); }
    return out;
  }
  /**
   * The sliders saved for this map's groups as the player left them, each 0-100% and all at 0% kept (Pull Only
   * and Chase Only start from that). An even split when none of them is saved; the 0-200% ones of before migrated.
   */
  function savedShares(): FarmShares {
    const here = groups(), mapId = options.mapId();
    const saved = normalizeShares(readSavedShares(mapId, options.priorityStorage));
    if (saved && here.some(key => key in saved)) {
      return Object.fromEntries(here.map(key => [key, Math.min(100, Math.max(0, Math.round(saved[key] ?? 0)))]));
    }
    return sharesForGroups(saved ?? legacyShares(here, mapId, options.priorityStorage, normalizeKey), here);
  }
  /** Saves the sliders as set, for the window and F to start from: this map's groups, 0% ones included. */
  function rememberShares(next: FarmShares) {
    const picked = normalizeShares(next) ?? {};
    writeSavedShares(Object.fromEntries(groups().map(key => [key, picked[key] ?? 0])), options.mapId(), options.priorityStorage);
  }

  // An Aggro run's groups (aggro-picks.ts), read at most twice a second. A run always has its count:
  // picks this map lacks (or none yet) are filled from its other groups, in order, so nothing is left unchased.
  let forcedSet = new Set<string>(), forcedCheckedAt = -Infinity;
  function forcedGroups() {
    const at = now();
    if (at - forcedCheckedAt < 500) return forcedSet;
    forcedCheckedAt = at;
    const forced = options.forcedGroups?.();
    if (!forced) { if (forcedSet.size) forcedSet = new Set(); return forcedSet; }
    const here: string[] = [...new Set(spawnSites.map(site => choiceKey(site)))];
    const chosen = forced.groups.map(normalizeKey).filter(group => here.includes(group)).slice(0, forced.needed);
    for (const group of here) if (chosen.length < forced.needed && !chosen.includes(group)) chosen.push(group);
    if (chosen.length !== forcedSet.size || chosen.some(group => !forcedSet.has(group))) forcedSet = new Set(chosen);
    return forcedSet;
  }

  // Pull's groups. Any number can be switched to Aggro; it pulls as many at once as
  // the limit, one more per Aggro win, taking the one being farmed first, then the next largest sliders.
  // Before any switch is touched, Pull Whole Group's own picks: the farmed group, then the largest sliders.
  let pulled = new Set<string>(), pulledKey = '';
  const pullLimit = () => Math.max(0, options.pullCamps?.() ?? 1);
  /** This map's groups switched to Aggro (all of them, past the limit too). */
  function aggroGroups(): string[] {
    if (!pullPicks) return [];
    const here = new Set(spawnSites.map(site => choiceKey(site)));
    return [...new Set(pullPicks.map(normalizeKey))].filter(group => here.has(group as AutoFarmGroup));
  }
  function pulledGroups() {
    // Zero during an Aggro run: its own chasing groups are the run's pull.
    const count = pullLimit(), key = `${options.mapId()}|${spawnSites.length}|${selected}|${count}|${order.join()}|${pullPicks?.join() ?? '-'}|${pullTurn}`;
    if (key === pulledKey) return pulled;
    const preferred = [selected, ...order].filter((group): group is string => Boolean(group));
    if (pullPicks) {
      const switched = aggroGroups();
      // More on Aggro than the limit: they take turns, the ones pulled least on this map first (a player:
      // "split my agro priorities evenly instead of just ignoring them entirely"). Within the limit, all of them.
      const turns = switched.length > count && pulledTime.size
        ? [...switched].sort((a, b) => (pulledTime.get(a) ?? 0) - (pulledTime.get(b) ?? 0))
        : [...new Set([...preferred.filter(group => switched.includes(group)), ...switched])];
      pulled = new Set(turns.slice(0, count));
    } else pulled = new Set([...new Set(preferred)].slice(0, count));
    pulledKey = key;
    return pulled;
  }
  /** Seconds each Aggro group has been pulled on this map, and the turn counter that moves the pull on. */
  const pulledTime = new Map<string, number>();
  let pullTurn = 0, pullTurnClock = 0, pullTimeMap = '';
  /**
   * Turns move on every PULL_TURN_SECONDS of farming, or at once when every pulled group is cleared while one
   * waiting has enemies up. A new turn picks again, so the camp being farmed is one that is coming.
   */
  function takePullTurns(dt: number) {
    if (pullTimeMap !== options.mapId()) { pullTimeMap = options.mapId(); pulledTime.clear(); pullTurnClock = 0; }
    const switched = pullPicks ? aggroGroups() : [];
    if (switched.length <= pullLimit()) return;
    const pulledNow = pulledGroups();
    for (const group of pulledNow) pulledTime.set(group, (pulledTime.get(group) ?? 0) + dt);
    pullTurnClock += dt;
    const alive = new Map(choices().map(entry => [entry.key as string, entry.alive]));
    const cleared = [...pulledNow].every(group => !(alive.get(group) ?? 0)) && switched.some(group => !pulledNow.has(group) && (alive.get(group) ?? 0) > 0);
    if (pullTurnClock >= PULL_TURN_SECONDS || cleared) { pullTurn++; pullTurnClock = 0; planClock = 0; }
  }
  /** Nothing on Farm: an Aggro run's chasing groups, or every group on Aggro outside one, taking turns (the panel's Go does the same). */
  function zeroPlanGroups(): string[] {
    const chasing = [...forcedGroups()];
    return chasing.length ? chasing : pulling() ? (pullPicks ? aggroGroups() : [...pulledGroups()]) : [];
  }
  /** Whether Pull is bringing anything: a group switched to Aggro, or Pull Whole Group on before any was. */
  const pulling = () => pullPicks ? pulledGroups().size > 0 : pullAll;
  /** Pull brings every group it farms: all of it comes to the player, so walking to camps would only waste time. It stands and fights. */
  function pullCoversFarm() {
    if (!pulling() || !active || manualControl || phase !== 'farm' || !order.length) return false;
    // An Aggro group waiting its turn counts as coming: it is never walked to.
    const pulledNow = pulledGroups(), switched = new Set(pullPicks ? aggroGroups() : []);
    return order.every(group => pulledNow.has(group) || switched.has(group));
  }
  const pulledEnemy = (enemy: EnemyState) => !enemy.dead && !enemy.remoteCombatGhost && !enemy.generatedBoss && enemy.hp > 0 && pulledGroups().has(choiceKey(enemy));
  /** Pull Whole Group on: every enemy of the pulled groups comes, while it farms. */
  const pullsEnemy = (enemy: EnemyState) => pulling() && active && phase === 'farm' && !recovering && !pendingResume && !options.paused() && pulledEnemy(enemy);

  // ---- Move On ----
  /** The power Move On waits for: Move At times the map's recommended power. */
  const mapNeeds = (mapId: string) => (options.mapPower?.(mapId) ?? 0) * movePower;
  /** Enemies attacking the player now (a boss aside): Move On finishes them before it goes. */
  const underAttack = () => enemies.some(enemy => !enemy.generatedBoss && isEnemyAttackingPlayer(enemy, options.localIdentity?.()));
  let fightHeldSince: number | null = null;
  /** Whether Move On, ready to go, is finishing the fight first (MOVE_ON_FIGHT_MS at most). A trip under way goes on. */
  function finishingFight(ready: boolean) {
    if (!ready || phase === 'portal' || !underAttack()) { fightHeldSince = null; return false; }
    fightHeldSince ??= now();
    return now() - fightHeldSince < MOVE_ON_FIGHT_MS;
  }
  /** Readiness, read at most twice a second for each question: building a map's roster is not free. */
  const readyCache = new Map<string, { at: number; value: Readiness | null | undefined }>();
  function cachedReady(key: string, read: () => Readiness | null | undefined) {
    const at = now(), hit = readyCache.get(key);
    if (hit && at >= hit.at && at - hit.at < 500) return hit.value;
    if (readyCache.size > 32) readyCache.clear();
    const value = read();
    readyCache.set(key, { at, value });
    return value;
  }
  const needsLine = (readiness: Readiness) => readiness.needs === 'both' ? 'Need More Damage And Health'
    : readiness.needs === 'damage' ? 'Need More Damage' : 'Need More Health';
  /** Whether the next map is ready, and the status line when it is not (no fixed table, worked out on the client). */
  function readyForMap(destination: string): { ready: boolean; line: string } {
    if (!options.mapReady) {
      const needs = mapNeeds(destination);
      return { ready: currentPower() >= needs, line: `Next Map At ${atPower(needs)}` };
    }
    const readiness = cachedReady(`map:${destination}:${movePower}`, () => options.mapReady!(destination, movePower));
    if (readiness === undefined) return { ready: false, line: 'Reading Next Map' };
    if (readiness === null || readiness.ready) return { ready: true, line: '' };
    return { ready: false, line: `Next Map: ${needsLine(readiness)}` };
  }
  /** The next map's portal, once the build is ready for it with Move At's margin. */
  function exitPortal() {
    if (!advance || options.reflectOnly?.()) return null;
    const portal = options.nextPortal?.();
    return portal && readyForMap(portal.destination).ready ? portal : null;
  }

  // ---- Fight Bosses ----
  /** The power Fight Bosses waits for: Fight At times the boss's recommended power. */
  const bossNeeds = () => (options.bossPower?.() ?? options.mapPower?.(options.mapId()) ?? 0) * bossPower;
  /** Beaten, as far as it can tell: the way forward it holds is open, or a win here opened nothing. */
  const bossBeaten = () => options.bossUnlocksNext?.() === false || opensNothing.has(options.mapId());
  /** Whether to fight the boss now: Fight Bosses on, a boss standing that is not beaten, and power enough (a fight under way goes on). */
  function bossWanted() {
    const boss = options.mapBoss?.(), mapId = options.mapId();
    // A fight that ended with the boss gone was won: whether that opened anything is read a few seconds on.
    if (phase === 'boss' && (!boss || boss.dead)) bossWin = { mapId, at: now() };
    if (bossWin && bossWin.mapId === mapId && now() - bossWin.at >= BOSS_WIN_SETTLE_MS) {
      if (options.bossUnlocksNext?.() === true) opensNothing.add(mapId);
      bossWin = null;
    }
    if (!fightBosses || options.reflectOnly?.() || !boss || boss.dead || bossBeaten()) return false;
    // A fight under way goes on until the boss or the player is down.
    if (phase === 'boss') return true;
    return currentPower() >= (bossRetryPower.get(mapId) ?? 0) && readyForBoss().ready;
  }
  /** Each map's boss after a death to it: the power to reach before trying again. */
  const bossRetryPower = new Map<string, number>();
  /** Whether this map's boss is ready to fight with Fight At's margin, and the status line when it is not. */
  function readyForBoss(): { ready: boolean; line: string } {
    const readiness = options.bossReady ? cachedReady(`boss:${options.mapId()}:${bossPower}`, () => options.bossReady!(bossPower)) : null;
    if (readiness === undefined) return { ready: false, line: 'Reading Boss' };
    if (readiness) return { ready: readiness.ready, line: readiness.ready ? '' : `Boss: ${needsLine(readiness)}` };
    const needs = bossNeeds();
    return { ready: currentPower() >= needs, line: `Boss At ${atPower(needs)}` };
  }

  /**
   * Death does not end a farm: the session stops running while the player is
   * down, which refresh() treats as a recovery, picking it up after the
   * respawn with the same settings. Nothing is remembered and nothing waits:
   * the switches and their sliders say what it does next.
   */
  function defeated() {
    if (!active && !pendingResume) return;
    const report = deathReport();
    if (report) options.reportDeath?.(report);
    if (phase === 'boss') {
      // Killed by the boss, or on the way to it: not again on this map until the build has grown.
      bossRetryPower.set(options.mapId(), currentPower() * BOSS_RETRY_GROWTH);
      phase = 'farm'; target = null; route = []; lastGoal = null; routeClock = 0; holding = false;
    }
  }

  function stop(reason = 'Autofarm stopped') {
    pendingResume = null;
    travellingTo = null;
    phase = 'farm';
    options.resumeStore?.clear();
    active = false;
    manualControl = false;
    recovering = false;
    readySince = null;
    target = null;
    route = [];
    lastGoal = null;
    holding = false;
    status = reason;
  }

  function refresh() {
    if (!active && !pendingResume) return;
    const identity = options.localIdentity?.();
    const connection = options.connection?.() ?? 'ready';
    if (connection === 'ended') { stop('Autofarm stopped for sign-in'); return; }
    if (connection === 'recovering') {
      // Keep only the player's intent; old targets and paths may belong to a discarded world snapshot.
      if (!recovering) { target = null; route = []; lastGoal = null; routeClock = 0; holding = false; }
      recovering = true;
      readySince = null;
      status = 'Reconnecting · farming will resume';
      return;
    }
    if (recovering || pendingResume) {
      // Let a restored connection settle first.
      readySince ??= now();
      if (now() - readySince < 1_000) return;
      recovering = false;
      readySince = null;
      status = 'Finding enemy';
    }
    // Restored identity, map, unlocks and equipment are meaningful only after hydration settles.
    // A farm that finds itself on another map (however it got there) carries on there with the same sliders.
    if (!pendingResume && startedMap !== options.mapId() && startedIdentity)
      pendingResume = { identity: startedIdentity, map: options.mapId(), choice: encodeFarmPlan(readSavedShares(startedMap, options.priorityStorage) ?? shares) };
    const expectedIdentity = pendingResume?.identity ?? startedIdentity;
    if (expectedIdentity && identity !== expectedIdentity) { stop('Character changed'); return; }
    const reason = options.unavailable();
    if (reason) { stop(reason); return; }
    if (pendingResume) {
      // Town, home, a map with no enemies: it waits, and farms again on the next map that has some.
      if (!groups().length) { active = false; status = 'Farming resumes on a map with enemies'; return; }
      // The sliders carried from the map before, as this map names its stats; nothing of them here is an even split.
      const carried = normalizeShares(decodeFarmPlan(pendingResume.choice));
      pendingResume = null;
      // Every slider at 0% (Pull Only, Chase Only) stays that here: it stands and fights what it pulls or what
      // chases it, as Go starts it. It used to read as nothing set and split every group evenly, walking off to farm them.
      if (carried && !Object.values(carried).some(value => value > 0)) {
        startZero();
        return;
      }
      // Aggro groups are fought as they arrive, so they join the farm (Farm's pick never walks to one waiting).
      const plan = { ...carried };
      for (const key of aggroGroups()) plan[key] = Math.max(plan[key] ?? 0, 1);
      start(sharesForGroups(plan, groups()), false);
    }
  }

  function select(key: string) {
    const choice = choices().find(entry => entry.key === key);
    if (!choice) return false;
    if (selected !== key) { target = null; route = []; lastGoal = null; routeClock = 0; holding = false; pullWait = 0; }
    selected = key;
    selectedType = choice.key;
    selectedLabel = choice.label;
    return true;
  }

  /** The group furthest behind its share of the farming time; looked at again every so often, or as soon as its group is empty. */
  function chooseCamp(dt: number) {
    // Everything farmed is already coming: no camp to change to.
    if (selected && pullCoversFarm()) return;
    const all = choices();
    if (spentMap !== options.mapId()) { spent = new Map(); spentMap = options.mapId(); }
    if (selected) spent.set(selected, (spent.get(selected) ?? 0) + dt);
    planClock -= dt;
    const current = all.find(entry => entry.key === selected && (shares[entry.key] ?? 0) > 0);
    const weights = farmWeights(all);
    // Only a group the pick can go to counts as somewhere to go. An Aggro group is in the shares but never walked
    // to, so with the farmed groups empty it read as "something alive": the pick re-ran every frame, swapping between
    // the empty groups by time spent, and each swap went to the server.
    const anyAlive = weights.some(entry => entry.alive > 0 && entry.weight > 0);
    if (current && (current.alive > 0 ? planClock > 0 : !anyAlive)) return;
    planClock = SHARE_REPLAN_SECONDS;
    const key = shareFarmKey(weights, group => spent.get(group) ?? 0);
    if (key) select(key);
  }


  /**
   * Farm's pick: the Farm groups share the time evenly (damage twice over), leaving out a stat whose kill gives
   * nothing now (rewardCapped: attack speed or crit at its cap) and an Aggro group waiting its turn, which is
   * never walked to. Picking by power, or by growth a second, was tried in the autofarm sim first: by power
   * it farmed health alone, by growth tough camps (34 kills in ten minutes against the even split's 47).
   */
  function farmWeights(all: ReturnType<typeof choices>) {
    const switched = new Set(aggroGroups()), pulledNow = pulledGroups();
    const weights = all.map(entry => ({ key: entry.key, alive: entry.alive,
      weight: switched.has(entry.key) && !pulledNow.has(entry.key) ? 0 : (shares[entry.key] ?? 0) * (entry.reward.type === 'damage' ? DAMAGE_FARM_WEIGHT : 1) }));
    const open = weights.map((entry, index) => ({ ...entry,
      weight: entry.weight > 0 && !options.rewardCapped?.(all[index].reward, all[index].soul) ? entry.weight : 0 }));
    // Every one capped: farm them anyway rather than stand idle.
    return open.some(entry => entry.weight > 0) ? open : weights;
  }

  /** Back a map, the next map, the boss, or a camp. */
  function choosePhase(dt: number) {
    const portal = exitPortal();
    if (portal && !finishingFight(true)) { phase = 'portal'; travellingTo = portal.destination; return; }
    if (!portal) finishingFight(false);
    if (bossWanted()) { phase = 'boss'; travellingTo = null; return; }
    if (phase !== 'farm') { target = null; route = []; lastGoal = null; routeClock = 0; holding = false; }
    phase = 'farm';
    travellingTo = null;
    chooseCamp(dt);
  }

  /**
   * Starts farming on the sliders (`next`: shares, or a group or list of
   * groups for an even split of them, an empty list every group here).
   * `remember` is false when autofarm restarts itself: only the player's own choice is saved.
   */
  /**
   * Sliders all at 0%: farm only what is pulled (or chases, in an Aggro run) and stand still. The farm
   * follows the Aggro switches: switching groups used to leave it on the old one, walking off to its camp.
   */
  let followsPull = false;
  /** Stopped because the last Aggro switch went off: the next one switched on starts it again. */
  let zeroWaiting = false;
  function startZero(plan: readonly string[] = zeroPlanGroups()) {
    if (!plan.length) { stop('Sliders at 0% · switch a group to Aggro'); zeroWaiting = true; return false; }
    const started = start(plan, false);
    followsPull = started;
    return started;
  }
  function start(next: FarmShares | readonly string[] | string, remember = true) {
    followsPull = false; zeroWaiting = false;
    if (options.connection && options.connection() !== 'ready') { stop('Connect to the server to farm'); return false; }
    const reason = options.unavailable();
    if (reason) { stop(reason); return false; }
    const here = groups();
    const list = typeof next === 'string' ? [next] : Array.isArray(next) ? next as readonly string[] : null;
    const listed = list ? (list.length ? list.map(normalizeKey) : here) : null;
    const picked = listed ? Object.fromEntries(listed.map(key => [key, 1])) : normalizeShares(next as FarmShares);
    // Only what was picked: a group not on this map, or every one here at 0%, is nothing to farm.
    if (!here.some(key => (picked?.[key] ?? 0) > 0)) { stop('No matching enemies in this map'); return false; }
    const chosen = sharesForGroups(picked, here);
    const nextOrder = here.filter(key => (chosen[key] ?? 0) > 0).sort((a, b) => chosen[b] - chosen[a]);
    shares = chosen;
    order = nextOrder;
    spent = new Map(); spentMap = options.mapId();
    selected = null;
    planClock = 0;
    phase = 'farm';
    travellingTo = null;
    active = true;
    manualControl = false;
    startedMap = options.mapId();
    startedIdentity = options.localIdentity?.();
    pendingResume = null;
    // Sliders are saved as set, not as the shares they make: 100% and 100% stay 100% and 100%.
    if (remember) { if (listed) writeSavedShares(shares, options.mapId(), options.priorityStorage); else rememberShares(picked ?? {}); }
    if (startedIdentity) options.resumeStore?.write({ identity: startedIdentity, map: startedMap, choice: encodeFarmPlan(shares) });
    recovering = false;
    readySince = null;
    target = null;
    route = [];
    routeClock = 0;
    lastGoal = null;
    holding = false;
    chooseCamp(0);
    status = 'Finding enemy';
    return Boolean(selected);
  }

  /**
   * Any travel carries the farm across with the same settings: autofarm's own
   * Move On, a portal the player walks into, a teleport. It used to end on
   * any travel but its own, and a player farming by hand had to start it again.
   */
  function travelStarted() {
    zeroWaiting = false;
    if (!active && !pendingResume) return;
    // After an update reload the farm waits as a restored intent, with no startedIdentity yet: travel carries that intent on.
    const identity = startedIdentity ?? pendingResume?.identity;
    if (!identity) { stop('Map changed · choose stats'); return; }
    // The player's sliders as last set, not this map's split of them: a stat this map lacks is farmed again where it is paid.
    const choice = startedIdentity ? encodeFarmPlan(readSavedShares(startedMap, options.priorityStorage) ?? shares) : pendingResume!.choice;
    // A stored intent needs a map, or it is not read back after a reload; any map will do, restoring does not check it.
    const intent = { identity, map: travellingTo ?? options.mapId(), choice };
    const label = travellingTo ? 'Moving to the next map' : 'Changing map';
    stop(label);
    pendingResume = intent;
    options.resumeStore?.write(intent);
    status = label;
  }

  /** A portal's keep-clear circle it stands in: where a crossing lands it, or where it was pushed. */
  function portalStoodIn() {
    const body = options.mapBoss?.();
    return options.obstacles().find(circle => (!body || Math.hypot(circle.x - body.x, circle.y - body.y) > 4)
      && Math.hypot(player.x - circle.x, player.y - circle.y) < circle.r) ?? null;
  }
  /** Out of the portal's front before anything else: holding ground there left it standing in the arch. */
  function leavePortal(circle: Circle): Movement {
    const exit = { x: circle.x, y: Math.min(WORLD.h - player.r, circle.y + circle.r + 8) };
    const waypoint = farmRoute(player, exit, options.obstacles().filter(other => other !== circle), WORLD, player.r)[0] ?? exit;
    route = []; holding = false; status = 'Leaving the portal';
    const length = Math.max(1, distance(waypoint));
    return { x: (waypoint.x - player.x) / length, y: (waypoint.y - player.y) / length, source: 'steer' };
  }

  function movement(manual: Movement, dt: number): Movement {
    refresh();
    manualControl = Boolean(manual.x || manual.y);
    if (recovering) return idle();
    // Arrived in a portal: walk out before resuming, farming or holding ground. Never on the way into one, and
    // never where there is nothing to farm: a farm waiting in the Town pushed players off its travel portal.
    if (!manualControl && (active || pendingResume) && groups().length > 0 && phase !== 'portal' && !options.paused()) {
      const stoodIn = portalStoodIn();
      if (stoodIn) return leavePortal(stoodIn);
    }
    // Waiting to resume on another map, the player can still walk (a town has nothing to farm).
    if (pendingResume && !manual.x && !manual.y) return idle();
    if (manual.x || manual.y) {
      if (active) { status = 'Manual control'; route = []; lastGoal = null; routeClock = 0; holding = false; }
      return manual;
    }
    if (!active || options.paused()) return manual;
    choosePhase(dt);
    if (player.maxHp > 0 && player.hp >= player.maxHp * .9) lastHealthyAt = now();
    if (phase === 'farm') takePullTurns(dt);
    const boss = phase === 'boss' ? options.mapBoss?.() ?? null : null;
    const portal = phase === 'portal' ? exitPortal() : null;
    if (phase !== 'farm') target = null;
    else if (!target || !validEnemy(target) || !enemies.includes(target)) {
      target = null;
      for (const enemy of enemies) {
        if (validEnemy(enemy) && (!target || compareAutoFarmTargets(priority, enemy, distance(enemy), target, distance(target)) < 0)) target = enemy;
      }
      routeClock = 0;
    }
    let threat: EnemyState | null = null;
    // On the way to the boss or the next map it shoots what it passes but chases nobody. A pulled group is coming anyway.
    // Only a stat it farms is fought off: one set to Off is walked away from, and leashes home, as a player would leave it.
    // On the way to its target it stops only for an attacker of the same kind or one it kills in a moment; a slow fight
    // with another kind is walked away from, so a weak character is never pinned for minutes.
    const quickKill = (enemy: EnemyState) => enemy.hp <= player.damage / Math.max(.05, player.attackRate) * QUICK_DEFENCE_SECONDS;
    const worthDefending = (enemy: EnemyState) => !target || choiceKey(enemy) === choiceKey(target) || quickKill(enemy);
    if (phase === 'farm' && !pulling()) for (const enemy of enemies) {
      if (!enemy.generatedBoss && farmedGroup(enemy) && worthDefending(enemy) && isEnemyAttackingPlayer(enemy, options.localIdentity?.()) && (!threat || distance(enemy) < distance(threat))) threat = enemy;
    }
    // Everything it farms comes to it: it stands its ground.
    if (phase === 'farm' && pullCoversFarm()) {
      const reachAll = weaponAttackRange(options.equippedWeapon?.(), player.attackRange);
      const inReach = enemies.some(enemy => pulledEnemy(enemy) && distance(enemy) <= reachAll + enemy.r);
      holding = true; route = []; status = inReach ? 'Farming' : enemies.some(pulledEnemy) ? 'Pulling' : 'Waiting for respawn';
      return idle();
    }
    // With the group on its way (pulled, or already chasing), stand and let it come; walk out only if nothing has reached range for a few seconds.
    const reach = weaponAttackRange(options.equippedWeapon?.(), player.attackRange);
    if (phase === 'farm' && !threat) {
      const coming = enemies.some(enemy => validEnemy(enemy) && (enemy.engaged || pullsEnemy(enemy)));
      const inReach = enemies.some(enemy => validEnemy(enemy) && distance(enemy) <= reach + enemy.r);
      pullWait = coming && !inReach ? pullWait + dt : 0;
      if (coming && (inReach || pullWait < PULL_WAIT_SECONDS)) { holding = true; route = []; status = inReach ? 'Farming' : pulling() ? 'Pulling' : 'Holding ground'; return idle(); }
    }
    // A boss is aimed at its hitbox, not its sprite's foot.
    const bossPoint = boss ? { x: boss.x, y: boss.y + (boss.hitboxOffsetY ?? 0) } : null;
    let destination: Position | null = threat ?? target ?? portal ?? bossPoint;
    if (!destination) {
      for (const site of spawnSites) if (choiceKey(site) === selected && (!destination || distance(site) < distance(destination))) destination = site;
    }
    if (!destination) { stop('No matching enemies in this map'); return idle(); }
    const weapon = options.equippedWeapon?.();
    const enemy = threat ?? target;
    // A campaign boss is hit at the surface of its hitbox, an oval off its feet; an Endless boss is a regular enemy, hit at its centre unless melee.
    const hitbox = !enemy && boss?.isBoss ? boss : null;
    const bossReach = !enemy && boss && !hitbox && isMeleeWeapon(weapon) ? boss.r : 0;
    let standoff = !enemy && portal ? { stop: 0, resume: 0 } : autoFarmStandoff({
      weaponRange: hitbox ? Math.min(weaponAttackRange(weapon, player.attackRange), BOSS_STAND_GAP + AUTO_FARM_REACH_MARGIN) : weaponAttackRange(weapon, player.attackRange) + bossReach,
      playerAttackRange: player.attackRange,
      melee: isMeleeWeapon(weapon),
      playerRadius: player.r,
      destination: enemy ?? destination,
      enemy: Boolean(enemy),
    });
    if (enemy && (options.reflectOnly?.() || !isWeaponItem(options.equippedWeapon?.()))) {
      // Nothing the bow does lands here (Reflect Only), or there is no weapon (a Reflect build may
      // farm bare-handed): stand at the enemy so it attacks, and Reflect does the killing.
      const contact = player.r + enemy.r + 6;
      standoff = { stop: contact, resume: contact + 20 };
    } else if (enemy && (enemy.vx * (enemy.x - player.x) + enemy.vy * (enemy.y - player.y)) > 0 && Math.hypot(enemy.vx, enemy.vy) > 10) {
      // Walking away: close in further, or every step it takes puts it back out of range before a shot.
      standoff = { stop: standoff.stop * .6, resume: standoff.stop * .8 };
    }
    const range = standoff.stop;
    const remaining = hitbox ? bossSurfaceDistance(player.x - hitbox.x, player.y - hitbox.y, hitbox.r, hitbox.ry, hitbox.hitboxOffsetY) : distance(destination);
    // Where to stand, in a direction from the destination, to be `range` from it (or from the boss's surface).
    const standAt = (angle: number) => {
      const ux = Math.cos(angle), uy = Math.sin(angle);
      const reachFromCentre = hitbox ? (range + hitbox.r) / Math.hypot(ux, uy * hitbox.r / bossVerticalRadius(hitbox.r, hitbox.ry)) : range;
      return { x: destination.x + ux * reachFromCentre, y: destination.y + uy * reachFromCentre };
    };
    // Slack as wide as the waypoint drop below: a step landing 1-2px short dropped the last waypoint without arriving,
    // and it stood there for good. A squat hitbox's surface distance is stretched vertically, and the slack with it.
    const slack = WAYPOINT_REACHED * (hitbox ? Math.max(1, hitbox.r / bossVerticalRadius(hitbox.r, hitbox.ry)) : 1);
    holding = remaining <= (holding ? standoff.resume : standoff.stop) + slack;
    if (holding && !portal) {
      status = threat ? 'Defending' : boss ? 'Fighting the boss' : target ? 'Farming' : 'Waiting for respawn';
      route = [];
      routeClock = 0;
      return idle();
    }
    const goal = distance(destination) > 0 ? standAt(Math.atan2(player.y - destination.y, player.x - destination.x)) : { x: destination.x, y: destination.y };
    routeClock -= dt;
    if (routeClock <= 0 || !lastGoal || Math.hypot(goal.x - lastGoal.x, goal.y - lastGoal.y) > 60) {
      // Its own goal is no obstacle: the portal it is walking into, the boss it is going to fight.
      const goalPoint = portal ?? boss;
      const obstacles = options.obstacles().filter(circle => !goalPoint || Math.hypot(circle.x - goalPoint.x, circle.y - goalPoint.y) > 4 + (boss ? boss.r : 0) && !(portal && Math.hypot(circle.x - portal.x, circle.y - portal.y) <= circle.r));
      route = farmRoute(player, goal, obstacles, WORLD, player.r);
      // The nearest firing position can fall inside a portal's avoidance circle: other positions at the same range, then the target itself.
      if (!route.length) {
        const away = Math.atan2(player.y - destination.y, player.x - destination.x);
        for (const turn of [1, -1, 2, -2, 3, -3, 4]) {
          route = farmRoute(player, standAt(away + turn * Math.PI / 4), obstacles, WORLD, player.r);
          if (route.length) break;
        }
      }
      if (!route.length) route = farmRoute(player, destination, obstacles, WORLD, player.r);
      lastGoal = goal;
      routeClock = .5;
    }
    while (route.length && distance(route[0]) < WAYPOINT_REACHED) route.shift();
    const waypoint = route[0];
    if (!waypoint) { status = 'Waiting for a clear route'; return idle(); }
    status = threat ? 'Moving to attacker' : portal ? 'Heading to the next map' : boss ? 'Moving to the boss' : target ? 'Moving to enemy' : 'Moving to spawn';
    const length = distance(waypoint), magnitude = Math.min(1, length / Math.max(1, options.speed() * dt));
    return { x: (waypoint.x - player.x) / length * magnitude, y: (waypoint.y - player.y) / length * magnitude, source: 'steer' };
  }

  let lastHealthyAt = now();
  /**
   * One line, under the diagnostics' 240 characters, about a death with Auto Farm on:
   * the map, what it was doing and farming, the settings, the enemies within 400
   * (e elite, r ranged, * attacking), the seconds from 90% health to dead, power, and what this map's
   * readiness says is missing.
   */
  function deathReport(): string | null {
    const near = new Map<string, number>();
    for (const enemy of enemies) {
      if (enemy.dead || enemy.remoteCombatGhost || !(enemy.hp > 0) || distance(enemy) > 400) continue;
      const definition = enemy.definition ?? ENEMY_TYPES[enemy.type];
      const tag = `${enemy.type}${definition?.elite ? 'e' : ''}${definition?.ranged ? 'r' : ''}${isEnemyAttackingPlayer(enemy, options.localIdentity?.()) ? '*' : ''}`;
      near.set(tag, (near.get(tag) ?? 0) + 1);
    }
    const crowd = [...near].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag, count]) => `${tag}:${count}`).join(',');
    const here = options.mapReady ? cachedReady(`map:${options.mapId()}:1`, () => options.mapReady!(options.mapId(), 1)) : null;
    return [`map=${options.mapId()}`, `st=${status}`, `ph=${phase}`, `sel=${selected ?? '-'}`, `mv=${movePower}`, `fb=${bossPower}`,
      `pull=${pulling() ? pulledGroups().size : 0}/${pullLimit()}`, `near=${crowd || '-'}`, `burst=${((now() - lastHealthyAt) / 1000).toFixed(1)}s`,
      `pw=${atPower(currentPower())}`, `need=${here ? here.needs ?? 'none' : '?'}`].join(';').slice(0, 240);
  }

  const atPower = (power: number) => formatCompactNumber(Math.ceil(power));
  /** Move On's line: going, the power the next map asks, or the boss it waits for. */
  function moveStatus() {
    if (options.reflectOnly?.()) return 'Off In Reflect Only';
    if (phase === 'portal') return 'Moving On';
    const portal = options.nextPortal?.();
    if (portal) {
      const check = readyForMap(portal.destination);
      if (!check.ready) return check.line;
      return fightHeldSince !== null && active ? 'Moving On After This Fight' : 'Moving On';
    }
    // The way forward is shut until this map's boss is beaten.
    if (options.bossUnlocksNext?.() === true && !opensNothing.has(options.mapId())) return 'Boss Needed';
    return '';
  }
  /** Fight Bosses' line: fighting, beaten, or the power the boss asks (told quietly with the switch off). */
  function bossLine() {
    if (options.reflectOnly?.()) return 'Off In Reflect Only';
    if (phase === 'boss') return 'Fighting Boss';
    if (bossBeaten()) return 'Boss Beaten';
    const boss = options.mapBoss?.();
    if (!boss || boss.dead) return '';
    const retry = bossRetryPower.get(options.mapId()) ?? 0;
    if (currentPower() < retry) return `Boss Again At ${atPower(retry)}`;
    const check = readyForBoss();
    return check.ready ? 'Boss Next' : check.line;
  }

  return { start, stop: (reason?: string) => { zeroWaiting = false; stop(reason); }, defeated, refresh, choices, movement, travelStarted,
    /** `waiting`: stopped for travel, and starting again on the next map with enemies. The player can still Stop it. */
    state: () => ({ active, waiting: !active && Boolean(pendingResume), selected, selectedLabel, shares: { ...shares }, phase, advance, fightBosses,
      status: active && !recovering && options.paused() ? 'Paused' : status }),
    /** The camp being farmed; null at the boss or on the way out, so the boss and anything in the way are fair game. */
    targetType: () => active && !manualControl && phase === 'farm' ? selectedType : null,
    /** What combat aims at: the farmed camp, or, with every farmed group pulled, whatever is nearest. */
    attackType: () => active && !manualControl && phase === 'farm' && !pullCoversFarm() ? selectedType : null,
    targetCamp: () => null,
    /** Pull brings everything it farms, so it stands where it is: other players see it standing, not walking camp to camp. */
    holdsGround: () => pullCoversFarm(),
    advance: () => advance,
    setAdvance(next: boolean) { advance = next; writeFarmAdvance(next, options.priorityStorage); },
    fightBosses: () => fightBosses,
    setFightBosses(next: boolean) { fightBosses = next; writeFightBosses(next, options.priorityStorage); },
    /** Move On's slider, 0.1x to 10x the next map's power. */
    movePower: () => movePower,
    setMovePower(next: number) { movePower = powerStep(next); writeMovePower(movePower, options.priorityStorage); },
    /** Fight Bosses' slider, 0.1x to 10x the boss's power. */
    bossPower: () => bossPower,
    setBossPower(next: number) { bossPower = powerStep(next); writeBossPower(bossPower, options.priorityStorage); },
    moveStatus,
    /** Whether Move On is going now: the panel shows it lit. */
    moveReady: () => moveStatus() === 'Moving On',
    bossStatus: bossLine,
    bossReady: () => ['Boss Next', 'Fighting Boss'].includes(bossLine()),
    /** Sliders all at 0%: farms what is pulled, or what chases in an Aggro run, standing still, and follows the Aggro switches. */
    startZero,
    /** The sliders saved for this map, for the panel to show, and saving them without starting. */
    savedShares,
    rememberShares,
    priority: () => priority,
    /**
     * The Target rule combat aims by: while farming (a pulled crowd too) and all
     * through an Aggro run. Steering by hand otherwise aims at the nearest.
     */
    attackPriority: (): AutoFarmPriority => (active && !manualControl && phase === 'farm') || forcedGroups().size ? priority : 'closest',
    pullAll: () => pullAll,
    /** False during an Aggro run, when Pull is off. */
    pullAvailable: () => (options.pullCamps?.() ?? 1) > 0,
    setPullAll(next: boolean) { pullAll = next; writeAutoFarmPull(next, options.priorityStorage); },
    /** How many groups Aggro may pull at once: one, one more per Aggro win, none during a run. */
    pullLimit,
    /** This map's groups Aggro is pulling now, as the sliders name them: at most the limit. */
    pulledGroupKeys: (): string[] => pulling() ? [...pulledGroups()] : [],
    /** This map's groups switched to Aggro, however many; before any switch is touched, what Pull Whole Group brings. */
    aggroGroupKeys: (): string[] => pullPicks ? aggroGroups() : pulling() ? [...pulledGroups()] : [],
    /** Switches Aggro on or off for one of this map's groups. The first switch keeps what Pull was already bringing. */
    /** This map's groups on Aggro, all at once (the window's Go); picks for groups this map lacks are kept. */
    setAggroGroups(keys: readonly string[]) {
      const here = groups();
      const elsewhere = (pullPicks ?? []).filter(pick => !here.includes(normalizeKey(pick) as AutoFarmGroup));
      pullPicks = [...elsewhere, ...keys.filter(key => here.includes(key as AutoFarmGroup))];
      writeAutoFarmPullGroups(pullPicks, options.priorityStorage);
      pulledKey = '';
    },
    setGroupPulled(group: string, on: boolean) {
      const current = pullPicks ? aggroGroups() : pulling() ? [...pulledGroups()] : [];
      // Picks saved for groups this map lacks are kept for the maps that have them.
      const elsewhere = (pullPicks ?? []).filter(pick => !groups().includes(normalizeKey(pick) as AutoFarmGroup));
      const here = on ? [...new Set([...current, group])] : current.filter(key => key !== group);
      pullPicks = [...elsewhere, ...here];
      writeAutoFarmPullGroups(pullPicks, options.priorityStorage);
      pulledKey = '';
      if ((active && followsPull) || zeroWaiting) startZero();
      return true;
    },
    // Steering by hand keeps the pull: the group follows the player while they move.
    pulls: (enemy: EnemyState) => pullsEnemy(enemy),
    /** An Aggro run's chasing groups on this map, as the sliders name them; none outside a run. */
    chasingGroupKeys: (): string[] => [...forcedGroups()],
    /** An Aggro run's groups on this map: they chase the player from arrival, whatever autofarm is doing. */
    forced: (enemy: EnemyState) => !enemy.dead && !enemy.generatedBoss && !enemy.remoteCombatGhost && forcedGroups().has(choiceKey(enemy)),
    setPriority(next: AutoFarmPriority) {
      if (next === priority) return;
      priority = next;
      writeAutoFarmPriority(next, options.priorityStorage);
      // Choose again under the new rule rather than finishing the old target.
      target = null;
      routeClock = 0;
    },
  };
}
