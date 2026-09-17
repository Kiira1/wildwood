import { server, type crystalFixture } from './crystal-hollows-fixture';

/** Give a fixture founder enough power without changing later battle expectations. */
export function createTestGuild(f: ReturnType<typeof crystalFixture>, name: string) {
  const progress = f.db.playerProgress.identity.find(f.ctx.sender);
  f.db.playerProgress.identity.update({ ...progress, maxHp: 1_000_000_000 });
  try { return f.run(server.createGuild, { name }); }
  finally { f.db.playerProgress.identity.update(progress); }
}
