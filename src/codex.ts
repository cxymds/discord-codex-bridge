import type { CodexRunResult } from "./types.js";
import { defaultRunner, type ProcessRunner } from "./runner.js";

interface CodexClientOptions {
  codexBin: string;
  codexHome: string;
  cwd: string;
  runner?: ProcessRunner;
}

function parseJsonLines(stdout: string): unknown[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { type: "raw", text: line };
      }
    });
}

function extractText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["message", "content", "text", "final_message", "output"]) {
    const found = record[key];
    if (typeof found === "string" && found.trim().length > 0) {
      return found;
    }
  }
  const itemText = extractText(record.item);
  if (itemText) {
    return itemText;
  }
  return null;
}

function extractSessionId(events: unknown[]): string | null {
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    for (const key of ["session_id", "sessionId", "thread_id", "threadId", "conversation_id", "conversationId"]) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
    if (record.type === "thread.started" || record.type === "session.started") {
      const value = record.id;
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }
  return null;
}

function extractFinalMessage(events: unknown[], stdout: string): string {
  for (const event of [...events].reverse()) {
    const text = extractText(event);
    if (text) {
      return text;
    }
  }
  return stdout.trim();
}

export function createCodexClient(options: CodexClientOptions) {
  const runner = options.runner ?? defaultRunner;
  const baseEnv = { ...process.env, CODEX_HOME: options.codexHome };

  async function run(args: string[], cwd = options.cwd): Promise<CodexRunResult> {
    const result = await runner(options.codexBin, args, { cwd, env: baseEnv });
    if (result.code !== 0) {
      throw new Error(`Codex exited with code ${result.code}: ${result.stderr || result.stdout}`);
    }

    const rawEvents = parseJsonLines(result.stdout);
    return {
      sessionId: extractSessionId(rawEvents),
      finalMessage: extractFinalMessage(rawEvents, result.stdout),
      rawEvents
    };
  }

  return {
    start(prompt: string): Promise<CodexRunResult> {
      return run(["exec", "--json", prompt]);
    },

    startInProject(projectPath: string, prompt: string): Promise<CodexRunResult> {
      return run(["exec", "--json", prompt], projectPath);
    },

    resume(sessionId: string, prompt: string): Promise<CodexRunResult> {
      return run(["exec", "resume", "--json", sessionId, prompt]);
    },

    summarize(sessionId: string): Promise<CodexRunResult> {
      return run([
        "exec",
        "resume",
        "--json",
        sessionId,
        "请用中文简洁总结这个 Codex 会话的最终结果、关键改动、验证情况和后续建议。"
      ]);
    }
  };
}
