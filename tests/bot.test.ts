import { describe, expect, it, vi } from "vitest";
import { createBridgeHandlers } from "../src/bot.js";

describe("createBridgeHandlers", () => {
  it("creates a session and posts the first Codex result", async () => {
    const createThread = vi.fn(async () => ({ id: "thread1", name: "Hello" }));
    const postMessage = vi.fn(async () => undefined);
    const store = {
      createSession: vi.fn((input) => ({ id: "bridge1", ...input, status: "active", createdAt: "", updatedAt: "", lastTurnAt: null, closedAt: null })),
      setCodexSessionId: vi.fn(),
      updateSessionStatus: vi.fn(),
      markTurn: vi.fn(),
      recordEvent: vi.fn()
    };
    const codex = { start: vi.fn(async () => ({ sessionId: "codex1", finalMessage: "done", rawEvents: [] })) };
    const handlers = createBridgeHandlers({
      config: { discordGuildId: "guild", discordChannelId: "channel", allowedUserIds: ["u1"], allowedRoleIds: [] },
      store: store as never,
      codex: codex as never,
      queue: { enqueue: vi.fn((_id, work) => work()), pendingCount: vi.fn(() => 0) } as never,
      discord: { createThread, postMessage }
    });

    await handlers.handleNewCommand({ userId: "u1", roleIds: [], prompt: "Hello" });

    expect(createThread).toHaveBeenCalledWith("channel", "Hello");
    expect(codex.start).toHaveBeenCalledWith("Hello");
    expect(postMessage).toHaveBeenCalledWith("thread1", "done");
  });

  it("denies unauthorized users", async () => {
    const handlers = createBridgeHandlers({
      config: { discordGuildId: "guild", discordChannelId: "channel", allowedUserIds: ["u1"], allowedRoleIds: [] },
      store: {} as never,
      codex: {} as never,
      queue: {} as never,
      discord: { createThread: vi.fn(), postMessage: vi.fn() }
    });

    await expect(handlers.handleNewCommand({ userId: "u2", roleIds: [], prompt: "Hello" })).rejects.toThrow("Not authorized");
  });

  it("reports status for a mapped thread", async () => {
    const store = {
      findSessionByThreadId: vi.fn(() => ({
        id: "bridge1",
        codexSessionId: "codex1",
        discordGuildId: "guild",
        discordChannelId: "channel",
        discordThreadId: "thread1",
        title: "Hello",
        status: "active",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:01:00.000Z",
        lastTurnAt: "2026-04-29T00:01:00.000Z",
        closedAt: null
      }))
    };
    const handlers = createBridgeHandlers({
      config: { discordGuildId: "guild", discordChannelId: "channel", allowedUserIds: ["u1"], allowedRoleIds: [] },
      store: store as never,
      codex: {} as never,
      queue: { pendingCount: vi.fn(() => 2) } as never,
      discord: { createThread: vi.fn(), postMessage: vi.fn() }
    });

    await expect(handlers.handleStatusCommand({ userId: "u1", roleIds: [], threadId: "thread1" })).resolves.toContain("codex1");
  });
});
