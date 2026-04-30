import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCodexTranscriptPoller, readCodexFinalMessages, syncCodexTranscriptSession } from "../src/transcriptSync.js";

describe("readCodexFinalMessages", () => {
  it("extracts only final assistant messages from session jsonl", () => {
    const dir = join(tmpdir(), `discord-codex-bridge-transcript-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const sessionPath = join(dir, "rollout.jsonl");
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "session_meta", payload: { id: "codex1", cwd: "/work" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "from Codex UI" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "progress" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "final answer", phase: "final_answer" } })
      ].join("\n")
    );

    expect(readCodexFinalMessages(sessionPath)).toEqual([{ key: "4", content: "final answer" }]);
  });
});

describe("syncCodexTranscriptSession", () => {
  it("posts new final Codex messages to the mapped Discord thread", async () => {
    const dir = join(tmpdir(), `discord-codex-bridge-transcript-sync-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const sessionPath = join(dir, "rollout.jsonl");
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "desktop question" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "progress" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "desktop answer", phase: "final_answer" } })
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

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith("thread1", "desktop answer");
    expect(store.recordEvent).toHaveBeenCalledWith({
      sessionId: "bridge1",
      source: "codex",
      kind: "message",
      payload: { transcriptKey: "3", content: "desktop answer" }
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
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "already posted", phase: "final_answer" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "new assistant message", phase: "final_answer" } })
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
    writeFileSync(sessionPath, JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "old answer", phase: "final_answer" } }));
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
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "old answer", phase: "final_answer" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "new answer", phase: "final_answer" } })
      ].join("\n")
    );
    await poller.scanNow();
    poller.stop();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith("thread1", "new answer");
  });
});
