import type { CodexRunResult } from "./types.js";

export type TurnDeliveryMode = "cli" | "desktop" | "auto";

export interface TurnDeliveryClient {
  resume(sessionId: string, prompt: string): Promise<CodexRunResult>;
  resumeInProject(projectPath: string, sessionId: string, prompt: string): Promise<CodexRunResult>;
}

interface TurnDeliveryOptions {
  mode: TurnDeliveryMode;
  cli: TurnDeliveryClient;
  desktop: TurnDeliveryClient;
  onDesktopFailure?: (error: unknown) => Promise<void> | void;
}

export function createTurnDeliveryClient(options: TurnDeliveryOptions): TurnDeliveryClient {
  async function withAutoFallback(work: () => Promise<CodexRunResult>, fallback: () => Promise<CodexRunResult>): Promise<CodexRunResult> {
    if (options.mode === "cli") return fallback();
    if (options.mode === "desktop") return work();
    try {
      return await work();
    } catch (error) {
      await options.onDesktopFailure?.(error);
      return fallback();
    }
  }

  return {
    resume(sessionId: string, prompt: string): Promise<CodexRunResult> {
      return withAutoFallback(() => options.desktop.resume(sessionId, prompt), () => options.cli.resume(sessionId, prompt));
    },

    resumeInProject(projectPath: string, sessionId: string, prompt: string): Promise<CodexRunResult> {
      return withAutoFallback(
        () => options.desktop.resumeInProject(projectPath, sessionId, prompt),
        () => options.cli.resumeInProject(projectPath, sessionId, prompt)
      );
    }
  };
}
