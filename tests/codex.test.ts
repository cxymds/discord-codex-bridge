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

  it("uses exec resume for follow-up turns", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({ type: "message", content: "continued" }),
      stderr: ""
    }));

    const client = createCodexClient({ codexBin: "/codex", codexHome: "/home/.codex", cwd: "/work", runner });
    const result = await client.resume("s1", "continue");

    expect(result.finalMessage).toBe("continued");
    expect(runner).toHaveBeenCalledWith("/codex", expect.arrayContaining(["exec", "resume", "--json", "s1"]), expect.anything());
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
