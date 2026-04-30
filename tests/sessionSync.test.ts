import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createCodexSessionIndexPoller,
  findCodexSessionPath,
  readCodexSessionIndex,
  readCodexSessionProject,
  syncCodexSessionToDiscord
} from "../src/sessionSync.js";

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

describe("findCodexSessionPath", () => {
  it("finds the rollout file for a Codex session id", () => {
    const codexHome = join(tmpdir(), `discord-codex-bridge-home-${Date.now()}`);
    const sessionDir = join(codexHome, "sessions", "2026", "04", "30");
    mkdirSync(sessionDir, { recursive: true });
    const sessionPath = join(sessionDir, "rollout-2026-04-30T09-06-50-codex1.jsonl");
    writeFileSync(sessionPath, "");

    expect(findCodexSessionPath(codexHome, "codex1")).toBe(sessionPath);
  });
});

describe("readCodexSessionProject", () => {
  it("reads the project path and name from Codex session metadata", () => {
    const dir = join(tmpdir(), `discord-codex-bridge-session-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const sessionPath = join(dir, "rollout.jsonl");
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({
          type: "session_meta",
          payload: { id: "codex1", cwd: "/Users/cxymds/Documents/KAI/rustfs" }
        }),
        JSON.stringify({ type: "event_msg", payload: { type: "thread_name_updated", thread_name: "Build bridge" } })
      ].join("\n")
    );

    expect(readCodexSessionProject(sessionPath)).toEqual({
      path: "/Users/cxymds/Documents/KAI/rustfs",
      name: "rustfs"
    });
  });
});

describe("syncCodexSessionToDiscord", () => {
  it("creates a Discord thread and store mapping for an unmapped Codex session", async () => {
    const createThread = vi.fn(async () => ({ id: "thread1", name: "[rustfs] Build bridge" }));
    const store = {
      findSessionByCodexSessionId: vi.fn(() => null),
      findUnmappedSessionByTitle: vi.fn(() => null),
      createSession: vi.fn((input) => ({ id: "bridge1", ...input })),
      recordEvent: vi.fn()
    };

    const session = await syncCodexSessionToDiscord({
      entry: { id: "codex1", threadName: "Build bridge" },
      sessionPath: "/tmp/rollout.jsonl",
      readProject: () => ({ path: "/Users/cxymds/Documents/KAI/rustfs", name: "rustfs" }),
      discordGuildId: "guild",
      discordChannelId: "channel",
      store: store as never,
      discord: { createThread }
    });

    expect(createThread).toHaveBeenCalledWith("channel", "[rustfs] Build bridge");
    expect(store.createSession).toHaveBeenCalledWith({
      codexSessionId: "codex1",
      discordGuildId: "guild",
      discordChannelId: "channel",
      discordThreadId: "thread1",
      projectPath: "/Users/cxymds/Documents/KAI/rustfs",
      title: "[rustfs] Build bridge"
    });
    expect(store.recordEvent).toHaveBeenCalledWith({
      sessionId: "bridge1",
      source: "codex",
      kind: "new",
      payload: {
        codexSessionId: "codex1",
        threadName: "Build bridge",
        projectPath: "/Users/cxymds/Documents/KAI/rustfs",
        reason: "codex-session-sync"
      }
    });
    expect(session?.id).toBe("bridge1");
  });

  it("does not create a duplicate thread while a Discord-created session is waiting for its Codex id", async () => {
    const createThread = vi.fn();
    const store = {
      findSessionByCodexSessionId: vi.fn(() => null),
      findUnmappedSessionByTitle: vi.fn(() => ({ id: "bridge1", codexSessionId: null, title: "[rustfs] Build bridge" })),
      createSession: vi.fn(),
      recordEvent: vi.fn()
    };

    await expect(
      syncCodexSessionToDiscord({
        entry: { id: "codex1", threadName: "Build bridge" },
        sessionPath: "/tmp/rollout.jsonl",
        readProject: () => ({ path: "/Users/cxymds/Documents/KAI/rustfs", name: "rustfs" }),
        discordGuildId: "guild",
        discordChannelId: "channel",
        store: store as never,
        discord: { createThread }
      })
    ).resolves.toBeNull();

    expect(store.findUnmappedSessionByTitle).toHaveBeenCalledWith("[rustfs] Build bridge");
    expect(createThread).not.toHaveBeenCalled();
    expect(store.createSession).not.toHaveBeenCalled();
  });

  it("links a pending Discord-created session when the caller allows claiming it", async () => {
    const pending = { id: "bridge1", codexSessionId: null, title: "[rustfs] Build bridge" };
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
        sessionPath: "/tmp/rollout.jsonl",
        readProject: () => ({ path: "/Users/cxymds/Documents/KAI/rustfs", name: "rustfs" }),
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
      payload: {
        codexSessionId: "codex1",
        projectPath: "/Users/cxymds/Documents/KAI/rustfs",
        reason: "claim-pending-discord-session"
      }
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
        sessionPath: "/tmp/rollout.jsonl",
        readProject: () => ({ path: "/Users/cxymds/Documents/KAI/rustfs", name: "rustfs" }),
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

    const createThread = vi.fn(async () => ({ id: "thread1", name: "[console] New session" }));
    const store = {
      findSessionByCodexSessionId: vi.fn(() => null),
      findUnmappedSessionByTitle: vi.fn(() => null),
      createSession: vi.fn((input) => ({ id: "bridge1", ...input })),
      recordEvent: vi.fn()
    };
    const poller = createCodexSessionIndexPoller({
      indexPath,
      codexHome: dir,
      findSessionPath: () => join(dir, "rollout-new-codex.jsonl"),
      readProject: () => ({ path: "/Users/cxymds/Documents/KAI/console", name: "console" }),
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
    expect(createThread).toHaveBeenCalledWith("channel", "[console] New session");
    expect(store.createSession).toHaveBeenCalledWith(expect.objectContaining({ codexSessionId: "new-codex" }));
  });
});
