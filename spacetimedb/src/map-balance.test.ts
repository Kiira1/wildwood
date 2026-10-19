import { MODULE_MIGRATION_VERSION } from "./module-migrations";
import { defaultBalanceSettings, resolveMapBalance } from '../../shared/map-balance';
import { it, expect, vi } from 'vitest';
import { balanceEditorState, forgetBalanceCaches, installBalanceCurve, saveMapBalance, pinMapBalance, pinnedMapBalance, liveMapBalance } from './map-balance';
function fixture() {
  forgetBalanceCaches();
  const sender = { toHexString: () => 'test' };
  const table = (field: string) => {
    const rows = new Map(); const key = (value: any) => value === sender ? 'test' : value;
    return { [field]: { find: (id: any) => rows.get(key(id)), update: (row: any) => rows.set(key(row[field]), row) }, insert: (row: any) => rows.set(key(row[field]), row) };
  };
  return { sender, timestamp: { microsSinceUnixEpoch: 1n }, db: { mapBalanceVersion: table('revision'), mapBalanceHead: table('id'), playerMapBalance: table('identity') } } as any;
}
it('pins a visit across changes/reconnects, refreshes on travel, preserves previous version', () => {
  const ctx = fixture(); pinMapBalance(ctx, 'tutorial_forest', true);
  const initial = pinnedMapBalance(ctx, ctx.sender, 'tutorial_forest')!;
  const edited = balanceEditorState(ctx); edited.settings.maps.tutorial_forest.bossHealth = 2;
  saveMapBalance(ctx, 0, JSON.stringify(edited.settings));
  pinMapBalance(ctx, 'tutorial_forest');
  expect(pinnedMapBalance(ctx, ctx.sender, 'tutorial_forest')!.boss!.hp).toBe(initial.boss!.hp);
  pinMapBalance(ctx, 'home_exterior'); pinMapBalance(ctx, 'tutorial_forest');
  expect(pinnedMapBalance(ctx, ctx.sender, 'tutorial_forest')!.boss!.hp).toBe(initial.boss!.hp * 2);
  expect(ctx.db.mapBalanceVersion.revision.find(0)).toBeDefined();
  expect(() => saveMapBalance(ctx, 0, JSON.stringify(edited.settings))).toThrow('another editor');
});
it('does not opt an old client into new values before it requests the snapshot', () => {
  const ctx = fixture(); pinMapBalance(ctx, 'tutorial_forest');
  expect(pinnedMapBalance(ctx, ctx.sender, 'tutorial_forest')).toBeNull();
});

vi.mock('spacetimedb/server', () => import('../../tests/helpers/spacetime-module'));
it('gives offline farming the balance a kill pays right now, on maps the player is not standing on too', () => {
  const ctx = fixture(); pinMapBalance(ctx, 'endless_19', true, 2);
  const pinned = pinnedMapBalance(ctx, ctx.sender, 'endless_19')!;
  const edited = balanceEditorState(ctx); edited.settings.maps.endless.enemyRewards *= 2;
  saveMapBalance(ctx, 0, JSON.stringify(edited.settings));
  // The visit in progress keeps its pin.
  expect(liveMapBalance(ctx, ctx.sender, 'endless_19')).toEqual(pinned);
  // One map ahead is what arriving would pin, not the pre-resolver curve that paid a sliver of it.
  const ahead = liveMapBalance(ctx, ctx.sender, 'endless_20');
  expect(ahead.revision).toBe(1);
  expect(ahead.lanes.Bramble.reward.amount).toBeGreaterThan(pinned.lanes.Bramble.reward.amount * 2);
  pinMapBalance(ctx, 'endless_20', true, 2);
  expect(pinnedMapBalance(ctx, ctx.sender, 'endless_20')).toEqual(ahead);
});

