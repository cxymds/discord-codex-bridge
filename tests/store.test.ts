import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "../src/store.js";

const stores: Array<{ close(): void }> = [];

function testStore() {
  const store = createStore(":memory:");
  stores.push(store);
  return store;
}

afterEach(() => {
  while (stores.length) {
    stores.pop()?.close();
  }
});

describe("store", () => {
  it("creates and finds sessions by thread and Codex id", () => {
    const store = testStore();
    const session = store.createSession({
      codexSessionId: "codex-1",
      discordGuildId: "guild",
      discordChannelId: "channel",
      discordThreadId: "thread",
      title: "Test session"
    });

    expect(store.findSessionByThreadId("thread")?.id).toBe(session.id);
    expect(store.findSessionByCodexSessionId("codex-1")?.id).toBe(session.id);
  });

  it("finds pending Discord-created sessions by title", () => {
    const store = testStore();
    const session = store.createSession({
      codexSessionId: null,
      discordGuildId: "guild",
      discordChannelId: "channel",
      discordThreadId: "thread",
      title: "[discord-codex-bridge] Pending"
    });

    expect(store.findUnmappedSessionByTitle("[discord-codex-bridge] Pending")?.id).toBe(session.id);

    store.setCodexSessionId(session.id, "codex-1");
    expect(store.findUnmappedSessionByTitle("[discord-codex-bridge] Pending")).toBeNull();
  });


  it("updates status and records close time", () => {
    const store = testStore();
    const session = store.createSession({
      codexSessionId: null,
      discordGuildId: "guild",
      discordChannelId: "channel",
      discordThreadId: "thread",
      title: "Test session"
    });

    store.updateSessionStatus(session.id, "closed");
    const updated = store.findSessionById(session.id);

    expect(updated?.status).toBe("closed");
    expect(updated?.closedAt).toMatch(/T/);
  });

  it("records events", () => {
    const store = testStore();
    const event = store.recordEvent({
      sessionId: null,
      source: "system",
      kind: "error",
      payload: { message: "unknown session" }
    });

    expect(event.id).toBeGreaterThan(0);
    expect(event.payload).toEqual({ message: "unknown session" });
  });
});
