// A busy Trade Chrysanthemum: traders place, cancel, list, buy and collect at random through the real reducers.
// After every step no gold or resource may have appeared or vanished, and no gear piece may exist twice.
// Opt-in (npm run sim:exchange); the exact rules are in exchange.test.ts.
import { expect, it, vi } from "vitest";
import { ConnectionId } from "spacetimedb";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { progressOf } from "../../tests/helpers/progress";
import { TOWN_EXCHANGE_POSITION, TOWN_FEET_OFFSET } from "../../shared/town";
import { PROTOCOL_VERSION, SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../shared/rules";
import { REFINE_ORES, type OreId } from "../../shared/refine";
import { exchangeFee } from "../../shared/exchange";
import { addOres, oreCount, setRefineLevel } from "./item-refine";
import { addGold, goldFor } from "./gold";
import { inventoryForProgress } from "./progress-helpers";
import { setFirstCopyRoll } from "./equipment-copies";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

const TRADERS = ["1", "2", "3", "4", "5", "6"].map(identity);
const ORES = Object.keys(REFINE_ORES) as OreId[];
const GEAR = ["iron_bow", "rare_bow", "fine_sword"];
const STEPS = Number(process.env.EXCHANGE_SIM_STEPS ?? 4_000);

it(`keeps every gold coin, resource and gear piece through ${STEPS} random trades`, () => {
  const f = crystalFixture();
  const at = { mapId: "town", x: TOWN_EXCHANGE_POSITION.x, y: TOWN_EXCHANGE_POSITION.y - TOWN_FEET_OFFSET };
  f.patch("player", at);
  TRADERS.forEach((who, index) => {
    if (index > 0) {
      f.progress(who);
      f.seed("player", { identity: who, ...at, hp: 100, maxHp: 100, speed: 180, protocolVersion: PROTOCOL_VERSION, lastInputAt: f.ctx.timestamp });
      f.seed("playerProfile", { identity: who, displayName: `Trader ${index + 1}`, skinTone: 3 });
      f.seed("playerSession", { connectionId: new ConnectionId(BigInt(index + 1)), identity: who, enteredWorld: true,
        protocolVersion: PROTOCOL_VERSION, connectedAt: f.ctx.timestamp, tabId: `t${index}` });
      f.seed("playerController", { identity: who, connectionId: new ConnectionId(BigInt(index + 1)) });
    }
    // Half are Patreon supporters, with three slots.
    if (index % 2 === 0) f.seed("patreonLink", { identity: who, userId: `u${index}`, accessToken: "", refreshToken: "", tier: "gold", frame: "none",
      validUntilMs: 9e15, checkedAtMs: 0, attemptedAtMs: 0 });
    f.transaction(() => {
      addGold(f.ctx, who, 50_000);
      for (const ore of ORES) addOres(f.ctx, who, ore, 200 + index * 37);
      const gear = GEAR.filter((_, n) => (n + index) % 2 === 0);
      f.db.playerProgress.identity.update({ ...f.db.playerProgress.identity.find(who), inventoryJson: JSON.stringify(gear) });
      for (const itemId of gear) { setFirstCopyRoll(f.ctx, who, itemId, { arrowStorm: index, whirlwind: index }); setRefineLevel(f.ctx, who, itemId, 0n, index); }
    });
  });
  f.ctx.senderAuth = { jwt: { issuer: SPACETIME_AUTH_ISSUER, audience: [SPACETIME_AUTH_CLIENT_ID] } };

  let seed = 7;
  const random = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const as = (who: typeof TRADERS[number]) => { f.ctx.sender = who; f.ctx.connectionId = new ConnectionId(BigInt(TRADERS.indexOf(who) + 1)); };

  // What exists: gold held, gold set aside in buy offers, fees taken; resources held, on sale and waiting in collection boxes.
  let fees = 0n;
  const goldInWorld = () => TRADERS.reduce((sum, who) => sum + goldFor(f.ctx, who), 0n)
    + [...f.db.exchangeOffer.iter()].filter((o: any) => o.buy).reduce((sum: bigint, o: any) => sum + o.price * BigInt(o.quantity - o.filled), 0n) + fees;
  const oresInWorld = (ore: OreId) => TRADERS.reduce((sum, who) => sum + oreCount(f.ctx, who, ore), 0)
    + [...f.db.exchangeOffer.iter()].filter((o: any) => !o.buy && o.itemId === ore).reduce((sum: number, o: any) => sum + o.quantity - o.filled, 0)
    + [...f.db.exchangeCollect.iter()].filter((c: any) => c.itemId === ore).reduce((sum: number, c: any) => sum + c.count, 0);
  const gearInWorld = () => TRADERS.flatMap(who => inventoryForProgress(progressOf(f, who)).filter(id => GEAR.includes(id)))
    .concat([...f.db.playerEquipmentCopy.iter()].map((c: any) => c.itemId).filter(id => GEAR.includes(id)))
    .concat([...f.db.exchangeListing.iter()].map((l: any) => l.itemId), [...f.db.exchangeCollect.iter()].filter((c: any) => c.count === 0).map((c: any) => c.itemId)).length;

  const startGold = goldInWorld(), startOres = Object.fromEntries(ORES.map(ore => [ore, oresInWorld(ore)])), startGear = gearInWorld();
  let lastTradeId = 0n;
  const done = { placed: 0, cancelled: 0, listed: 0, bought: 0, collected: 0, refused: 0, trades: 0 };
  for (let step = 0; step < STEPS; step++) {
    const who = pick(TRADERS); as(who);
    const roll = random();
    try {
      if (roll < .45) {
        f.run(server.placeExchangeOffer, { buy: random() < .5, itemId: pick(ORES), quantity: 1 + Math.floor(random() * 60), price: BigInt(1 + Math.floor(random() * 40)) });
        done.placed++;
      } else if (roll < .6) {
        const mine = [...f.db.exchangeOffer.identity.filter(who)];
        if (!mine.length) continue;
        f.run(server.cancelExchangeOffer, { id: pick(mine).id }); done.cancelled++;
      } else if (roll < .7) {
        const held = inventoryForProgress(progressOf(f, who)).filter(id => GEAR.includes(id));
        if (!held.length) continue;
        f.run(server.listExchangeGear, { itemId: pick(held), copyId: 0n, price: BigInt(100 + Math.floor(random() * 900)) }); done.listed++;
      } else if (roll < .8) {
        const forSale = [...f.db.exchangeListing.iter()];
        if (!forSale.length) continue;
        const listing = pick(forSale);
        f.run(server.buyExchangeGear, { id: listing.id }); done.bought++;
        fees += exchangeFee(listing.price);
      } else if (roll < .85) {
        const mine = [...f.db.exchangeListing.identity.filter(who)];
        if (!mine.length) continue;
        f.run(server.cancelExchangeListing, { id: pick(mine).id }); done.cancelled++;
      } else {
        if (![...f.db.exchangeCollect.identity.filter(who)].length) continue;
        f.run(server.collectExchange); done.collected++;
      }
    } catch { done.refused++; }
    // Each new resource trade's fee (a gear buy's was counted above). The history keeps the latest 200, so count by id.
    for (const trade of [...f.db.exchangeTrade.iter()] as any[]) {
      if (trade.id <= lastTradeId) continue;
      lastTradeId = trade.id;
      if (!GEAR.includes(trade.itemId)) { fees += exchangeFee(trade.price * BigInt(trade.quantity)); done.trades++; }
    }
    expect(goldInWorld(), `gold after step ${step}`).toBe(startGold);
    for (const ore of ORES) expect(oresInWorld(ore), `${ore} after step ${step}`).toBe(startOres[ore]);
    expect(gearInWorld(), `gear after step ${step}`).toBe(startGear);
    // The price table always says what the offers and listings say.
    for (const itemId of [...ORES, ...GEAR]) {
      const offers = [...f.db.exchangeOffer.itemId.filter(itemId)] as any[], listings = [...f.db.exchangeListing.itemId.filter(itemId)] as any[];
      const asks = [...offers.filter(o => !o.buy).map(o => o.price), ...listings.map(l => l.price)], bids = offers.filter(o => o.buy).map(o => o.price);
      const row = f.db.exchangePrice.itemId.find(itemId);
      expect(row?.lowestAsk ?? 0n, `${itemId} ask after step ${step}`).toBe(asks.length ? asks.reduce((a, b) => (b < a ? b : a)) : 0n);
      expect(row?.highestBid ?? 0n, `${itemId} bid after step ${step}`).toBe(bids.length ? bids.reduce((a, b) => (b > a ? b : a)) : 0n);
      expect(row?.forSale ?? 0, `${itemId} for sale after step ${step}`).toBe(offers.filter(o => !o.buy).reduce((n, o) => n + o.quantity - o.filled, 0) + listings.length);
    }
  }
  process.stdout.write(`exchange sim ${JSON.stringify(done)} fees ${fees}\n`);
  expect(done.trades).toBeGreaterThan(50);
  expect(done.bought).toBeGreaterThan(5);
});
