import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { nanoid } from "nanoid";
import type { BridgeEvent, BridgeSession, EventKind, EventSource, SessionStatus } from "./types.js";

interface CreateSessionInput {
  codexSessionId: string | null;
  discordGuildId: string;
  discordChannelId: string;
  discordThreadId: string;
  title: string;
}

interface RecordEventInput {
  sessionId: string | null;
  source: EventSource;
  kind: EventKind;
  payload: unknown;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toSession(row: Record<string, unknown> | undefined): BridgeSession | null {
  if (!row) return null;
  return {
    id: String(row.id),
    codexSessionId: row.codex_session_id === null ? null : String(row.codex_session_id),
    discordGuildId: String(row.discord_guild_id),
    discordChannelId: String(row.discord_channel_id),
    discordThreadId: String(row.discord_thread_id),
    title: String(row.title),
    status: row.status as SessionStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastTurnAt: row.last_turn_at === null ? null : String(row.last_turn_at),
    closedAt: row.closed_at === null ? null : String(row.closed_at)
  };
}

function toEvent(row: Record<string, unknown>): BridgeEvent {
  return {
    id: Number(row.id),
    sessionId: row.session_id === null ? null : String(row.session_id),
    source: row.source as EventSource,
    kind: row.kind as EventKind,
    payload: JSON.parse(String(row.payload_json)),
    createdAt: String(row.created_at)
  };
}

export function createStore(dbPath: string) {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      codex_session_id TEXT UNIQUE,
      discord_guild_id TEXT NOT NULL,
      discord_channel_id TEXT NOT NULL,
      discord_thread_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_turn_at TEXT,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );
  `);

  return {
    createSession(input: CreateSessionInput): BridgeSession {
      const timestamp = nowIso();
      const id = nanoid(12);
      db.prepare(`
        INSERT INTO sessions (
          id, codex_session_id, discord_guild_id, discord_channel_id, discord_thread_id,
          title, status, created_at, updated_at, last_turn_at, closed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL)
      `).run(
        id,
        input.codexSessionId,
        input.discordGuildId,
        input.discordChannelId,
        input.discordThreadId,
        input.title,
        timestamp,
        timestamp
      );
      return this.findSessionById(id)!;
    },

    findSessionById(id: string): BridgeSession | null {
      return toSession(db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined);
    },

    findSessionByThreadId(threadId: string): BridgeSession | null {
      return toSession(db.prepare("SELECT * FROM sessions WHERE discord_thread_id = ?").get(threadId) as Record<string, unknown> | undefined);
    },

    findSessionByCodexSessionId(codexSessionId: string): BridgeSession | null {
      return toSession(db.prepare("SELECT * FROM sessions WHERE codex_session_id = ?").get(codexSessionId) as Record<string, unknown> | undefined);
    },

    findUnmappedSessionByTitle(title: string): BridgeSession | null {
      return toSession(
        db.prepare("SELECT * FROM sessions WHERE codex_session_id IS NULL AND title = ? ORDER BY created_at DESC LIMIT 1").get(title) as
          | Record<string, unknown>
          | undefined
      );
    },

    setCodexSessionId(id: string, codexSessionId: string): void {
      db.prepare("UPDATE sessions SET codex_session_id = ?, updated_at = ? WHERE id = ?").run(codexSessionId, nowIso(), id);
    },

    updateSessionStatus(id: string, status: SessionStatus): void {
      const timestamp = nowIso();
      const closedAt = status === "closed" ? timestamp : null;
      db.prepare("UPDATE sessions SET status = ?, updated_at = ?, closed_at = COALESCE(?, closed_at) WHERE id = ?").run(status, timestamp, closedAt, id);
    },

    markTurn(id: string): void {
      const timestamp = nowIso();
      db.prepare("UPDATE sessions SET last_turn_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, id);
    },

    recordEvent(input: RecordEventInput): BridgeEvent {
      const result = db.prepare("INSERT INTO events (session_id, source, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
        input.sessionId,
        input.source,
        input.kind,
        JSON.stringify(input.payload),
        nowIso()
      );
      return toEvent(db.prepare("SELECT * FROM events WHERE id = ?").get(result.lastInsertRowid) as Record<string, unknown>);
    },

    close(): void {
      db.close();
    }
  };
}
