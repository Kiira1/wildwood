import { table, t } from "spacetimedb/server";

/** Immutable combat inputs shared by the server, live client and saved replay. */
export const duelCombatSnapshot = table({ name: "duel_combat_snapshot", public: true }, {
  duelId: t.u64().primaryKey(),
  challengerRiposte: t.f64(), opponentRiposte: t.f64(), riposteSeed: t.u64(),
  challengerArrowStorm: t.f64(), challengerRicochet: t.f64(), challengerPiercingShot: t.f64(),
  opponentArrowStorm: t.f64(), opponentRicochet: t.f64(), opponentPiercingShot: t.f64(),
  challengerWhirlwind: t.f64().default(0), challengerDeflect: t.f64().default(0), challengerShockwave: t.f64().default(0),
  opponentWhirlwind: t.f64().default(0), opponentDeflect: t.f64().default(0), opponentShockwave: t.f64().default(0),
});
