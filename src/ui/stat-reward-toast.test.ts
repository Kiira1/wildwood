import { describe, expect, it } from "vitest";
import { formatStatRewardToastAmount, statRewardToastModel } from "./stat-reward-toast";

describe("stat reward toast", () => {
  it.each([
    ["+4.88m DAMAGE", "+4.88m", "Damage"],
    ["+4.88m Damage", "+4.88m", "Damage"],
    ["+8.50k MAX HEALTH", "+8.50k", "Max Health"],
    ["+150 ARMOR", "+150", "Armor"],
    ["+0.25 ATK/SEC", "+0.25", "Attack Speed"],
    ["+12 HP/SEC", "+12", "Regeneration"],
  ])("presents %s as a labeled stat increase", (text, amount, label) => {
    expect(statRewardToastModel(text)).toMatchObject({ amount, label });
  });

  it("parses compact amounts so repeated rewards can be accumulated", () => {
    expect(statRewardToastModel("+4.88m DAMAGE")).toMatchObject({ stat: "DAMAGE", value: 4_880_000 });
    expect(statRewardToastModel("+0.25 ATK/SEC")).toMatchObject({ stat: "ATK/SEC", value: .25 });
    expect(formatStatRewardToastAmount("DAMAGE", 9_760_000)).toBe("+9.76m");
    expect(formatStatRewardToastAmount("ATK/SEC", .5)).toBe("+0.50");
  });

  it("leaves unrelated notifications available to the fallback renderer", () => {
    expect(statRewardToastModel("ITEM FOUND")).toBeNull();
    expect(statRewardToastModel("+mystery DAMAGE")).toBeNull();
  });
});

it("names a curve map's speed reward Attack Speed", () => {
  expect(statRewardToastModel("+0.36 Attack Speed")).toMatchObject({ stat: "ATTACK SPEED", value: .36, label: "Attack Speed" });
});

it("shows soul stat gains as stat gains, apart from the run's own: crit damage as ×, attack speed as /s", async () => {
  const { SOUL_STAT_DETAILS } = await import("../../shared/soul-dimension");
  const { soulRewardText } = await import("../game/soul-world");
  for (const [stat, detail] of Object.entries(SOUL_STAT_DETAILS)) {
    // The text a soul kill logs (soul-dimension-runtime.ts): crit damage reads "+0.002×".
    const amount = soulRewardText(stat as keyof typeof SOUL_STAT_DETAILS);
    const model = statRewardToastModel(`${amount} Soul ${detail.label}`);
    expect(model, detail.label).toMatchObject({ label: `Soul ${detail.label}`, amount });
    expect(model!.stat).not.toBe(statRewardToastModel("+1 Damage")!.stat);
  }
  expect(formatStatRewardToastAmount("SOUL CRIT DAMAGE", .002 * 3)).toBe("+0.006×");
  expect(formatStatRewardToastAmount("SOUL ATTACK SPEED", .001 * 3)).toBe("+0.003/s");
  expect(statRewardToastModel("+2.50 Crit Damage")).toMatchObject({ stat: "CRIT DAMAGE", value: 2.5, label: "Crit Damage" });
  expect(formatStatRewardToastAmount("SOUL DAMAGE", 12)).toBe("+12");
});

it("shows every name attack speed goes by as Capped at the cap", () => {
  for (const text of ["+0.25 ATK/SEC", "+2.50 Attack Speed", "+1 Soul Attack Speed"]) {
    expect(statRewardToastModel(text, true), text).toMatchObject({ amount: "Capped", value: 0, capped: true });
    expect(statRewardToastModel(text, false), text).toMatchObject({ capped: false });
  }
  expect(statRewardToastModel("+2.50 Crit Damage", true)).toMatchObject({ capped: false, amount: "+2.50" });
});