import { crystalFixture, server } from '../../tests/helpers/crystal-hollows-fixture';
import { reportKills } from '../../tests/helpers/enemy-defeat';
import { progressOf } from "../../tests/helpers/progress";
import revision79 from "../../tests/fixtures/balance-revision-79.json";
it('rejects non-developer changes and previews; rejects balance queries for a different map', () => {
  const f = crystalFixture();
  const proc = { withTx: (action: any) => f.transaction(() => action(f.ctx)) } as any;
  expect(() => f.run(server.setMapBalance, { expectedRevision: 0, settingsJson: '{}' })).toThrow('Developer access required');
  expect(() => server.getBalanceEditor(proc, {})).toThrow('Developer access required');
  expect(() => server.getMapBalance(proc, { mapId: 'ion_citadel' })).toThrow('Enter the map');
});
it('awards the snapshot shown to the client even after an administrator edits rewards', () => {
  const f = crystalFixture();
  const proc = { withTx: (action: any) => f.transaction(() => action(f.ctx)) } as any;
  const snapshot = JSON.parse(server.getMapBalance(proc, { mapId: 'crystal_hollows' }));
  const settings = balanceEditorState(f.ctx as any).settings; settings.maps.crystal_hollows.enemyRewards = 3;
  f.transaction(() => saveMapBalance(f.ctx as any, 0, JSON.stringify(settings)));
  f.patch('playerProgress', { damage: 1e15 });
  const before = progressOf(f, f.ctx.sender);
  reportKills(f, { streamId: 'balance-boss-rewards-01', sequence: 1n, mapId: 'crystal_hollows', enemies: [{ enemy: 'boss', count: 1 }] });
  const after = progressOf(f, f.ctx.sender);
  expect(after.maxHp - before.maxHp).toBe(snapshot.boss.rewards.health);
  expect(after.clockworkRuinsUnlocked).toBe(true);
  f.transaction(() => { pinMapBalance(f.ctx as any, 'home_exterior'); pinMapBalance(f.ctx as any, 'crystal_hollows'); });
  expect(pinnedMapBalance(f.ctx as any, f.ctx.sender, 'crystal_hollows')!.boss!.rewards.health).toBe(snapshot.boss.rewards.health * 3);
});
it('negotiates new fields without switching balance revisions during a visit', () => {
  const ctx = fixture(); pinMapBalance(ctx, 'tutorial_forest', true, 1);
  const settings = balanceEditorState(ctx).settings; settings.maps.tutorial_forest.enemyRespawn = 2;
  saveMapBalance(ctx, 0, JSON.stringify(settings));
  pinMapBalance(ctx, 'tutorial_forest', true, 2);
  expect(pinnedMapBalance(ctx, ctx.sender, 'tutorial_forest')).toMatchObject({ revision: 0, configurationVersion: 2, regularRespawnSeconds: 10 });
  pinMapBalance(ctx, 'home_exterior'); pinMapBalance(ctx, 'tutorial_forest');
  expect(pinnedMapBalance(ctx, ctx.sender, 'tutorial_forest')).toMatchObject({ revision: 1, configurationVersion: 2, regularRespawnSeconds: 20 });
});
it('re-pins a visit whose snapshot was scaled from the old 20-second respawn', () => {
  const ctx = fixture(); pinMapBalance(ctx, 'tutorial_forest', true, 2);
  const current = pinnedMapBalance(ctx, ctx.sender, 'tutorial_forest')!;
  expect(current).toMatchObject({ regularRespawnSeconds: 10, regularRespawnBaseSeconds: 10 });
  // What a pre-0.807 server pinned: the same revision, scaled from 20 seconds, with no base recorded.
  const { regularRespawnBaseSeconds: _base, ...rest } = current;
  ctx.db.playerMapBalance.identity.update({ identity: ctx.sender, mapId: 'tutorial_forest', snapshotJson: JSON.stringify({ ...rest, regularRespawnSeconds: 20 }) });
  pinMapBalance(ctx, 'tutorial_forest');
  expect(pinnedMapBalance(ctx, ctx.sender, 'tutorial_forest')).toEqual(current);
  // A current snapshot is still kept for the rest of the visit.
  const settings = balanceEditorState(ctx).settings; settings.maps.tutorial_forest.enemyRespawn = 2;
  saveMapBalance(ctx, 0, JSON.stringify(settings));
  pinMapBalance(ctx, 'tutorial_forest', true, 2);
  expect(pinnedMapBalance(ctx, ctx.sender, 'tutorial_forest')).toEqual(current);
});

it('reuses a revision across players without serving it past the next save', () => {
  const ctx = fixture();
  pinMapBalance(ctx, 'tutorial_forest', true);
  const before = pinnedMapBalance(ctx, ctx.sender, 'tutorial_forest')!;
  const settings = balanceEditorState(ctx).settings;
  settings.maps.tutorial_forest.bossHealth = 5;
  saveMapBalance(ctx, 0, JSON.stringify(settings));

  // Travelling away and back takes the new revision rather than a cached one.
  pinMapBalance(ctx, 'home_exterior'); pinMapBalance(ctx, 'tutorial_forest');
  const after = pinnedMapBalance(ctx, ctx.sender, 'tutorial_forest')!;
  expect(after.revision).toBe(1);
  expect(after.boss!.hp).toBe(before.boss!.hp * 5);

  // A second player arriving at the same revision is served the same snapshot.
  const other = { ...ctx, sender: { toHexString: () => 'other' } };
  pinMapBalance(other, 'tutorial_forest', true);
  expect(pinnedMapBalance(other, other.sender, 'tutorial_forest')).toEqual(after);
});

