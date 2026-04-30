import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCodexSessionIndexPoller, readCodexSessionIndex, syncCodexSessionToDiscord } from "../src/sessionSync.js";

describe("readCodexSessionIndex", () => {
  it("parses Codex session_index jsonl entries", () => {
    const dir = join(tmpdir(), `discord-codex-bridge-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const indexPath = join(dir, "session_index.jsonl");
    writeFileSync(
      indexPath,
      [
        JSON.stringify({ id: "codex1", thread_name: "Build bridge", updated_at: "2026-04-30T01:00:00.000Z" }),
        "not-json",
        JSON.stringify({ id: "", thread_name: "Missing id" })
      ].join("\n")
    );

    expect(readCodexSessionIndex(indexPath)).toEqual([
      { id: "codex1", threadName: "Build bridge", updatedAt: "2026-04-30T01:00:00.000Z" }
    ]);
  });
});

describe("syncCodexSessionToDiscord", () => {
  it("creates a Discord thread and store mapping for an unmapped Codex session", async () => {
    const createThread = vi.fn(async () => ({ id: "thread1", name: "[discord-codex-bridge] Build bridge" }));
    const store = {
      findSessionByCodexSessionId: vi.fn(() => null),
      findUnmappedSessionByTitle: vi.fn(() => null),
      createSession: vi.fn((input) => ({ id: "bridge1", ...input })),
      recordEvent: vi.fn()
    };

    const session = await syncCodexSessionToDiscord({
      entry: { id: "codex1", threadName: "Build bridge" },
      projectName: "discord-codex-bridge",
      discordGuildId: "guild",
      discordChannelId: "channel",
      store: store as never,
      discord: { createThread }
    });

    expect(createThread).toHaveBeenCalledWith("channel", "[discord-codex-bridge] Build bridge");
    expect(store.createSession).toHaveBeenCalledWith({
      codexSessionId: "codex1",
      discordGuildId: "guild",
      discordChannelId: "channel",
      discordThreadId: "thread1",
      title: "[discord-codex-bridge] Build bridge"
    });
    expect(store.recordEvent).toHaveBeenCalledWith({
      sessionId: "bridge1",
      source: "codex",
      kind: "new",
      payload: { codexSessionId: "codex1", threadName: "Build bridge", reason: "codex-session-sync" }
    });
    expect(session?.id).toBe("bridge1");
  });

  it("does not create a duplicate thread while a Discord-created session is waiting for its Codex id", async () => {
    const createThread = vi.fn();
    const store = {
      findSessionByCodexSessionId: vi.fn(() => null),
      findUnmappedSessionByTitle: vi.fn(() => ({ id: "bridge1", codexSessionId: null, title: "[discord-codex-bridge] Build bridge" })),
      createSession: vi.fn(),
      recordEvent: vi.fn()
    };

    await expect(
      syncCodexSessionToDiscord({
        entry: { id: "codex1", threadName: "Build bridge" },
        projectName: "discord-codex-bridge",
        discordGuildId: "guild",
        discordChannelId: "channel",
        store: store as never,
        discord: { createThread }
      })
    ).resolves.toBeNull();

    expect(store.findUnmappedSessionByTitle).toHaveBeenCalledWith("[discord-codex-bridge] Build bridge");
    expect(createThread).not.toHaveBeenCalled();
    expect(store.createSession).not.toHaveBeenCalled();
  });

  it("links a pending Discord-created session when the caller allows claiming it", async () => {
    const pending = { id: "bridge1", codexSessionId: null, title: "[discord-codex-bridge] Build bridge" };
    const store = {
      findSessionByCodexSessionId: vi.fn(() => null),
      findUnmappedSessionByTitle: vi.fn(() => pending),
      setCodexSessionId: vi.fn(),
      createSession: vi.fn(),
      recordEvent: vi.fn()
    };

    await expect(
      syncCodexSessionToDiscord({
        entry: { id: "codex1", threadName: "Build bridge" },
        projectName: "discord-codex-bridge",
        discordGuildId: "guild",
        discordChannelId: "channel",
        store: store as never,
        discord: { createThread: vi.fn() },
        claimPendingDiscordSession: true
      })
    ).resolves.toBe(pending);

    expect(store.setCodexSessionId).toHaveBeenCalledWith("bridge1", "codex1");
    expect(store.recordEvent).toHaveBeenCalledWith({
      sessionId: "bridge1",
      source: "codex",
      kind: "status_change",
      payload: { codexSessionId: "codex1", reason: "claim-pending-discord-session" }
    });
  });

  it("returns an existing mapping without creating another Discord thread", async () => {
    const existing = { id: "bridge1", codexSessionId: "codex1" };
    const createThread = vi.fn();
    const store = {
      findSessionByCodexSessionId: vi.fn(() => existing),
      findUnmappedSessionByTitle: vi.fn(() => null),
      createSession: vi.fn(),
      recordEvent: vi.fn()
    };

    await expect(
      syncCodexSessionToDiscord({
        entry: { id: "codex1", threadName: "Build bridge" },
        projectName: "discord-codex-bridge",
        discordGuildId: "guild",
        discordChannelId: "channel",
        store: store as never,
        discord: { createThread }
      })
    ).resolves.toBe(existing);

    expect(createThread).not.toHaveBeenCalled();
    expect(store.createSession).not.toHaveBeenCalled();
  });
});

describe("createCodexSessionIndexPoller", () => {
  it("baselines existing Codex sessions and syncs only later entries", async () => {
    const dir = join(tmpdir(), `discord-codex-bridge-poller-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const indexPath = join(dir, "session_index.jsonl");
    writeFileSync(indexPath, JSON.stringify({ id: "old-codex", thread_name: "Old session" }));

    const createThread = vi.fn(async () => ({ id: "thread1", name: "[discord-codex-bridge] New session" }));
    const store = {
      findSessionByCodexSessionId: vi.fn(() => null),
      findUnmappedSessionByTitle: vi.fn(() => null),
      createSession: vi.fn((input) => ({ id: "bridge1", ...input })),
      recordEvent: vi.fn()
    };
    const poller = createCodexSessionIndexPoller({
      indexPath,
      projectName: "discord-codex-bridge",
      discordGuildId: "guild",
      discordChannelId: "channel",
      store: store as never,
      discord: { createThread }
    });

    poller.start();
    writeFileSync(
      indexPath,
      [
        JSON.stringify({ id: "old-codex", thread_name: "Old session" }),
        JSON.stringify({ id: "new-codex", thread_name: "New session" })
      ].join("\n")
    );
    await poller.scanNow();
    poller.stop();

    expect(createThread).toHaveBeenCalledTimes(1);
    expect(createThread).toHaveBeenCalledWith("channel", "[discord-codex-bridge] New session");
    expect(store.createSession).toHaveBeenCalledWith(expect.objectContaining({ codexSessionId: "new-codex" }));
  });
});
