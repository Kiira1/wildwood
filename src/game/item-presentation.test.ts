import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLOUDSPIRE_ARMOR, CLOUDSPIRE_BOW, CLOUDSPIRE_HELMET, MOONFEN_ARMOR, WATER_ARMOR, SKY_BOW, SAMURAI_BOW, DARK_METAL_HELMET, FIRE_METAL_BOW, FIRE_METAL_HELMET, FROST_ARMOR, FROST_BOW, IRON_BOW, LAVA_BOW, MAGMA_ARMOR, NIGHT_BOW, SNOW_BOW, STARTER_BOW, STARTER_STONE, WOOD_FULL_HELM, WOODEN_ARMOR } from "../../shared/items";
import { ITEM_PRESENTATIONS, itemArtMarkup, itemInventoryRotation, itemPresentation, projectileKindForWeapon } from "./item-presentation";

describe("item presentation", () => {
  it("uses the same display angle for every bow, including later campaign gear", () => {
    for (const [id, presentation] of Object.entries(ITEM_PRESENTATIONS)) {
      if (presentation.projectile !== "ARROW") continue;
      expect(itemInventoryRotation(id), id).toBe(-45);
      expect(itemArtMarkup(id), id).toContain("--item-art-rotation: -45deg");
    }
    expect(itemInventoryRotation(STARTER_STONE)).toBe(0);
    expect(itemInventoryRotation(FROST_ARMOR)).toBe(0);
  });
  it("renders weapon-specific inventory and inspection art", () => {
    expect(itemArtMarkup(STARTER_STONE)).toContain("stone.webp");
    expect(itemArtMarkup(STARTER_BOW)).toContain("data:image/png;base64,");
    expect(itemArtMarkup(FROST_BOW)).toContain("player-parts/frost-bow.webp");
    expect(itemArtMarkup(FROST_ARMOR)).toContain("player-parts/frost-armor.webp");
    expect(itemArtMarkup(IRON_BOW)).toContain("player-parts/iron-bow.webp");
    expect(itemArtMarkup(WOOD_FULL_HELM)).toContain("player-parts/wood-full-helm.webp");
    expect(itemArtMarkup(LAVA_BOW)).toContain("player-parts/lava-bow.webp");
    expect(itemArtMarkup(MAGMA_ARMOR)).toContain("player-parts/magma-armor.webp");
    expect(itemArtMarkup(FIRE_METAL_HELMET)).toContain("player-parts/fire-metal-helmet.webp");
    expect(itemArtMarkup(DARK_METAL_HELMET)).toContain("player-parts/dark-metal-helmet.webp");
    expect(itemArtMarkup(FIRE_METAL_BOW)).toContain("player-parts/fire-metal-bow.webp");
    expect(itemArtMarkup(SNOW_BOW)).toContain("player-parts/snow-bow.webp");
    expect(itemArtMarkup(NIGHT_BOW)).toContain("player-parts/night-bow.webp");
    expect(itemArtMarkup(WOODEN_ARMOR)).toContain("data:image/png;base64,");
    expect(itemArtMarkup(STARTER_STONE)).not.toContain("boot-pixel-icon");
    expect(itemArtMarkup(STARTER_BOW)).not.toContain("boot-pixel-icon");
  });

  it("keeps Rock and Bow projectile visuals separate", () => {
    expect(projectileKindForWeapon(STARTER_STONE)).toBe("ROCK");
    expect(projectileKindForWeapon(STARTER_BOW)).toBe("ARROW");
    expect(projectileKindForWeapon(FROST_BOW)).toBe("ARROW");
    expect(projectileKindForWeapon(IRON_BOW)).toBe("ARROW");
    expect(projectileKindForWeapon(SNOW_BOW)).toBe("ARROW");
    expect(projectileKindForWeapon(NIGHT_BOW)).toBe("ARROW");
  });

  it("renders world bows twenty-five percent larger", () => {
    const world = itemPresentation(STARTER_BOW)?.world;
    expect(world?.kind).toBe("SPRITE");
    if (world?.kind !== "SPRITE") return;
    expect(world.width).toBe(115);
    expect(world.height).toBe(63);
  });

  it("uses the exact transparent blue vendor bow asset at the established bow size", () => {
    const asset = readFileSync(new URL("../../public/assets/wildstat/player-parts/frost-bow.webp", import.meta.url));
    expect(createHash("sha256").update(asset).digest("hex")).toBe("379efda3daad1c59ef6dd771374679362f81e1dc3b6c1b1d8d840574822830f5");
    const world = itemPresentation(FROST_BOW)?.world;
    expect(world).toMatchObject({
      kind: "SPRITE",
      source: "assets/wildstat/player-parts/frost-bow.webp",
      width: 115,
      height: 63,
      top: 106,
      handAction: "BOW",
    });
  });

  it("uses the requested Lava Bow and Magma Armor vendor assets", () => {
    const bow = readFileSync(new URL("../../public/assets/wildstat/player-parts/lava-bow.webp", import.meta.url));
    const armor = readFileSync(new URL("../../public/assets/wildstat/player-parts/magma-armor.webp", import.meta.url));
    expect(createHash("sha256").update(bow).digest("hex")).toBe("5a3afc76f2ff999d5105d1c6ab602bafa11480e8948c27051a2964c24c3d3801");
    expect(createHash("sha256").update(armor).digest("hex")).toBe("692987210b07b2d65b2eefbb7c195a7253c928ac187b842082aa648c1ece1599");
  });

  it("uses the exact requested white and purple vendor bow assets", () => {
    const snowBow = readFileSync(new URL("../../public/assets/wildstat/player-parts/snow-bow.webp", import.meta.url));
    const nightBow = readFileSync(new URL("../../public/assets/wildstat/player-parts/night-bow.webp", import.meta.url));
    expect(createHash("sha256").update(snowBow).digest("hex")).toBe("d8823d6cd7ecb245ec40f3a4bbda5704a6018343cca8ce94b434d2646119405a");
    expect(createHash("sha256").update(nightBow).digest("hex")).toBe("44d06c1580c3135ca1a506ee3679a6a25ca5fd9827fb3c39042a3b2118e77f96");
    expect(itemPresentation(SNOW_BOW)?.world).toMatchObject({ layer: "HAND", width: 115, height: 63, top: 106, handAction: "BOW" });
    expect(itemPresentation(NIGHT_BOW)?.world).toMatchObject({ layer: "HAND", width: 115, height: 63, top: 106, handAction: "BOW" });
  });

  it("uses the requested Wood Full Helm and Iron Bow vendor assets", () => {
    const helm = readFileSync(new URL("../../public/assets/wildstat/player-parts/wood-full-helm.webp", import.meta.url));
    const bow = readFileSync(new URL("../../public/assets/wildstat/player-parts/iron-bow.webp", import.meta.url));
    expect(createHash("sha256").update(helm).digest("hex")).toBe("9c1fe44f900d50c4a257cf076043e8aa445a5b005eb1f6c36a7fb20c2a006a1a");
    expect(createHash("sha256").update(bow).digest("hex")).toBe("b3dbcdee4209407e791458f826d28e4d4e6a85f6401514461e1c11dec935bef0");
    expect(itemPresentation(WOOD_FULL_HELM)?.world).toMatchObject({
      kind: "SPRITE",
      source: "assets/wildstat/player-parts/wood-full-helm.webp",
      layer: "HEAD",
      bottom: 144,
    });
    expect(itemPresentation(IRON_BOW)?.world).toMatchObject({
      kind: "SPRITE",
      source: "assets/wildstat/player-parts/iron-bow.webp",
      layer: "HAND",
      width: 115,
      height: 63,
      top: 106,
      handAction: "BOW",
    });
  });

  it("uses the exact requested Fire Metal equipment assets", () => {
    const helmet = readFileSync(new URL("../../public/assets/wildstat/player-parts/fire-metal-helmet.webp", import.meta.url));
    const bow = readFileSync(new URL("../../public/assets/wildstat/player-parts/fire-metal-bow.webp", import.meta.url));
    expect(createHash("sha256").update(helmet).digest("hex")).toBe("a9985a051050d398981a110ae5cda229f29fe99f9b22fb8c88ea3e62fe93a974");
    expect(createHash("sha256").update(bow).digest("hex")).toBe("c95f23dc820414bee8ea1d622c2ff7fd2fbbad89bed0a5fd08067af2c6258e6b");
    expect(itemPresentation(FIRE_METAL_HELMET)?.world).toMatchObject({ layer: "HEAD", bottom: 144 });
    expect(itemPresentation(FIRE_METAL_BOW)?.world).toMatchObject({ layer: "HAND", width: 115, height: 63, top: 106, handAction: "BOW" });
  });

  it("uses the requested dark horned helmet asset", () => {
    const helmet = readFileSync(new URL("../../public/assets/wildstat/player-parts/dark-metal-helmet.webp", import.meta.url));
    expect(createHash("sha256").update(helmet).digest("hex")).toBe("c090fa90ece6d3f2854ef914c4640a39829385f935c6b120f4b9cd3f59421504");
    expect(itemPresentation(DARK_METAL_HELMET)?.world).toMatchObject({
      kind: "SPRITE",
      source: "assets/wildstat/player-parts/dark-metal-helmet.webp",
      layer: "HEAD",
      bottom: 144,
    });
  });

  it("uses the exact transparent FA_Chest_032_Blue vendor armor asset", () => {
    const asset = readFileSync(new URL("../../public/assets/wildstat/player-parts/frost-armor.webp", import.meta.url));
    expect(createHash("sha256").update(asset).digest("hex")).toBe("3b4070985d9e061fa4fea2bd856489890a20086f08f1253962fcec683f4856e6");
    expect(itemPresentation(FROST_ARMOR)?.world).toMatchObject({
      kind: "SPRITE",
      source: "assets/wildstat/player-parts/frost-armor.webp",
      layer: "CHEST",
      width: 76,
      height: 68,
      top: 100,
    });
  });
});

