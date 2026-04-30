import { describe, expect, it, vi } from "vitest";
import { createAppServerCodexClient, defaultAppServerSocketPath } from "../src/appServer.js";
import type { ProcessRunner } from "../src/runner.js";

interface CapturedRequest {
  method: string;
  params: unknown;
}

describe("createAppServerCodexClient", () => {
  it("resumes a Desktop thread and starts a visible turn", async () => {
    const runner: ProcessRunner = vi.fn(async (_command, _args, options) => {
      expect(options.env.CODEX_HOME).toBe("/home/.codex");
      const requests = (options.stdin ?? "")
        .trim()
        .split("\n")
        .map((line: string) => JSON.parse(line) as CapturedRequest);

      expect(requests.map((request: CapturedRequest) => request.method)).toEqual(["initialize", "thread/resume", "turn/start"]);
      expect(requests[1].params).toMatchObject({ threadId: "thread1", cwd: "/work", persistExtendedHistory: true });
      expect(requests[2].params).toMatchObject({
        threadId: "thread1",
        input: [{ type: "text", text: "Continue", text_elements: [] }],
        cwd: "/work"
      });

      return {
        code: 0,
        stderr: "",
        stdout: [
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "codex", version: "1" } } }),
          JSON.stringify({ jsonrpc: "2.0", id: 2, result: { thread: { id: "thread1" } } }),
          JSON.stringify({ jsonrpc: "2.0", id: 3, result: { turn: { id: "turn1", status: "inProgress" } } }),
          JSON.stringify({
            jsonrpc: "2.0",
            method: "item/completed",
            params: { threadId: "thread1", turnId: "turn1", item: { type: "agentMessage", id: "item1", text: "continued" } }
          }),
          JSON.stringify({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "thread1", turn: { id: "turn1", status: "completed" } } })
        ].join("\n")
      };
    });

    const client = createAppServerCodexClient({
      codexBin: "/codex",
      codexHome: "/home/.codex",
      socketPath: "/tmp/codex.sock",
      cwd: "/bridge",
      runner
    });
    const result = await client.resumeInProject("/work", "thread1", "Continue");

    expect(result).toEqual({ sessionId: "thread1", finalMessage: "continued", rawEvents: expect.any(Array) });
    expect(runner).toHaveBeenCalledWith(
      "/codex",
      ["app-server", "proxy", "--sock", "/tmp/codex.sock"],
      expect.objectContaining({ cwd: "/work" })
    );
  });

  it("throws a clear error when Desktop control socket is unavailable", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      code: 1,
      stdout: "",
      stderr: "failed to connect to socket"
    }));
    const client = createAppServerCodexClient({
      codexBin: "/codex",
      codexHome: "/home/.codex",
      socketPath: "/missing.sock",
      cwd: "/bridge",
      runner
    });

    await expect(client.resumeInProject("/work", "thread1", "Continue")).rejects.toThrow(
      "Codex Desktop app-server proxy failed: failed to connect to socket"
    );
  });

  it("rejects app-server turns that complete without a final agent message", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      code: 0,
      stderr: "",
      stdout: [
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "codex", version: "1" } } }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, result: { thread: { id: "thread1" } } }),
        JSON.stringify({ jsonrpc: "2.0", id: 3, result: { turn: { id: "turn1", status: "inProgress" } } }),
        JSON.stringify({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "thread1", turn: { id: "turn1", status: "completed" } } })
      ].join("\n")
    }));
    const client = createAppServerCodexClient({
      codexBin: "/codex",
      codexHome: "/home/.codex",
      socketPath: "/tmp/codex.sock",
      cwd: "/bridge",
      runner
    });

    await expect(client.resumeInProject("/work", "thread1", "Continue")).rejects.toThrow(
      "Codex Desktop app-server returned no final agent message"
    );
  });
});

describe("defaultAppServerSocketPath", () => {
  it("uses the Codex home control socket path", () => {
    expect(defaultAppServerSocketPath("/home/.codex")).toBe("/home/.codex/app-server-control/app-server-control.sock");
  });
});
