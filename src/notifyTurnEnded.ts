import { chunkDiscordMessage } from "./format.js";
import { extractNotifyFields } from "./notifyPayload.js";
import type { BridgeEvent, BridgeSession } from "./types.js";

type Store = {
  listEventsBySessionId(sessionId: string): Array<Pick<BridgeEvent, "source" | "kind" | "payload">>;
  recordEvent(input: { sessionId: string | null; source: "codex"; kind: "turn_result"; payload: unknown }): unknown;
  markTurn(sessionId: string): void;
};

type DiscordPoster = {
  postMessage(threadId: string, content: string): Promise<void>;
};

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

function finalMessageAlreadyRecorded(events: Array<Pick<BridgeEvent, "source" | "kind" | "payload">>, finalMessage: string): boolean {
  return events.some((event) => {
    if (event.source !== "codex" || (event.kind !== "turn_result" && event.kind !== "summary")) {
      return false;
    }
    return payloadRecord(event.payload).finalMessage === finalMessage;
  });
}

export async function handleNotifyTurnEnded(options: {
  payload: unknown;
  resolveSession(codexSessionId: string | null): Promise<Pick<BridgeSession, "id" | "discordThreadId"> | null>;
  store: Store;
  discord: DiscordPoster;
}) {
  const fields = extractNotifyFields(options.payload);
  const session = fields.codexSessionId ? await options.resolveSession(fields.codexSessionId) : null;
  const shouldSkipPosting =
    session && fields.finalMessage
      ? finalMessageAlreadyRecorded(options.store.listEventsBySessionId(session.id), fields.finalMessage)
      : false;

  options.store.recordEvent({ sessionId: session?.id ?? null, source: "codex", kind: "turn_result", payload: options.payload });

  if (!session || !fields.finalMessage || shouldSkipPosting) {
    return;
  }

  options.store.markTurn(session.id);
  for (const chunk of chunkDiscordMessage(fields.finalMessage)) {
    await options.discord.postMessage(session.discordThreadId, chunk);
  }
}
