import { describe, expect, it, vi } from "vitest";
vi.mock("../app/developer", () => ({ isDeveloperIdentity: () => false }));
import { TOWN_ARRIVAL, TOWN_CARD_SELLER_POSITION, TOWN_DOORS, TOWN_FEET_OFFSET, TOWN_SMITH_POSITION, TOWN_SOUL_PORTAL, TOWN_TRAVEL_PORTAL, inTownVillage, townRoomAt } from "../../shared/town";
import { TOWN_HILLS_SIGNPOST, TOWN_SCHOOL_SIGNPOSTS, TOWN_SIGNPOST, TOWN_STOP_SIGNPOSTS, townWindowDecor } from "./town-world";
import { pushOutOf, TOWN_SOLIDS } from "./runtime/town/town-runtime";
import { TOWN_SIGNPOST_EXTENT, TOWN_SIGNPOST_EXTENT_MIRRORED } from "./runtime/town/town-signpost";
import type { WorldDecor } from "./world";

type Sign = Extract<WorldDecor, { type: "soulProp" }>;
const signs = TOWN_STOP_SIGNPOSTS as readonly Sign[];
/** What each sign names, and the door or spot it points at. */
const TARGETS = [
  { label: "Smith", at: TOWN_SMITH_POSITION },
  { label: "Quests", at: TOWN_DOORS[5] },
  { label: "Research", at: TOWN_DOORS[1] },
  { label: "Ox · Cosmetics", at: TOWN_DOORS[8] },
];

function standable(x: number, y: number) {
  const feet = { x, y: y + TOWN_FEET_OFFSET, r: 12 };
  return TOWN_SOLIDS.every(solid => {
    const probe = { ...feet };
    pushOutOf(probe, solid);
    return Math.hypot(probe.x - feet.x, probe.y - feet.y) < .01;
  });
}
const box = (sign: Sign) => {
  const extent = sign.flip ? TOWN_SIGNPOST_EXTENT_MIRRORED : TOWN_SIGNPOST_EXTENT;
  return { left: sign.x - extent.left, right: sign.x + extent.right, top: sign.y - extent.up, bottom: sign.y + extent.down };
};

describe("the Town's signposts for its other stops", () => {
  it("names the Smith, the Inn's Quests, the Windmill's Research and Ox, each drawn with the village", () => {
    const decor = townWindowDecor(TOWN_ARRIVAL.x, TOWN_ARRIVAL.y);
    expect(signs.map(sign => sign.signpost)).toEqual(TARGETS.map(target => target.label));
    for (const sign of signs) {
      expect(decor).toContain(sign);
      expect(sign).toMatchObject({ type: "soulProp", frame: "" });
    }
  });

  it("stands each on open ground near what it names, pointing at it", () => {
    signs.forEach((sign, index) => {
      const { at } = TARGETS[index];
      expect(inTownVillage(sign.x, sign.y), sign.signpost).toBe(true);
      expect(townRoomAt(sign.x, sign.y)).toBeNull();
      expect(standable(sign.x, sign.y - TOWN_FEET_OFFSET), sign.signpost).toBe(true);
      expect(Math.hypot(sign.x - at.x, sign.y - at.y), sign.signpost).toBeLessThan(300);
      expect(Boolean(sign.flip), sign.signpost).toBe(at.x > sign.x);
    });
  });

  it("keeps clear of every door, the portals and the outdoor stalls' spots", () => {
    for (const sign of signs) {
      for (const door of TOWN_DOORS) {
        // Not in a doorway's walk: beside it, or well away from it.
        const inFront = Math.abs(sign.x - door.x) < door.half + 30 && sign.y > door.enter - 20 && sign.y < door.enter + 160;
        expect(inFront, `${sign.signpost} at door ${door.index}`).toBe(false);
      }
      for (const portal of [TOWN_TRAVEL_PORTAL, TOWN_SOUL_PORTAL]) expect(Math.hypot(sign.x - portal.x, sign.y - portal.y)).toBeGreaterThan(300);
      for (const spot of [TOWN_SMITH_POSITION, TOWN_CARD_SELLER_POSITION]) expect(Math.hypot(sign.x - spot.x, sign.y - spot.y), sign.signpost).toBeGreaterThan(80);
    }
  });

  it("overlaps no other signpost's post or plank", () => {
    const all = [TOWN_SIGNPOST, TOWN_HILLS_SIGNPOST, ...TOWN_SCHOOL_SIGNPOSTS, ...TOWN_STOP_SIGNPOSTS] as Sign[];
    for (const sign of signs) {
      for (const other of all) {
        if (other === sign) continue;
        const a = box(sign), b = box(other);
        const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlap, `${sign.signpost} and ${other.signpost}`).toBe(false);
      }
    }
  });

});
