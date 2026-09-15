import { describe, expect, it, vi } from "vitest";
import { focusChatReplyInput } from "./chat";
import {
  messageActionAvailability,
  canReactToMessage,
  shouldDismissMessageActionSheet,
  shouldOfferMessageReport,
} from "./chat-message-actions";

const target = {
  id: 7n,
  sender: "other-player",
  senderName: "Mossy Wolf",
  message: "hello",
  replayId: 0n,
};

describe("chat message actions", () => {
  it("allows native viewport scrolling when reply mode focuses the composer", () => {
    const focus = vi.fn();
    const setSelectionRange = vi.fn();

    focusChatReplyInput({ value: "draft", focus, setSelectionRange });

    expect(focus.mock.calls).toEqual([[]]);
    expect(setSelectionRange).toHaveBeenCalledWith(5, 5);
  });

  it("offers reports for another player's ordinary or replay message", () => {
    expect(shouldOfferMessageReport(target, "local-player")).toBe(true);
    expect(shouldOfferMessageReport(target, "other-player")).toBe(false);
    expect(shouldOfferMessageReport({ ...target, replayId: 2n }, "local-player")).toBe(true);
  });

  it("replaces Copy with Watch Replay while retaining Reply and Report", () => {
    expect(messageActionAvailability(target, "local-player")).toEqual({
      watchReplay: false,
      copy: true,
      original: false,
      directMessage: true,
      reply: true,
      report: true,
    });
    expect(messageActionAvailability({ ...target, replayId: 2n }, "local-player")).toEqual({
      watchReplay: true,
      copy: false, original: false,
      directMessage: true,
      reply: true,
      report: true,
    });
  });

  it("offers Original only on replies", () => {
    expect(messageActionAvailability({ ...target, replyToMessageId: 3n }, "local").original).toBe(true);
    expect(messageActionAvailability({ ...target, replyToMessageId: 0n }, "local").original).toBe(false);
  });

  it("hides Direct message for your own messages and system messages", () => {
    expect(messageActionAvailability(target, target.sender).directMessage).toBe(false);
    expect(messageActionAvailability({ ...target, senderName: "" }, "local").directMessage).toBe(false);
    expect(messageActionAvailability({ ...target, sender: "" }, "local").directMessage).toBe(false);
  });

  it("dismisses on a deliberate pull or a quick downward swipe", () => {
    expect(shouldDismissMessageActionSheet(90, 320, 500)).toBe(true);
    expect(shouldDismissMessageActionSheet(32, 320, 45)).toBe(true);
    expect(shouldDismissMessageActionSheet(32, 320, 500)).toBe(false);
  });
  it("offers Watch Replay and Reply for a guild announcement without player report actions", () => {
    expect(messageActionAvailability({ ...target, guildReplayKey: "1:42" }, "local-player")).toEqual({
      watchReplay: true, copy: false, original: false, directMessage: false, reply: true, report: false,
    });
  });
});

it("offers reactions only for another player's unmoderated message", () => {
  expect(canReactToMessage(target, "local-player")).toBe(true);
  expect(canReactToMessage(target, target.sender)).toBe(false);
  expect(canReactToMessage({ ...target, moderated: true }, "local-player")).toBe(false);
  expect(canReactToMessage({ ...target, sender: "" }, "local-player")).toBe(false);
  expect(canReactToMessage(target, "")).toBe(false);
});
