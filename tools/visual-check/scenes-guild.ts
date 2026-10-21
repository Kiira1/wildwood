// The guild-battlefield scene: a guild battle replay's canvas, portrait and landscape, at fixed moments.
import { simulateGuildBattle, type GuildFighter } from "../../shared/guild-combat";
import { buildGuildReplayTimeline } from "../../src/ui/guild-replay-timeline";
import { buildGuildReplayEntrance } from "../../src/ui/guild-replay-entrance";
import { createGuildBattlefieldRenderer } from "../../src/ui/guild-battlefield-renderer";
import { requiredCanvasContext } from "../../src/game/runtime/dom";
import { STARTER_BOW, STARTER_STAFF, STARTER_STONE, WOODEN_SWORD } from "../../shared/items";
import { sharedAssets } from "./game-world";
import { drawUntilStable, resetRandom, settleImages } from "./determinism";
import { section } from "./world";

const WEAPONS = [STARTER_BOW, WOODEN_SWORD, STARTER_STAFF, STARTER_STONE, "rare_bow"];
const ARMOR = ["rare_light_armor", "epic_heavy_armor", "mythic_magic_armor", "", "heroic_medium_armor"];

/** A guild's members: mixed weapons and armour, a long name or two, stats that make a fight of it. */
function team(prefix: string, size: number, strength: number): GuildFighter[] {
  return Array.from({ length: size }, (_, index) => ({
    identity: `${prefix}-${index}`, name: index === 1 ? `${prefix}_Longname_gq` : `${prefix}${index}`,
    fighter: { maxHp: 400 + index * 60, damage: (24 + index * 3) * strength, armor: index % 3, regen: 1, attackRate: 1 + index % 2 * .3 },
    range: WEAPONS[index % WEAPONS.length] === WOODEN_SWORD ? 90 : 220,
    appearance: { rightHandItem: WEAPONS[index % WEAPONS.length], chestItem: ARMOR[index % ARMOR.length], headItem: index % 2 ? "rare_light_helmet" : "" },
  }));
}

/** One replay canvas `width` × `height` (CSS pixels) at `time` seconds of the fight. */
function view(parent: HTMLElement, title: string, size: { width: number; height: number }, battle: ReturnType<typeof simulateGuildBattle>, split: number, time: number, elapsed: number) {
  const host = section(title);
  host.style.width = `${size.width}px`;
  parent.append(host);
  const canvas = document.createElement("canvas");
  canvas.style.cssText = `display:block;width:${size.width}px;height:${size.height}px`;
  host.append(canvas);
  const assets = sharedAssets();
  const renderer = createGuildBattlefieldRenderer(canvas, requiredCanvasContext(canvas), buildGuildReplayTimeline(battle), split, {
    player: assets.playerAppearanceAssets, prepare: () => assets.assets.ensureMapAssets("home_exterior"),
    trees: assets.assets.treeSpritesheet, treeBounds: assets.assets.treeSpriteBounds,
  }, battle.version >= 3 ? buildGuildReplayEntrance(battle) : undefined);
  return () => { renderer.draw(time, true, elapsed); };
}

/** A small fight as it starts, at its first blows and midway; a full one portrait and landscape. */
export async function guildBattlefield() {
  await sharedAssets().assets.ensureMapAssets("home_exterior");
  await settleImages();
  resetRandom();
  const small = simulateGuildBattle(team("Ash", 5, 1), team("Oak", 5, 1.1));
  const full = simulateGuildBattle(team("North", 20, 1), team("South", 20, 1));
  const entranceEnds = small.version >= 3 ? buildGuildReplayEntrance(small).duration : 0;
  const firstBlow = buildGuildReplayTimeline(small).shots[0]?.impact ?? 1;
  const row = document.createElement("div");
  row.style.cssText = "display:flex;flex-wrap:wrap;align-items:flex-start";
  document.body.append(row);
  const portrait = { width: 390, height: 700 };
  const draws = [
    view(row, "5 v 5 · walking in", portrait, small, 5, 0, entranceEnds * .75),
    view(row, "5 v 5 · the first blow lands", portrait, small, 5, firstBlow, Math.max(firstBlow, entranceEnds)),
    view(row, "5 v 5 · midway", portrait, small, 5, small.duration / 2, small.duration / 2 + entranceEnds),
    view(row, "20 v 20 · midway, portrait", portrait, full, 20, full.duration / 2, full.duration / 2 + 30),
    view(row, "20 v 20 · midway, landscape", { width: 844, height: 390 }, full, 20, full.duration / 2, full.duration / 2 + 30),
  ];
  await drawUntilStable(() => draws.forEach(draw => draw()));
}