it('serves byte-identical snapshots whether or not the caches are warm', () => {
  const maps = ['tutorial_forest', 'beginner_desert', 'crystal_hollows', 'endless_1', 'endless_97'];
  const snapshotsFor = (cold: boolean) => {
    const ctx = fixture();
    // Two revisions, so the cache is exercised across a save as well as within one.
    pinMapBalance(ctx, 'tutorial_forest', true);
    const settings = balanceEditorState(ctx).settings;
    settings.maps.endless.bossHealth = 3;
    saveMapBalance(ctx, 0, JSON.stringify(settings));
    const collected: Record<string, unknown> = {};
    for (const mapId of maps) {
      if (cold) forgetBalanceCaches();
      pinMapBalance(ctx, 'home_exterior');
      if (cold) forgetBalanceCaches();
      pinMapBalance(ctx, mapId, true);
      collected[mapId] = pinnedMapBalance(ctx, ctx.sender, mapId);
    }
    return collected;
  };
  expect(snapshotsFor(false)).toEqual(snapshotsFor(true));
});

 it.each(['tutorial_forest', 'ion_citadel', 'endless_40'])('restores damage for an existing %s visit without changing anything else', (mapId) => {
  const ctx = fixture(); pinMapBalance(ctx, mapId, true, 2);
  // Snapshots come back frozen and shared; edit a copy.
  const original = JSON.parse(JSON.stringify(pinnedMapBalance(ctx, ctx.sender, mapId)!));
  const old = JSON.parse(JSON.stringify(original)); delete old.enemyDamageVersion;
  for (const row of [...Object.values(old.enemies), ...Object.values(old.lanes)] as any[]) row.damage = row.hp * .1;
  // A pinned reward may predate a reward buff; the damage hotfix must leave it alone.
  if (old.boss) old.boss.rewards.health = 123;
  ctx.db.playerMapBalance.identity.update({ identity: ctx.sender, mapId, snapshotJson: JSON.stringify(old) });
  pinMapBalance(ctx, mapId);
  if (original.boss) original.boss.rewards.health = 123;
  expect(pinnedMapBalance(ctx, ctx.sender, mapId)).toEqual(original);
  pinMapBalance(ctx, mapId);
  expect(pinnedMapBalance(ctx, ctx.sender, mapId)).toEqual(original);
});

it('runs pending migrations from the connection path only once', () => {
  const f = crystalFixture();
  forgetBalanceCaches();
  f.seed('moduleMigrationState', { id: 0, version: 59 });
  f.seed('mapBalanceHead', { id: 0, revision: 79 });
  f.seed('mapBalanceVersion', { revision: 79, settingsJson: JSON.stringify(revision79), editor: f.ctx.sender, createdAt: f.ctx.timestamp });
  f.ctx.connectionId = null;
  f.run(server.onConnect);
  expect(f.db.moduleMigrationState.id.find(0).version).toBe(MODULE_MIGRATION_VERSION);
  // 60 put the balance curve on as revision 80.
  expect(balanceEditorState(f.ctx as any).revision).toBe(80);
  expect(balanceEditorState(f.ctx as any).settings).toEqual(defaultBalanceSettings());
  f.run(server.onConnect);
  expect(balanceEditorState(f.ctx as any).revision).toBe(80);
});

it('a save never reuses a revision number when the head was moved back', () => {
  const f = crystalFixture();
  forgetBalanceCaches();
  const old = JSON.stringify(revision79);
  for (const revision of [79, 80]) f.seed("mapBalanceVersion", { revision, settingsJson: old, editor: f.ctx.sender, createdAt: f.ctx.timestamp });
  f.seed("mapBalanceHead", { id: 0, revision: 79 });
  installBalanceCurve(f.ctx as any);
  expect(balanceEditorState(f.ctx as any).revision).toBe(81);
  expect(f.db.mapBalanceVersion.revision.find(80).settingsJson).toBe(old);
});

it("migration 60 puts the balance curve on as the next revision and moves every pinned visit onto it, once", () => {
  const f = crystalFixture();
  forgetBalanceCaches();
  const ctx = f.ctx as any;
  const live = JSON.stringify(revision79);
  f.seed("mapBalanceVersion", { revision: 79, settingsJson: live, editor: f.ctx.sender, createdAt: f.ctx.timestamp });
  f.seed("mapBalanceHead", { id: 0, revision: 79 });
  // A visit pinned under revision 79, when Ion Patrols had more health.
  const before = JSON.parse(JSON.stringify(resolveMapBalance("ion_citadel", defaultBalanceSettings(), 79, 2)));
  before.enemies["Ion Patrol"].hp *= 10;
  f.seed("playerMapBalance", { identity: f.ctx.sender, mapId: "ion_citadel", snapshotJson: JSON.stringify(before) });
  installBalanceCurve(ctx);
  expect(balanceEditorState(ctx)).toMatchObject({ revision: 80, settings: defaultBalanceSettings() });
  expect(f.db.mapBalanceVersion.revision.find(79).settingsJson).toBe(live);
  const after = JSON.parse(f.db.playerMapBalance.identity.find(f.ctx.sender).snapshotJson);
  expect(after).toEqual(resolveMapBalance("ion_citadel", defaultBalanceSettings(), 80, 2));
  expect(after.enemies["Ion Patrol"].hp).toBeLessThan(before.enemies["Ion Patrol"].hp);
  installBalanceCurve(ctx);
  expect(balanceEditorState(ctx).revision).toBe(80);
});
