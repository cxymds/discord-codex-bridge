import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCodexTranscriptPoller, readCodexTranscriptMessages, syncCodexTranscriptSession } from "../src/transcriptSync.js";

describe("readCodexTranscriptMessages", () => {
  it("extracts Codex user and assistant messages from session jsonl", () => {
    const dir = join(tmpdir(), `discord-codex-bridge-transcript-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const sessionPath = join(dir, "rollout.jsonl");
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "session_meta", payload: { id: "codex1", cwd: "/work" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "from Codex UI" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "from assistant", phase: "final_answer" } })
      ].join("\n")
    );

    expect(readCodexTranscriptMessages(sessionPath)).toEqual([
      { key: "2", role: "user", content: "from Codex UI" },
      { key: "3", role: "assistant", content: "from assistant" }
    ]);
  });
});

describe("syncCodexTranscriptSession", () => {
  it("posts new Codex transcript messages to the mapped Discord thread", async () => {
    const dir = join(tmpdir(), `discord-codex-bridge-transcript-sync-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const sessionPath = join(dir, "rollout.jsonl");
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "desktop question" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "desktop answer" } })
      ].join("\n")
    );
    const store = {
      listEventsBySessionId: vi.fn(() => []),
      recordEvent: vi.fn()
    };
    const postMessage = vi.fn(async () => undefined);

    await syncCodexTranscriptSession({
      session: {
        id: "bridge1",
        codexSessionId: "codex1",
        discordThreadId: "thread1"
      },
      sessionPath,
      store: store as never,
      discord: { postMessage }
    });

    expect(postMessage).toHaveBeenNthCalledWith(1, "thread1", "Codex user: desktop question");
    expect(postMessage).toHaveBeenNthCalledWith(2, "thread1", "desktop answer");
    expect(store.recordEvent).toHaveBeenCalledWith({
      sessionId: "bridge1",
      source: "codex",
      kind: "message",
      payload: { transcriptKey: "1", role: "user", content: "desktop question" }
    });
  });

  it("skips Discord-originated prompts and already posted Codex results", async () => {
    const dir = join(tmpdir(), `discord-codex-bridge-transcript-skip-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const sessionPath = join(dir, "rollout.jsonl");
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "from Discord" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "already posted" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "new assistant message" } })
      ].join("\n")
    );
    const store = {
      listEventsBySessionId: vi.fn(() => [
        { source: "discord", kind: "message", payload: { content: "from Discord" } },
        { source: "codex", kind: "turn_result", payload: { finalMessage: "already posted" } }
      ]),
      recordEvent: vi.fn()
    };
    const postMessage = vi.fn(async () => undefined);

    await syncCodexTranscriptSession({
      session: {
        id: "bridge1",
        codexSessionId: "codex1",
        discordThreadId: "thread1"
      },
      sessionPath,
      store: store as never,
      discord: { postMessage }
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith("thread1", "new assistant message");
  });
});

describe("createCodexTranscriptPoller", () => {
  it("baselines existing transcript messages and posts only later additions", async () => {
    const dir = join(tmpdir(), `discord-codex-bridge-transcript-poller-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const sessionPath = join(dir, "rollout.jsonl");
    writeFileSync(sessionPath, JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "old answer" } }));
    const events: Array<{ source: "codex"; kind: "message"; payload: unknown }> = [];
    const store = {
      listMappedSessions: vi.fn(() => [{ id: "bridge1", codexSessionId: "codex1", discordThreadId: "thread1" }]),
      listEventsBySessionId: vi.fn(() => events),
      recordEvent: vi.fn((event) => {
        events.push(event);
      })
    };
    const postMessage = vi.fn(async () => undefined);
    const poller = createCodexTranscriptPoller({
      codexHome: dir,
      store: store as never,
      discord: { postMessage },
      findSessionPath: () => sessionPath
    });

    poller.start();
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "old answer" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "new answer" } })
      ].join("\n")
    );
    await poller.scanNow();
    poller.stop();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith("thread1", "new answer");
  });
});
