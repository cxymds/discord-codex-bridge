export type SessionStatus = "active" | "running" | "queued" | "closed" | "error";
export type EventSource = "discord" | "codex" | "system";
export type EventKind = "new" | "message" | "turn_result" | "summary" | "error" | "status_change";

export interface BridgeSession {
  id: string;
  codexSessionId: string | null;
  discordGuildId: string;
  discordChannelId: string;
  discordThreadId: string;
  projectPath: string | null;
  title: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  lastTurnAt: string | null;
  closedAt: string | null;
}

export interface BridgeEvent {
  id: number;
  sessionId: string | null;
  source: EventSource;
  kind: EventKind;
  payload: unknown;
  createdAt: string;
}

export interface CodexRunResult {
  sessionId: string | null;
  finalMessage: string;
  rawEvents: unknown[];
}

export interface DiscordActor {
  userId: string;
  roleIds: string[];
}
