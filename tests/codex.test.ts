import { describe, expect, it, vi } from "vitest";
import { createCodexClient } from "../src/codex.js";
import type { ProcessRunner } from "../src/runner.js";

describe("createCodexClient", () => {
  it("runs a new session and captures the final message", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      code: 0,
      stdout: [
        JSON.stringify({ type: "session.started", session_id: "s1" }),
        JSON.stringify({ type: "agent_message", message: "done" })
      ].join("\n"),
      stderr: ""
    }));

    const client = createCodexClient({ codexBin: "/codex", codexHome: "/home/.codex", cwd: "/work", runner });
    const result = await client.start("hello");

    expect(result.sessionId).toBe("s1");
    expect(result.finalMessage).toBe("done");
    expect(runner).toHaveBeenCalledWith(
      "/codex",
      expect.arrayContaining(["exec", "--json"]),
      expect.objectContaining({ cwd: "/work" })
    );
  });

  it("can start a session in a specific project directory", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({ type: "agent_message", message: "done" }),
      stderr: ""
    }));

    const client = createCodexClient({ codexBin: "/codex", codexHome: "/home/.codex", cwd: "/bridge", runner });
    await client.startInProject("/Users/cxymds/Documents/KAI/rustfs", "hello");

    expect(runner).toHaveBeenCalledWith(
      "/codex",
      ["exec", "--json", "hello"],
      expect.objectContaining({ cwd: "/Users/cxymds/Documents/KAI/rustfs" })
    );
  });

  it("uses exec resume for follow-up turns", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({ type: "message", content: "continued" }),
      stderr: ""
    }));

    const client = createCodexClient({ codexBin: "/codex", codexHome: "/home/.codex", cwd: "/work", runner });
    const result = await client.resume("s1", "continue");

    expect(result.finalMessage).toBe("continued");
    expect(runner).toHaveBeenCalledWith("/codex", ["exec", "resume", "--json", "s1", "continue"], expect.anything());
  });

  it("can resume a session in its project directory", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({ type: "message", content: "continued" }),
      stderr: ""
    }));

    const client = createCodexClient({ codexBin: "/codex", codexHome: "/home/.codex", cwd: "/bridge", runner });
    await client.resumeInProject("/Users/cxymds/Documents/KAI/rustfs", "s1", "continue");

    expect(runner).toHaveBeenCalledWith(
      "/codex",
      ["exec", "resume", "--json", "s1", "continue"],
      expect.objectContaining({ cwd: "/Users/cxymds/Documents/KAI/rustfs" })
    );
  });

  it("ignores generic item ids when finding the session id", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      code: 0,
      stdout: [
        JSON.stringify({
          type: "item.completed",
          id: "item_123",
          item: { type: "agent_message", text: "done" }
        }),
        JSON.stringify({ type: "thread.started", thread_id: "thread_abc" })
      ].join("\n"),
      stderr: ""
    }));

    const client = createCodexClient({ codexBin: "/codex", codexHome: "/home/.codex", cwd: "/work", runner });
    const result = await client.start("hello");

    expect(result.sessionId).toBe("thread_abc");
    expect(result.sessionId).not.toBe("item_123");
  });

  it("parses the observed Codex JSONL thread and item fields", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      code: 0,
      stdout: [
        JSON.stringify({ type: "thread.started", thread_id: "019dd8d1-322d-7833-9617-42d6c0b1f6ca" }),
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "item.completed",
          item: { id: "item_0", type: "agent_message", text: "codex-discord-bridge-check" }
        }),
        JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } })
      ].join("\n"),
      stderr: ""
    }));

    const client = createCodexClient({ codexBin: "/codex", codexHome: "/home/.codex", cwd: "/work", runner });
    const result = await client.start("hello");

    expect(result.sessionId).toBe("019dd8d1-322d-7833-9617-42d6c0b1f6ca");
    expect(result.finalMessage).toBe("codex-discord-bridge-check");
  });

  it("throws when Codex exits non-zero", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({ code: 1, stdout: "", stderr: "bad" }));
    const client = createCodexClient({ codexBin: "/codex", codexHome: "/home/.codex", cwd: "/work", runner });

    await expect(client.start("hello")).rejects.toThrow("Codex exited with code 1: bad");
  });
});
