import { expect, it, vi } from "vitest";
import { createToolRows } from "./tool-service";

function fakeConnection(active = true) {
  const handlers: Array<() => void> = [];
  const applied: Array<() => void> = [];
  const rows: any[] = [];
  const subscribe = vi.fn();
  const upgradeTool = vi.fn(async () => undefined);
  const connection = {
    isActive: active,
    db: { myTools: {
      iter: () => rows[Symbol.iterator](),
      onInsert: (handler: () => void) => handlers.push(handler),
      onUpdate: (handler: () => void) => handlers.push(handler),
      onDelete: (handler: () => void) => handlers.push(handler),
    } },
    reducers: { upgradeTool },
    subscriptionBuilder: () => ({ onApplied(callback: () => void) { applied.push(callback); return this; }, subscribe }),
  };
  return { connection: connection as never, rows, subscribe, upgradeTool, settle: () => applied.forEach(callback => callback()), fire: () => handlers.forEach(handler => handler()) };
}

it("serves each tool's level, Worn for a tool with no row, and ignores unknown tools", () => {
  const fake = fakeConnection(), notify = vi.fn(), service = createToolRows(notify);
  service.watch(fake.connection, () => true);
  expect(fake.subscribe).toHaveBeenCalledOnce();
  fake.settle();
  expect(service.api.toolLevels()).toEqual({ pickaxe: 0, hatchet: 0, hammer: 0, knife: 0, focus: 0 });
  fake.rows.push({ tool: "knife", level: 4 }, { tool: "shovel", level: 9 });
  fake.fire();
  expect(service.api.toolLevel("knife")).toBe(4);
  expect(service.api.toolLevels()).toEqual({ pickaxe: 0, hatchet: 0, hammer: 0, knife: 4, focus: 0 });
  expect(notify).toHaveBeenCalled();
});

it("ignores rows from a connection that is no longer current", () => {
  const fake = fakeConnection(), service = createToolRows(vi.fn());
  let current = true;
  service.watch(fake.connection, () => current);
  fake.rows.push({ tool: "pickaxe", level: 2 });
  fake.settle();
  current = false;
  fake.rows[0] = { tool: "pickaxe", level: 5 };
  fake.fire();
  expect(service.api.toolLevel("pickaxe")).toBe(2);
});

it("upgrades at the level the client shows, and reports a refusal", async () => {
  const fake = fakeConnection(), service = createToolRows(vi.fn());
  expect(await service.api.upgradeTool("hammer", 0)).toEqual({ ok: false, error: "NOT CONNECTED" });
  service.watch(fake.connection, () => true);
  expect(await service.api.upgradeTool("hammer", 0)).toEqual({ ok: true });
  expect(fake.upgradeTool).toHaveBeenCalledWith({ tool: "hammer", expectedLevel: 0 });
  fake.upgradeTool.mockRejectedValueOnce(new Error("You need Lv 3 Smithing."));
  expect((await service.api.upgradeTool("hammer", 0)).ok).toBe(false);
});
