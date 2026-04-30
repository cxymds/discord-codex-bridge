import { existsSync, readFileSync } from "node:fs";
import { chunkDiscordMessage } from "./format.js";
import { findCodexSessionPath } from "./sessionSync.js";
import type { BridgeEvent, BridgeSession } from "./types.js";
import type { createStore } from "./store.js";

export interface TranscriptMessage {
  key: string;
  role: "user" | "assistant";
  content: string;
}

type Store = Pick<ReturnType<typeof createStore>, "listMappedSessions" | "listEventsBySessionId" | "recordEvent">;

interface DiscordPoster {
  postMessage(threadId: string, content: string): Promise<void>;
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function textPayload(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return null;
}

export function readCodexTranscriptMessages(sessionPath: string | null): TranscriptMessage[] {
  if (!sessionPath || !existsSync(sessionPath)) {
    return [];
  }

  return readFileSync(sessionPath, "utf8")
    .split(/\r?\n/)
    .flatMap((line, index): TranscriptMessage[] => {
      const event = parseJsonObject(line.trim());
      if (!event || event.type !== "event_msg" || !event.payload || typeof event.payload !== "object") {
        return [];
      }

      const payload = event.payload as Record<string, unknown>;
      if (payload.type === "user_message") {
        const content = textPayload(payload.message);
        return content ? [{ key: String(index + 1), role: "user", content }] : [];
      }
      if (payload.type === "agent_message") {
        const content = textPayload(payload.message);
        return content ? [{ key: String(index + 1), role: "assistant", content }] : [];
      }
      return [];
    });
}

function eventPayload(event: Pick<BridgeEvent, "payload">): Record<string, unknown> {
  return event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? (event.payload as Record<string, unknown>) : {};
}

function skippedContents(events: Array<Pick<BridgeEvent, "source" | "kind" | "payload">>): Set<string> {
  const skipped = new Set<string>();
  for (const event of events) {
    const payload = eventPayload(event);
    if (event.source === "discord" && (event.kind === "new" || event.kind === "message")) {
      const content = textPayload(payload.prompt) ?? textPayload(payload.content);
      if (content) skipped.add(content);
    }
    if (event.source === "codex" && (event.kind === "turn_result" || event.kind === "summary")) {
      const content = textPayload(payload.finalMessage);
      if (content) skipped.add(content);
    }
  }
  return skipped;
}

function postedTranscriptKeys(events: Array<Pick<BridgeEvent, "payload">>): Set<string> {
  const posted = new Set<string>();
  for (const event of events) {
    const key = textPayload(eventPayload(event).transcriptKey);
    if (key) posted.add(key);
  }
  return posted;
}

export async function syncCodexTranscriptSession(options: {
  session: Pick<BridgeSession, "id" | "codexSessionId" | "discordThreadId">;
  sessionPath: string | null;
  store: Pick<Store, "listEventsBySessionId" | "recordEvent">;
  discord: DiscordPoster;
}) {
  if (!options.session.codexSessionId) {
    return;
  }

  const events = options.store.listEventsBySessionId(options.session.id);
  const skipped = skippedContents(events);
  const posted = postedTranscriptKeys(events);

  for (const message of readCodexTranscriptMessages(options.sessionPath)) {
    if (posted.has(message.key) || skipped.has(message.content)) {
      continue;
    }

    const content = message.role === "user" ? `Codex user: ${message.content}` : message.content;
    for (const chunk of chunkDiscordMessage(content)) {
      await options.discord.postMessage(options.session.discordThreadId, chunk);
    }
    options.store.recordEvent({
      sessionId: options.session.id,
      source: "codex",
      kind: "message",
      payload: { transcriptKey: message.key, role: message.role, content: message.content }
    });
  }
}

export function createCodexTranscriptPoller(options: {
  codexHome: string;
  store: Store;
  discord: DiscordPoster;
  findSessionPath?: (codexHome: string, codexSessionId: string) => string | null;
  intervalMs?: number;
}) {
  const baselinedSessions = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let runningScan: Promise<void> | null = null;

  async function scanNow() {
    if (runningScan) return runningScan;
    runningScan = (async () => {
      for (const session of options.store.listMappedSessions()) {
        if (!session.codexSessionId) continue;
        const sessionPath = (options.findSessionPath ?? findCodexSessionPath)(options.codexHome, session.codexSessionId);
        await syncCodexTranscriptSession({
          session,
          sessionPath,
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
      for (const session of options.store.listMappedSessions()) {
        if (!session.codexSessionId || baselinedSessions.has(session.id)) continue;
        const sessionPath = (options.findSessionPath ?? findCodexSessionPath)(options.codexHome, session.codexSessionId);
        for (const message of readCodexTranscriptMessages(sessionPath)) {
          options.store.recordEvent({
            sessionId: session.id,
            source: "codex",
            kind: "message",
            payload: { transcriptKey: message.key, role: message.role, content: message.content, baseline: true }
          });
        }
        baselinedSessions.add(session.id);
      }
      timer = setInterval(() => {
        void scanNow().catch((error) => {
          options.store.recordEvent({
            sessionId: null,
            source: "system",
            kind: "error",
            payload: { message: error instanceof Error ? error.message : "Unknown Codex transcript sync error" }
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
