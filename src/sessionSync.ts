import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { makeProjectThreadTitle } from "./format.js";
import type { BridgeSession } from "./types.js";
import type { createStore } from "./store.js";

export interface CodexSessionIndexEntry {
  id: string;
  threadName: string;
  updatedAt?: string;
}

export interface CodexSessionProject {
  path: string | null;
  name: string;
}

type Store = Pick<
  ReturnType<typeof createStore>,
  "findSessionByCodexSessionId" | "findUnmappedSessionByTitle" | "setCodexSessionId" | "createSession" | "recordEvent"
>;

interface DiscordThreadCreator {
  createThread(channelId: string, title: string): Promise<{ id: string; name: string }>;
}

interface SyncCodexSessionOptions {
  entry: CodexSessionIndexEntry;
  sessionPath: string | null;
  readProject?: (sessionPath: string | null) => CodexSessionProject;
  discordGuildId: string;
  discordChannelId: string;
  store: Store;
  discord: DiscordThreadCreator;
  claimPendingDiscordSession?: boolean;
}

interface CodexSessionIndexPollerOptions extends Omit<SyncCodexSessionOptions, "entry" | "sessionPath"> {
  indexPath: string;
  codexHome: string;
  findSessionPath?: (codexHome: string, codexSessionId: string) => string | null;
  intervalMs?: number;
}

export function codexSessionIndexPath(codexHome: string): string {
  return join(codexHome, "session_index.jsonl");
}

export function readCodexSessionIndex(indexPath: string): CodexSessionIndexEntry[] {
  if (!existsSync(indexPath)) {
    return [];
  }

  return readFileSync(indexPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const id = typeof parsed.id === "string" ? parsed.id : "";
        if (!id) return [];
        return [
          {
            id,
            threadName: typeof parsed.thread_name === "string" && parsed.thread_name.trim().length > 0 ? parsed.thread_name : "Codex session",
            updatedAt: typeof parsed.updated_at === "string" ? parsed.updated_at : undefined
          }
        ];
      } catch {
        return [];
      }
    });
}

export function findCodexSessionIndexEntry(indexPath: string, codexSessionId: string): CodexSessionIndexEntry | null {
  return readCodexSessionIndex(indexPath).find((entry) => entry.id === codexSessionId) ?? null;
}

export function findCodexSessionPath(codexHome: string, codexSessionId: string): string | null {
  const sessionsDir = join(codexHome, "sessions");
  if (!existsSync(sessionsDir)) {
    return null;
  }

  const stack = [sessionsDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    try {
      for (const entry of readdirSync(current)) {
        const path = join(current, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          stack.push(path);
        } else if (entry.includes(codexSessionId) && entry.endsWith(".jsonl")) {
          return path;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function readCodexSessionProject(sessionPath: string | null): CodexSessionProject {
  if (!sessionPath || !existsSync(sessionPath)) {
    return { path: null, name: "Codex" };
  }

  for (const line of readFileSync(sessionPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.type !== "session_meta" || !parsed.payload || typeof parsed.payload !== "object") continue;
      const cwd = (parsed.payload as Record<string, unknown>).cwd;
      if (typeof cwd === "string" && cwd.trim().length > 0) {
        return { path: cwd, name: basename(cwd) };
      }
    } catch {
      continue;
    }
  }

  return { path: null, name: "Codex" };
}

export async function syncCodexSessionToDiscord(options: SyncCodexSessionOptions): Promise<BridgeSession | null> {
  const existing = options.store.findSessionByCodexSessionId(options.entry.id);
  if (existing) {
    return existing;
  }

  const project = (options.readProject ?? readCodexSessionProject)(options.sessionPath);
  const title = makeProjectThreadTitle(project.name, options.entry.threadName);
  const pendingDiscordSession = options.store.findUnmappedSessionByTitle(title);
  if (pendingDiscordSession) {
    if (options.claimPendingDiscordSession) {
      options.store.setCodexSessionId(pendingDiscordSession.id, options.entry.id);
      options.store.recordEvent({
        sessionId: pendingDiscordSession.id,
        source: "codex",
        kind: "status_change",
        payload: { codexSessionId: options.entry.id, projectPath: project.path, reason: "claim-pending-discord-session" }
      });
      return pendingDiscordSession;
    }
    return null;
  }

  const thread = await options.discord.createThread(options.discordChannelId, title);
  const session = options.store.createSession({
    codexSessionId: options.entry.id,
    discordGuildId: options.discordGuildId,
    discordChannelId: options.discordChannelId,
    discordThreadId: thread.id,
    projectPath: project.path,
    title
  });
  options.store.recordEvent({
    sessionId: session.id,
    source: "codex",
    kind: "new",
    payload: { codexSessionId: options.entry.id, threadName: options.entry.threadName, projectPath: project.path, reason: "codex-session-sync" }
  });
  return session;
}

export function createCodexSessionIndexPoller(options: CodexSessionIndexPollerOptions) {
  const seen = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let runningScan: Promise<void> | null = null;

  async function scanNow() {
    if (runningScan) {
      return runningScan;
    }

    runningScan = (async () => {
      for (const entry of readCodexSessionIndex(options.indexPath)) {
        if (seen.has(entry.id)) {
          continue;
        }
        seen.add(entry.id);
        await syncCodexSessionToDiscord({
          entry,
          sessionPath: (options.findSessionPath ?? findCodexSessionPath)(options.codexHome, entry.id),
          readProject: options.readProject,
          discordGuildId: options.discordGuildId,
          discordChannelId: options.discordChannelId,
          store: options.store,
          discord: options.discord
        });
      }
    })().finally(() => {
      runningScan = null;
    });

    return runningScan;
  }

  return {
    start() {
      for (const entry of readCodexSessionIndex(options.indexPath)) {
        seen.add(entry.id);
      }
      timer = setInterval(() => {
        void scanNow().catch((error) => {
          options.store.recordEvent({
            sessionId: null,
            source: "system",
            kind: "error",
            payload: { message: error instanceof Error ? error.message : "Unknown Codex session sync error" }
          });
        });
      }, options.intervalMs ?? 5000);
      timer.unref();
    },
    scanNow,
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  };
}
