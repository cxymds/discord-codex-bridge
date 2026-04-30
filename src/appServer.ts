import { join } from "node:path";
import type { ProcessRunner } from "./runner.js";
import { defaultRunner } from "./runner.js";
import type { CodexRunResult } from "./types.js";

interface AppServerCodexClientOptions {
  codexBin: string;
  codexHome: string;
  socketPath: string;
  cwd: string;
  runner?: ProcessRunner;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string } | unknown;
}

export function defaultAppServerSocketPath(codexHome: string): string {
  return join(codexHome, "app-server-control", "app-server-control.sock");
}

function parseJsonRpcLines(stdout: string): JsonRpcMessage[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonRpcMessage);
}

function request(id: number, method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

function textInput(text: string) {
  return { type: "text", text, text_elements: [] };
}

function extractFinalAgentMessage(messages: JsonRpcMessage[]): string {
  for (const message of [...messages].reverse()) {
    if (message.method !== "item/completed" || !message.params || typeof message.params !== "object") continue;
    const item = (message.params as { item?: unknown }).item;
    if (!item || typeof item !== "object") continue;
    const record = item as { type?: unknown; text?: unknown };
    if (record.type === "agentMessage" && typeof record.text === "string" && record.text.trim().length > 0) {
      return record.text;
    }
  }
  return "";
}

function assertNoJsonRpcErrors(messages: JsonRpcMessage[]): void {
  const errorMessage = messages.find((message) => message.error)?.error;
  if (!errorMessage) return;
  if (typeof errorMessage === "object" && "message" in errorMessage && typeof errorMessage.message === "string") {
    throw new Error(`Codex Desktop app-server error: ${errorMessage.message}`);
  }
  throw new Error(`Codex Desktop app-server error: ${JSON.stringify(errorMessage)}`);
}

export function createAppServerCodexClient(options: AppServerCodexClientOptions) {
  const runner = options.runner ?? defaultRunner;
  const baseEnv = { ...process.env, CODEX_HOME: options.codexHome };

  async function runDesktopTurn(projectPath: string, sessionId: string, prompt: string): Promise<CodexRunResult> {
    const stdin = [
      request(1, "initialize", {
        clientInfo: { name: "discord-codex-bridge", title: "Discord Codex Bridge", version: "0.1.0" },
        capabilities: { experimentalApi: true }
      }),
      request(2, "thread/resume", {
        threadId: sessionId,
        cwd: projectPath,
        excludeTurns: true,
        persistExtendedHistory: true
      }),
      request(3, "turn/start", {
        threadId: sessionId,
        input: [textInput(prompt)],
        cwd: projectPath
      })
    ].join("\n") + "\n";

    const result = await runner(options.codexBin, ["app-server", "proxy", "--sock", options.socketPath], {
      cwd: projectPath,
      env: baseEnv,
      stdin
    });

    if (result.code !== 0) {
      throw new Error(`Codex Desktop app-server proxy failed: ${result.stderr || result.stdout}`);
    }

    const rawEvents = parseJsonRpcLines(result.stdout);
    assertNoJsonRpcErrors(rawEvents);
    const finalMessage = extractFinalAgentMessage(rawEvents);
    if (finalMessage.length === 0) {
      throw new Error("Codex Desktop app-server returned no final agent message");
    }
    return {
      sessionId,
      finalMessage,
      rawEvents
    };
  }

  return {
    resumeInProject(projectPath: string, sessionId: string, prompt: string): Promise<CodexRunResult> {
      return runDesktopTurn(projectPath, sessionId, prompt);
    },

    resume(sessionId: string, prompt: string): Promise<CodexRunResult> {
      return runDesktopTurn(options.cwd, sessionId, prompt);
    }
  };
}
