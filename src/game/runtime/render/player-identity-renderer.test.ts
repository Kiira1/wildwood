import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_SPEECH_BUBBLES_PER_PLAYER,
  PLATE_LINE_GAP,
  activeSpeechBubbleMessages,
  displayedPlayerPowerProgress,
  layoutPlayerPlate,
  plateTextInk,
} from "./player-identity-renderer";
import { PRESTIGE_BADGE_PX } from "../../../../shared/prestige";
import { plateSize } from "./nameplate-scale";

function message(sender: string, text: string, sentAtMs: number, senderName = sender, replayId = 0n) {
  return { id: BigInt(sentAtMs), sender, senderName, message: text, replayId, sentAtMs };
}

describe("player identity renderer", () => {
  it("carries every combat equipment slot into the local displayed-power input", () => {
    expect(displayedPlayerPowerProgress({
      maxHp: 100,
      damage: 10,
      attackRate: 1.56,
      armor: 0,
      regen: 0,
    }, {
      equippedHead: "helmet",
      equippedChest: "armor",
      equippedRightHand: "bow",
      equippedLeftHand: "",
    })).toMatchObject({
      equippedHead: "helmet",
      equippedChest: "armor",
      equippedRightHand: "bow",
      equippedLeftHand: "",
    });
  });

  it("stacks the newest active message nearest the player and pushes older messages upward", () => {
    const now = 10_000;
    const active = activeSpeechBubbleMessages([
      message("rymel", "expired", now - 8_000),
      message("rymel", "oldest active", now - 7_000),
      message("rymel", "middle", now - 3_000),
      message("rymel", "newer", now - 2_000),
      message("rymel", "newest", now - 1_000),
    ], now);

    expect(MAX_ACTIVE_SPEECH_BUBBLES_PER_PLAYER).toBe(3);
    expect(active.get("rymel")?.map((entry) => entry.message)).toEqual(["newest", "newer", "middle"]);
  });

  it("keeps system and duel announcements out of overhead bubbles", () => {
    const now = 10_000;
    const active = activeSpeechBubbleMessages([
      message("system", "rymel has logged in.", now - 1_000, ""),
      message("duel", "A duel finished.", now - 1_000, "DUEL", 1n),
      message("player", "hello", now - 1_000),
    ], now);

    expect([...active.keys()]).toEqual(["player"]);
  });

  describe("plate line spacing", () => {
    // Roughly a 7.8px bold rounded font: digits sit on the baseline, "(guest)" and "gy" hang below it.
    const digits = { width: 20, ascent: 5.6, descent: 0 };
    const plainName = { width: 40, ascent: 5.8, descent: 0 };
    const hangingName = { width: 40, ascent: 5.8, descent: 1.7 };
    const guestLine = { width: 30, ascent: 5.9, descent: 1.6 };
    const floor = -12;

    function gaps(boxes: { top: number; bottom: number }[]) {
      const result = [floor - boxes[0].bottom];
      for (let index = 1; index < boxes.length; index++) result.push(boxes[index - 1].top - boxes[index].bottom);
      return result;
    }

    it("leaves the same space under the power line, the name and \"(guest)\" for a guest with a prestige badge", () => {
      const plate = layoutPlayerPlate({ floor, power: digits, powerIcon: true, name: plainName, badge: true, genderIcon: true, guest: guestLine, invisible: null });
      expect(plate.boxes).toHaveLength(3);
      for (const gap of gaps(plate.boxes)) expect(gap).toBeCloseTo(PLATE_LINE_GAP);
      // The badge, not the text, sets the name line's height.
      expect(plate.boxes[1].bottom - plate.boxes[1].top).toBeGreaterThanOrEqual(plateSize(PRESTIGE_BADGE_PX));
      expect(plate.top).toBe(plate.boxes[2].top);
    });

    it("keeps the spaces even when a name hangs below its baseline", () => {
      const plain = layoutPlayerPlate({ floor, power: digits, powerIcon: true, name: plainName, badge: false, genderIcon: true, guest: guestLine, invisible: null });
      const hanging = layoutPlayerPlate({ floor, power: digits, powerIcon: true, name: hangingName, badge: false, genderIcon: true, guest: guestLine, invisible: null });
      for (const gap of gaps(hanging.boxes)) expect(gap).toBeCloseTo(PLATE_LINE_GAP);
      // The name rises by exactly its descender, and "(guest)" with it.
      expect(plain.name! - hanging.name!).toBeCloseTo(1.7);
      expect(plain.guest! - hanging.guest!).toBeCloseTo(1.7);
    });

    it("puts \"Invisible\" an even space over the rest", () => {
      const plate = layoutPlayerPlate({ floor, power: null, powerIcon: false, name: plainName, badge: false, genderIcon: false, guest: null, invisible: guestLine });
      for (const gap of gaps(plate.boxes)) expect(gap).toBeCloseTo(PLATE_LINE_GAP);
      expect(plate.invisible).not.toBeNull();
    });

    it("falls back to the font size when a browser gives no glyph bounds", () => {
      expect(plateTextInk({ width: 10 }, 10)).toEqual({ width: 10, ascent: 8, descent: 2 });
      expect(plateTextInk({ width: 10, actualBoundingBoxAscent: 6, actualBoundingBoxDescent: 0 }, 10)).toEqual({ width: 10, ascent: 6, descent: 0 });
    });
  });
});
