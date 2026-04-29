function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseStdinPayload(stdin: string): Record<string, unknown> {
  const trimmed = stdin.trim();
  if (!trimmed) {
    return {};
  }

  const singleObject = parseJsonObject(trimmed);
  if (singleObject) {
    return singleObject;
  }

  const events = trimmed
    .split(/\r?\n/)
    .map((line) => parseJsonObject(line.trim()))
    .filter((event): event is Record<string, unknown> => Boolean(event));

  return { events };
}

function stringField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function extractText(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const direct = stringField(record, ["final_message", "finalMessage", "message", "content", "text", "output"]);
  if (direct) {
    return direct;
  }
  return extractText(record.item);
}

function extractSessionIdFromRecord(record: Record<string, unknown>): string | null {
  const direct = stringField(record, ["session_id", "sessionId", "thread_id", "threadId", "conversation_id", "conversationId"]);
  if (direct) {
    return direct;
  }
  if ((record.type === "thread.started" || record.type === "session.started") && typeof record.id === "string") {
    return record.id;
  }
  return null;
}

export function extractNotifyFields(payload: unknown): { codexSessionId: string | null; finalMessage: string | null } {
  const direct = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const stdinPayload = typeof direct.stdin === "string" ? parseStdinPayload(direct.stdin) : {};
  const candidates = [direct, stdinPayload];
  const events = Array.isArray(stdinPayload.events) ? stdinPayload.events as unknown[] : [];

  let codexSessionId: string | null = null;
  for (const candidate of [...candidates, ...events]) {
    if (candidate && typeof candidate === "object") {
      codexSessionId = extractSessionIdFromRecord(candidate as Record<string, unknown>);
      if (codexSessionId) {
        break;
      }
    }
  }

  let finalMessage: string | null = null;
  for (const candidate of [...candidates, ...events].reverse()) {
    finalMessage = extractText(candidate);
    if (finalMessage) {
      break;
    }
  }

  return { codexSessionId, finalMessage };
}
