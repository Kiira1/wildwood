import { table, t, SenderError } from 'spacetimedb/server';
import { defaultBalanceSettings, resolveMapBalance, validateBalanceSettings, BALANCE_MAPS } from '../../shared/map-balance';
import type { BalanceEditorState, MapBalanceSnapshot } from '../../shared/map-balance-types';
import type { GameReducerContext } from './index';
export const mapBalanceVersion = table({ name: 'map_balance_version' }, {
  revision: t.u32().primaryKey(), settingsJson: t.string(), editor: t.identity(), createdAt: t.timestamp(),
});
export const mapBalanceHead = table({ name: 'map_balance_head' }, { id: t.u8().primaryKey(), revision: t.u32() });
export const playerMapBalance = table({ name: 'player_map_balance' }, {
  identity: t.identity().primaryKey(), mapId: t.string(), snapshotJson: t.string(),
});
type Context = Pick<GameReducerContext, 'db' | 'sender' | 'timestamp'>;
export function balanceEditorState(ctx: Pick<Context, 'db'>): BalanceEditorState {
  const revision = ctx.db.mapBalanceHead.id.find(0)?.revision ?? 0;
  const row = ctx.db.mapBalanceVersion.revision.find(revision);
  return { revision, settings: row ? validateBalanceSettings(JSON.parse(row.settingsJson)) : defaultBalanceSettings(), previousRevision: revision > 0 ? revision - 1 : null };
}
export function saveMapBalance(ctx: Context, expectedRevision: number, json: string) {
  const current = balanceEditorState(ctx);
  if (current.revision !== expectedRevision) throw new SenderError('Balance changed in another editor. Reload before saving.');
  if (json.length > 20_000) throw new SenderError('Balance configuration too large.');
  let settings;
  try {
    settings = validateBalanceSettings(JSON.parse(json));
    for (const [map] of BALANCE_MAPS) resolveMapBalance(map === 'endless' ? 'endless_1001' : map, settings, 0);
  } catch (error) { throw new SenderError(error instanceof Error ? error.message : 'Invalid balance.'); }
  // Revision zero is a real backup of the defaults that were live at first edit.
  if (!ctx.db.mapBalanceVersion.revision.find(0)) ctx.db.mapBalanceVersion.insert({ revision: 0, settingsJson: JSON.stringify(current.settings), editor: ctx.sender, createdAt: ctx.timestamp });
  const revision = current.revision + 1;
  ctx.db.mapBalanceVersion.insert({ revision, settingsJson: JSON.stringify(settings), editor: ctx.sender, createdAt: ctx.timestamp });
  if (ctx.db.mapBalanceHead.id.find(0)) ctx.db.mapBalanceHead.id.update({ id: 0, revision });
  else ctx.db.mapBalanceHead.insert({ id: 0, revision });
}
/** One small snapshot per player. Reconnects retain the same combat and rewards. */
export function pinMapBalance(ctx: Context, mapId: string, enable = false, requestedVersion?: 1 | 2) {
  const previous = ctx.db.playerMapBalance.identity.find(ctx.sender);
  const oldSnapshot: MapBalanceSnapshot | null = previous ? JSON.parse(previous.snapshotJson) : null;
  const version = requestedVersion ?? oldSnapshot?.configurationVersion ?? 1;
  if ((previous?.mapId === mapId && (oldSnapshot?.configurationVersion ?? 1) === version) || (!previous && !enable)) return;
  let head = balanceEditorState(ctx);
  // Changing client capability on reconnect keeps the visit's balance revision.
  if (previous?.mapId === mapId && oldSnapshot) {
    const stored = ctx.db.mapBalanceVersion.revision.find(oldSnapshot.revision);
    head = { ...head, revision: oldSnapshot.revision, settings: stored ? validateBalanceSettings(JSON.parse(stored.settingsJson)) : defaultBalanceSettings() };
  }
  const row = { identity: ctx.sender, mapId, snapshotJson: JSON.stringify(resolveMapBalance(mapId, head.settings, head.revision, version)) };
  if (previous) ctx.db.playerMapBalance.identity.update(row); else ctx.db.playerMapBalance.insert(row);
}
export function pinnedMapBalance(ctx: Pick<Context, 'db'>, identity: Context['sender'], mapId: string): MapBalanceSnapshot | null {
  const row = ctx.db.playerMapBalance.identity.find(identity);
  return row?.mapId === mapId ? JSON.parse(row.snapshotJson) : null;
}
export function pinnedBossReward(ctx: Pick<Context, 'db'>, identity: Context['sender'], mapId: string, stat: string, fallback: number) {
  return pinnedMapBalance(ctx, identity, mapId)?.boss?.rewards[stat] ?? fallback;
}
