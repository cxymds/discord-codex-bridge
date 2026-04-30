import { describe, expect, it, vi } from "vitest";
import { handleNotifyTurnEnded } from "../src/notifyTurnEnded.js";

describe("handleNotifyTurnEnded", () => {
  it("does not post a notify final message that was already posted by the direct Discord turn", async () => {
    const session = {
      id: "bridge1",
      discordThreadId: "thread1"
    };
    const events = [{ source: "codex", kind: "turn_result", payload: { finalMessage: "done" } }];
    const store = {
      listEventsBySessionId: vi.fn(() => events),
      recordEvent: vi.fn((event) => {
        events.push(event);
      }),
      markTurn: vi.fn()
    };
    const postMessage = vi.fn(async () => undefined);

    await handleNotifyTurnEnded({
      payload: { session_id: "codex1", final_message: "done" },
      resolveSession: vi.fn(async () => session),
      store: store as never,
      discord: { postMessage }
    });

    expect(postMessage).not.toHaveBeenCalled();
    expect(store.markTurn).not.toHaveBeenCalled();
    expect(store.recordEvent).toHaveBeenCalledWith({ sessionId: "bridge1", source: "codex", kind: "turn_result", payload: expect.any(Object) });
  });

  it("posts a notify final message when it has not been posted yet", async () => {
    const session = {
      id: "bridge1",
      discordThreadId: "thread1"
    };
    const events: Array<{ source: "codex"; kind: "turn_result"; payload: unknown }> = [];
    const store = {
      listEventsBySessionId: vi.fn(() => events),
      recordEvent: vi.fn((event) => {
        events.push(event);
      }),
      markTurn: vi.fn()
    };
    const postMessage = vi.fn(async () => undefined);

    await handleNotifyTurnEnded({
      payload: { session_id: "codex1", final_message: "new answer" },
      resolveSession: vi.fn(async () => session),
      store: store as never,
      discord: { postMessage }
    });

    expect(store.markTurn).toHaveBeenCalledWith("bridge1");
    expect(postMessage).toHaveBeenCalledWith("thread1", "new answer");
  });

  it("does not treat the current notify payload as an already posted message", async () => {
    const session = {
      id: "bridge1",
      discordThreadId: "thread1"
    };
    const events: Array<{ source: "codex"; kind: "turn_result"; payload: unknown }> = [];
    const store = {
      listEventsBySessionId: vi.fn(() => events),
      recordEvent: vi.fn((event) => {
        events.push(event);
      }),
      markTurn: vi.fn()
    };
    const postMessage = vi.fn(async () => undefined);

    await handleNotifyTurnEnded({
      payload: { session_id: "codex1", finalMessage: "new answer" },
      resolveSession: vi.fn(async () => session),
      store: store as never,
      discord: { postMessage }
    });

    expect(postMessage).toHaveBeenCalledWith("thread1", "new answer");
  });
});
