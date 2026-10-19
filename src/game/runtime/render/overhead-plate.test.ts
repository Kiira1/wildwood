import { afterEach, describe, expect, it, vi } from "vitest";
import { blankRowsAbove, headArtTopOffsetY, headArtTopRow } from "./overhead-plate";
import { createActorRenderer } from "./actor-renderer";
import { setOwnNamePlateEnabled } from "../../../ui/name-plate-setting";
import type { DuelCombatant } from "../types";

// Every helmet is a 118x106 frame resting on row 144; the measured art decides how far up it reaches.
const helmet = { complete: true, naturalWidth: 118, naturalHeight: 106 };
const blank = (rows: number) => () => rows;

describe("overhead plate height", () => {
  it("clears a bare head by its top row, idle bob included", () => {
    expect(headArtTopRow(undefined, undefined)).toBe(69);
    expect(headArtTopOffsetY(undefined, undefined)).toBeCloseTo(29 + (69 - 171) * .6);
  });

  it("rises with a taller helmet, from the top of its art rather than its frame", () => {
    // The Antler Hood's tips start 10 rows into the frame; a felt cap's 13 rows; the tallest helmets at 0.
    const antlers = headArtTopOffsetY("mythic_light_helmet", helmet, blank(10));
    const cap = headArtTopOffsetY("crude_light_helmet", helmet, blank(13));
    const tallest = headArtTopOffsetY("celestial_medium_helmet", helmet, blank(0));
    expect(headArtTopRow("mythic_light_helmet", helmet, blank(10))).toBe(144 - 106 + 10 - 3);
    expect(tallest).toBeLessThan(antlers);
    expect(antlers).toBeLessThan(cap);
    expect(cap).toBeLessThan(headArtTopOffsetY(undefined, undefined));
  });

  it("keeps a bareheaded plate when the helmet has not loaded or is not headwear", () => {
    const bare = headArtTopRow(undefined, undefined);
    expect(headArtTopRow("mythic_light_helmet", undefined)).toBe(bare);
    expect(headArtTopRow("mythic_light_helmet", { naturalWidth: 0, naturalHeight: 0 })).toBe(bare);
    expect(headArtTopRow("mythic_light_armor", helmet, blank(0))).toBe(bare);
  });

  it("never goes below the head for a helmet that sits lower than the head's top", () => {
    expect(headArtTopRow("mythic_light_helmet", helmet, blank(80))).toBe(headArtTopRow(undefined, undefined));
  });

  it("counts transparent rows above the first solid pixel and ignores a faint edge", () => {
    const width = 2, height = 4, pixels = new Uint8ClampedArray(width * height * 4);
    pixels[(1 * width) * 4 + 3] = 10;
    pixels[(2 * width + 1) * 4 + 3] = 255;
    expect(blankRowsAbove(pixels, width, height)).toBe(2);
    expect(blankRowsAbove(new Uint8ClampedArray(8), 1, 2)).toBe(2);
  });
});

describe("Show My Name Plate", () => {
  afterEach(() => setOwnNamePlateEnabled(true));

  function renderer() {
    const drawStatus = vi.fn(), drawIdentity = vi.fn(), drawSpeechBubble = vi.fn();
    const sprite = { ...helmet } as HTMLImageElement;
    const actors = createActorRenderer({
      ctx: { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), globalAlpha: 1 },
      camera: { x: 0, y: 0, zoom: 1 }, viewport: () => ({ width: 800, height: 800 }),
      devicePixelRatio: () => 1, gameTime: () => 0, localDeath: () => null, remoteDeath: () => null,
      player: { x: 100, y: 100, hp: 10, maxHp: 10 }, enemies: [], activeBossTarget: () => null, remoteAttackRange: 100,
      localHeadItem: () => "mythic_light_helmet", localChestItem: () => "", localFeetItem: () => "", localRightHandItem: () => "", localLeftHandItem: () => "",
      equipmentForIdentity: () => ({}), itemSprite: (itemId: string | undefined) => itemId ? sprite : undefined,
      drawPlayerAppearance: vi.fn(), drawShadow: vi.fn(), pixelCircle: vi.fn(),
      drawStatus, drawIdentity, drawSpeechBubble, publicName: (_: string | undefined, name: string | undefined) => name ?? "",
    } as unknown as Parameters<typeof createActorRenderer>[0]);
    return { actors, drawStatus, drawIdentity, drawSpeechBubble };
  }
  const combatant = (isLocal: boolean) => ({ identity: isLocal ? "me" : "them", name: isLocal ? "Me" : "Them", isLocal, x: 0, y: 0, facing: 0, hp: 5, maxHp: 10 }) as unknown as DuelCombatant;

  it("puts the local plate over the worn helmet, higher than a bare head's", () => {
    const { actors, drawStatus } = renderer();
    actors.drawPlayer("me", "Me", 10);
    const { y, headTop } = drawStatus.mock.calls[0][0];
    expect(headTop).toBeLessThan(y + headArtTopOffsetY(undefined, undefined));
  });

  it("hides only your own plate when turned off; others and duels keep theirs, and chat bubbles stay", () => {
    setOwnNamePlateEnabled(false);
    const { actors, drawStatus, drawIdentity, drawSpeechBubble } = renderer();
    actors.drawPlayer("me", "Me", 10);
    expect(drawStatus).not.toHaveBeenCalled();
    expect(drawSpeechBubble).toHaveBeenCalledTimes(1);
    actors.drawRemotePlayer({ id: "them", name: "Them", x: 120, y: 100, facing: 0, power: 5, headItem: "mythic_light_helmet" } as never);
    expect(drawIdentity).toHaveBeenCalledTimes(1);
    actors.drawDuelScene({ shots: [], challenger: combatant(true), opponent: combatant(false) } as never);
    expect(drawStatus.mock.calls.map(([status]) => status.identity)).toEqual(["me", "them"]);
  });
});
