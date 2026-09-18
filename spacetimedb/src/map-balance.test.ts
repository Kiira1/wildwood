import { it, expect, vi } from 'vitest';
import { balanceEditorState, saveMapBalance, pinMapBalance, pinnedMapBalance } from './map-balance';
function fixture() {
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

import { crystalFixture, server } from '../../tests/helpers/crystal-hollows-fixture';
it('rejects non-developer changes and previews; rejects balance queries for a different map', () => {
  const f = crystalFixture();
  const proc = { withTx: (action: any) => f.transaction(() => action(f.ctx)) } as any;
  expect(() => f.run(server.setMapBalance, { expectedRevision: 0, settingsJson: '{}' })).toThrow('Developer access required');
  expect(() => server.getBalanceEditor(proc)).toThrow('Developer access required');
  expect(() => server.getMapBalance(proc, { mapId: 'ion_citadel' })).toThrow('Enter the map');
});
it('awards the snapshot shown to the client even after an administrator edits rewards', () => {
  const f = crystalFixture();
  const proc = { withTx: (action: any) => f.transaction(() => action(f.ctx)) } as any;
  const snapshot = JSON.parse(server.getMapBalance(proc, { mapId: 'crystal_hollows' }));
  const settings = balanceEditorState(f.ctx as any).settings; settings.maps.crystal_hollows.bossRewards = 3;
  f.transaction(() => saveMapBalance(f.ctx as any, 0, JSON.stringify(settings)));
  f.patch('playerProgress', { damage: 1e15 });
  const before = f.db.playerProgress.identity.find(f.ctx.sender);
  f.run(server.recordEnemyDefeats, { streamId: 'balance-boss-rewards-01', sequence: 1n, mapId: 'crystal_hollows', enemies: [{ enemy: 'boss', count: 1 }] });
  const after = f.db.playerProgress.identity.find(f.ctx.sender);
  expect(after.maxHp - before.maxHp).toBe(snapshot.boss.rewards.health);
  expect(after.clockworkRuinsUnlocked).toBe(true);
  f.transaction(() => { pinMapBalance(f.ctx as any, 'home_exterior'); pinMapBalance(f.ctx as any, 'crystal_hollows'); });
  expect(pinnedMapBalance(f.ctx as any, f.ctx.sender, 'crystal_hollows')!.boss!.rewards.health).toBe(snapshot.boss.rewards.health * 3);
});