it.each([
  [CLOUDSPIRE_ARMOR, "cloudspire-armor", "2d08c409b20151c083c15fc538b04e09c7bad4d3064c4aeeb642675a1cd04de8", "CHEST"],
  [MOONFEN_ARMOR, "moonfen-armor", "c50bf7080ce6d47d71ca99de51851e66a13a625398aece24a7e83a3d532d4e7a", "CHEST"],
  [CLOUDSPIRE_BOW, "cloudspire-bow", "6451340bdb6c19aa4c160bea8b790588c30e8210fd08d790290aeb36a6879a54", "HAND"],
  [CLOUDSPIRE_HELMET, "cloudspire-helmet", "857b07aca369224a7d7ee6ef315de240f79371dbf7a9eb811a5f9339e4202771", "HEAD"],
  [WATER_ARMOR, "water-armor", "9db5fa7aef001c32e855412a7c133eb842655b59ebf042e87e53bef9d98408e6", "CHEST"],
  [SKY_BOW, "sky-bow", "434e56f1188fc47ab0ca30b930054bb18556a66d0f5b6da066b50e8082d74c02", "HAND"],
  [SAMURAI_BOW, "samurai-bow", "c50197d05427072d42df031ff37d615728dcc1cfb4b6e9bede1184a1f4789741", "HAND"],
])("uses the exact vendor art for %s in inventory and on the character", (id, file, hash, layer) => {
  const asset = readFileSync(new URL(`../../public/assets/wildstat/player-parts/${file}.webp`, import.meta.url));
  expect(createHash("sha256").update(asset).digest("hex")).toBe(hash);
  expect(itemArtMarkup(id)).toContain(`${file}.webp`);
  expect(itemPresentation(id)?.world).toMatchObject({ kind: "SPRITE", layer });
  if (layer === "HAND") expect(projectileKindForWeapon(id)).toBe("ARROW");
});
