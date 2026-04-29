# Discord-Codex Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Discord bot bridge that maps one Codex session to one Discord thread, lets Discord create and continue sessions, and forwards Codex turn results back to Discord.

**Architecture:** A TypeScript Node.js service owns Discord command handling, per-session queues, SQLite mapping state, Codex CLI process execution, and a localhost notify endpoint. Codex is driven through `/Applications/Codex.app/Contents/Resources/codex exec` and `codex exec resume`, while Discord remains the threaded session UI.

**Tech Stack:** Node.js 20+, TypeScript, discord.js, better-sqlite3, Fastify, Vitest, tsx.

---

## Discovered Local Codex Behavior

The installed Codex CLI supports the pieces this bridge needs:

```bash
/Applications/Codex.app/Contents/Resources/codex exec --json --output-last-message <file> <prompt>
/Applications/Codex.app/Contents/Resources/codex exec resume --json --output-last-message <file> <session-id> <prompt>
```

During implementation, verify the exact JSONL event fields with a short harmless prompt before finalizing `src/codex.ts`.

## File Structure

- `package.json`: scripts and dependencies.
- `tsconfig.json`: strict TypeScript configuration.
- `vitest.config.ts`: Vitest configuration.
- `.gitignore`: secrets, build output, database files.
- `.env.example`: documented configuration keys.
- `src/types.ts`: shared domain types.
- `src/config.ts`: environment parsing and validation.
- `src/authz.ts`: Discord user and role authorization.
- `src/format.ts`: Discord message chunking and title formatting.
- `src/store.ts`: SQLite schema and repository.
- `src/runner.ts`: child-process abstraction for tests.
- `src/codex.ts`: Codex CLI wrapper.
- `src/queue.ts`: per-session serial execution queue.
- `src/notify.ts`: localhost notification server.
- `src/bot.ts`: Discord slash commands and message listeners.
- `src/index.ts`: app composition and shutdown.
- `scripts/codex-discord-notify.mjs`: Codex notify fanout script.
- `tests/*.test.ts`: unit tests with mocked Discord/Codex boundaries.
- `docs/discord-setup.md`: bot setup, permissions, and local run instructions.

## Task 1: Scaffold the TypeScript Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/types.ts`

- [ ] **Step 1: Create the project metadata**

Create `package.json`:

```json
{
  "name": "codex-discord-bridge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "notify": "node scripts/codex-discord-notify.mjs"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "discord.js": "^14.18.0",
    "dotenv": "^16.4.7",
    "fastify": "^5.2.1",
    "nanoid": "^5.0.9",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.13.10",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2",
    "vitest": "^3.0.8"
  }
}
```

- [ ] **Step 2: Create TypeScript and test config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    restoreMocks: true
  }
});
```

- [ ] **Step 3: Create ignored files and sample env**

Create `.gitignore`:

```gitignore
node_modules/
dist/
.env
data/
*.sqlite
*.sqlite-shm
*.sqlite-wal
.DS_Store
```

Create `.env.example`:

```env
DISCORD_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_GUILD_ID=
DISCORD_CHANNEL_ID=
DISCORD_ALLOWED_USER_IDS=
DISCORD_ALLOWED_ROLE_IDS=
CODEX_BIN=/Applications/Codex.app/Contents/Resources/codex
CODEX_HOME=/Users/cxymds/.codex
BRIDGE_DB_PATH=./data/bridge.sqlite
BRIDGE_NOTIFY_HOST=127.0.0.1
BRIDGE_NOTIFY_PORT=43765
BRIDGE_PUBLIC_BASE_URL=http://127.0.0.1:43765
```

- [ ] **Step 4: Create shared types**

Create `src/types.ts`:

```ts
export type SessionStatus = "active" | "running" | "queued" | "closed" | "error";
export type EventSource = "discord" | "codex" | "system";
export type EventKind = "new" | "message" | "turn_result" | "summary" | "error" | "status_change";

export interface BridgeSession {
  id: string;
  codexSessionId: string | null;
  discordGuildId: string;
  discordChannelId: string;
  discordThreadId: string;
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
```

- [ ] **Step 5: Install dependencies**

Run:

```bash
npm install
```

Expected: `package-lock.json` is created and dependencies install without errors.

- [ ] **Step 6: Run initial checks**

Run:

```bash
npm test
npm run build
```

Expected: tests report no test files yet or pass, and TypeScript compiles.

- [ ] **Step 7: Commit scaffold**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example src/types.ts
git commit -m "chore: scaffold Discord Codex bridge"
```

## Task 2: Add Config, Authorization, and Formatting Utilities

**Files:**
- Create: `src/config.ts`
- Create: `src/authz.ts`
- Create: `src/format.ts`
- Create: `tests/config.test.ts`
- Create: `tests/authz.test.ts`
- Create: `tests/format.test.ts`

- [ ] **Step 1: Write config tests**

Create `tests/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadConfigFromEnv } from "../src/config.js";

describe("loadConfigFromEnv", () => {
  const validEnv = {
    DISCORD_TOKEN: "token",
    DISCORD_APPLICATION_ID: "app",
    DISCORD_GUILD_ID: "guild",
    DISCORD_CHANNEL_ID: "channel",
    DISCORD_ALLOWED_USER_IDS: "u1,u2",
    DISCORD_ALLOWED_ROLE_IDS: "",
    CODEX_BIN: "/Applications/Codex.app/Contents/Resources/codex",
    CODEX_HOME: "/Users/cxymds/.codex",
    BRIDGE_DB_PATH: "./data/bridge.sqlite",
    BRIDGE_NOTIFY_HOST: "127.0.0.1",
    BRIDGE_NOTIFY_PORT: "43765"
  };

  it("parses comma-separated allow lists", () => {
    const config = loadConfigFromEnv(validEnv);
    expect(config.allowedUserIds).toEqual(["u1", "u2"]);
    expect(config.allowedRoleIds).toEqual([]);
    expect(config.notifyPort).toBe(43765);
  });

  it("requires at least one allowed user or role", () => {
    expect(() =>
      loadConfigFromEnv({
        ...validEnv,
        DISCORD_ALLOWED_USER_IDS: "",
        DISCORD_ALLOWED_ROLE_IDS: ""
      })
    ).toThrow("At least one Discord allowed user id or role id is required");
  });
});
```

- [ ] **Step 2: Implement config parsing**

Create `src/config.ts`:

```ts
import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_CHANNEL_ID: z.string().min(1),
  DISCORD_ALLOWED_USER_IDS: z.string().default(""),
  DISCORD_ALLOWED_ROLE_IDS: z.string().default(""),
  CODEX_BIN: z.string().default("/Applications/Codex.app/Contents/Resources/codex"),
  CODEX_HOME: z.string().default(`${process.env.HOME ?? ""}/.codex`),
  BRIDGE_DB_PATH: z.string().default("./data/bridge.sqlite"),
  BRIDGE_NOTIFY_HOST: z.string().default("127.0.0.1"),
  BRIDGE_NOTIFY_PORT: z.coerce.number().int().positive().default(43765),
  BRIDGE_PUBLIC_BASE_URL: z.string().default("http://127.0.0.1:43765")
});

export interface BridgeConfig {
  discordToken: string;
  discordApplicationId: string;
  discordGuildId: string;
  discordChannelId: string;
  allowedUserIds: string[];
  allowedRoleIds: string[];
  codexBin: string;
  codexHome: string;
  dbPath: string;
  notifyHost: string;
  notifyPort: number;
  publicBaseUrl: string;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const parsed = envSchema.parse(env);
  const allowedUserIds = splitCsv(parsed.DISCORD_ALLOWED_USER_IDS);
  const allowedRoleIds = splitCsv(parsed.DISCORD_ALLOWED_ROLE_IDS);

  if (allowedUserIds.length === 0 && allowedRoleIds.length === 0) {
    throw new Error("At least one Discord allowed user id or role id is required");
  }

  return {
    discordToken: parsed.DISCORD_TOKEN,
    discordApplicationId: parsed.DISCORD_APPLICATION_ID,
    discordGuildId: parsed.DISCORD_GUILD_ID,
    discordChannelId: parsed.DISCORD_CHANNEL_ID,
    allowedUserIds,
    allowedRoleIds,
    codexBin: parsed.CODEX_BIN,
    codexHome: parsed.CODEX_HOME,
    dbPath: parsed.BRIDGE_DB_PATH,
    notifyHost: parsed.BRIDGE_NOTIFY_HOST,
    notifyPort: parsed.BRIDGE_NOTIFY_PORT,
    publicBaseUrl: parsed.BRIDGE_PUBLIC_BASE_URL
  };
}
```

- [ ] **Step 3: Write authorization tests**

Create `tests/authz.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAuthorized } from "../src/authz.js";

describe("isAuthorized", () => {
  it("allows matching users", () => {
    expect(isAuthorized({ userId: "u1", roleIds: [] }, ["u1"], [])).toBe(true);
  });

  it("allows matching roles", () => {
    expect(isAuthorized({ userId: "u2", roleIds: ["r1"] }, [], ["r1"])).toBe(true);
  });

  it("denies actors without a matching user or role", () => {
    expect(isAuthorized({ userId: "u2", roleIds: ["r2"] }, ["u1"], ["r1"])).toBe(false);
  });
});
```

- [ ] **Step 4: Implement authorization**

Create `src/authz.ts`:

```ts
import type { DiscordActor } from "./types.js";

export function isAuthorized(actor: DiscordActor, allowedUserIds: string[], allowedRoleIds: string[]): boolean {
  if (allowedUserIds.includes(actor.userId)) {
    return true;
  }

  return actor.roleIds.some((roleId) => allowedRoleIds.includes(roleId));
}
```

- [ ] **Step 5: Write formatting tests**

Create `tests/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chunkDiscordMessage, makeThreadTitle } from "../src/format.js";

describe("chunkDiscordMessage", () => {
  it("keeps short messages as one chunk", () => {
    expect(chunkDiscordMessage("hello")).toEqual(["hello"]);
  });

  it("splits long messages under Discord limits", () => {
    const chunks = chunkDiscordMessage("a".repeat(4100), 2000);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.length <= 2000)).toBe(true);
  });
});

describe("makeThreadTitle", () => {
  it("creates a compact title from the prompt", () => {
    expect(makeThreadTitle("  Build a Discord bridge for Codex sessions  ")).toBe("Build a Discord bridge for Codex sessions");
  });

  it("falls back for empty prompts", () => {
    expect(makeThreadTitle("   ")).toBe("Codex session");
  });
});
```

- [ ] **Step 6: Implement formatting**

Create `src/format.ts`:

```ts
export function chunkDiscordMessage(message: string, limit = 1900): string[] {
  const text = message.trim().length > 0 ? message : "(empty response)";
  const chunks: string[] = [];

  for (let offset = 0; offset < text.length; offset += limit) {
    chunks.push(text.slice(offset, offset + limit));
  }

  return chunks;
}

export function makeThreadTitle(prompt: string, maxLength = 90): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) {
    return "Codex session";
  }

  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}...` : cleaned;
}
```

- [ ] **Step 7: Verify utilities**

Run:

```bash
npm test -- tests/config.test.ts tests/authz.test.ts tests/format.test.ts
npm run build
```

Expected: all tests pass and TypeScript compiles.

- [ ] **Step 8: Commit utilities**

```bash
git add src/config.ts src/authz.ts src/format.ts tests/config.test.ts tests/authz.test.ts tests/format.test.ts
git commit -m "feat: add bridge config utilities"
```

## Task 3: Add SQLite Store

**Files:**
- Create: `src/store.ts`
- Create: `tests/store.test.ts`

- [ ] **Step 1: Write store tests**

Create `tests/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createStore } from "../src/store.js";

describe("store", () => {
  it("creates and finds sessions by thread and Codex id", () => {
    const store = createStore(":memory:");
    const session = store.createSession({
      codexSessionId: "codex-1",
      discordGuildId: "guild",
      discordChannelId: "channel",
      discordThreadId: "thread",
      title: "Test session"
    });

    expect(store.findSessionByThreadId("thread")?.id).toBe(session.id);
    expect(store.findSessionByCodexSessionId("codex-1")?.id).toBe(session.id);
  });

  it("updates status and records close time", () => {
    const store = createStore(":memory:");
    const session = store.createSession({
      codexSessionId: null,
      discordGuildId: "guild",
      discordChannelId: "channel",
      discordThreadId: "thread",
      title: "Test session"
    });

    store.updateSessionStatus(session.id, "closed");
    const updated = store.findSessionById(session.id);

    expect(updated?.status).toBe("closed");
    expect(updated?.closedAt).toMatch(/T/);
  });

  it("records events", () => {
    const store = createStore(":memory:");
    const event = store.recordEvent({
      sessionId: null,
      source: "system",
      kind: "error",
      payload: { message: "unknown session" }
    });

    expect(event.id).toBeGreaterThan(0);
    expect(event.payload).toEqual({ message: "unknown session" });
  });
});
```

- [ ] **Step 2: Implement SQLite store**

Create `src/store.ts`:

```ts
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
```

- [ ] **Step 3: Verify store**

Run:

```bash
npm test -- tests/store.test.ts
npm run build
```

Expected: store tests pass and TypeScript compiles.

- [ ] **Step 4: Commit store**

```bash
git add src/store.ts tests/store.test.ts
git commit -m "feat: persist Discord Codex sessions"
```

## Task 4: Add Codex Process Wrapper

**Files:**
- Create: `src/runner.ts`
- Create: `src/codex.ts`
- Create: `tests/codex.test.ts`

- [ ] **Step 1: Write Codex wrapper tests**

Create `tests/codex.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createCodexClient } from "../src/codex.js";
import type { ProcessRunner } from "../src/runner.js";

describe("createCodexClient", () => {
  it("runs a new session and captures the final message", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      code: 0,
      stdout: [
        JSON.stringify({ type: "session.started", session_id: "s1" }),
        JSON.stringify({ type: "agent_message", message: "done" })
      ].join("\n"),
      stderr: ""
    }));

    const client = createCodexClient({ codexBin: "/codex", codexHome: "/home/.codex", cwd: "/work", runner });
    const result = await client.start("hello");

    expect(result.sessionId).toBe("s1");
    expect(result.finalMessage).toBe("done");
    expect(runner).toHaveBeenCalledWith("/codex", expect.arrayContaining(["exec", "--json"]), expect.objectContaining({ cwd: "/work" }));
  });

  it("uses exec resume for follow-up turns", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({ type: "message", content: "continued" }),
      stderr: ""
    }));

    const client = createCodexClient({ codexBin: "/codex", codexHome: "/home/.codex", cwd: "/work", runner });
    const result = await client.resume("s1", "continue");

    expect(result.finalMessage).toBe("continued");
    expect(runner).toHaveBeenCalledWith("/codex", expect.arrayContaining(["exec", "resume", "--json", "s1"]), expect.anything());
  });

  it("throws when Codex exits non-zero", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({ code: 1, stdout: "", stderr: "bad" }));
    const client = createCodexClient({ codexBin: "/codex", codexHome: "/home/.codex", cwd: "/work", runner });

    await expect(client.start("hello")).rejects.toThrow("Codex exited with code 1: bad");
  });
});
```

- [ ] **Step 2: Implement process runner**

Create `src/runner.ts`:

```ts
import { spawn } from "node:child_process";

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<ProcessResult>;

export const defaultRunner: ProcessRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
```

- [ ] **Step 3: Implement Codex client**

Create `src/codex.ts`:

```ts
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
  return null;
}

function extractSessionId(events: unknown[]): string | null {
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    for (const key of ["session_id", "sessionId", "conversation_id", "id"]) {
      const value = record[key];
      if (typeof value === "string" && value.length > 8) {
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

  async function run(args: string[]): Promise<CodexRunResult> {
    const result = await runner(options.codexBin, args, { cwd: options.cwd, env: baseEnv });
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
```

- [ ] **Step 4: Verify Codex wrapper**

Run:

```bash
npm test -- tests/codex.test.ts
npm run build
```

Expected: Codex tests pass and TypeScript compiles.

- [ ] **Step 5: Manually inspect one harmless Codex JSONL run**

Run:

```bash
mkdir -p .tmp/codex-check
/Applications/Codex.app/Contents/Resources/codex exec --json -C "$PWD" "只回复：codex-discord-bridge-check" | tee .tmp/codex-check/events.jsonl
```

Expected: command exits 0, JSONL contains a session identifier and a final assistant message. If field names differ from the tests, update `extractSessionId` and `extractFinalMessage`, then rerun `npm test -- tests/codex.test.ts`.

- [ ] **Step 6: Commit Codex wrapper**

```bash
git add src/runner.ts src/codex.ts tests/codex.test.ts
git commit -m "feat: wrap Codex CLI execution"
```

## Task 5: Add Session Queue and Notify Endpoint

**Files:**
- Create: `src/queue.ts`
- Create: `src/notify.ts`
- Create: `tests/queue.test.ts`
- Create: `tests/notify.test.ts`

- [ ] **Step 1: Write queue tests**

Create `tests/queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SessionQueue } from "../src/queue.js";

describe("SessionQueue", () => {
  it("runs work for the same session sequentially", async () => {
    const queue = new SessionQueue();
    const order: string[] = [];

    const first = queue.enqueue("s1", async () => {
      order.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("first-end");
      return "first";
    });

    const second = queue.enqueue("s1", async () => {
      order.push("second");
      return "second";
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });
});
```

- [ ] **Step 2: Implement queue**

Create `src/queue.ts`:

```ts
export class SessionQueue {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly pendingCounts = new Map<string, number>();

  enqueue<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    this.pendingCounts.set(sessionId, this.pendingCount(sessionId) + 1);
    const previous = this.chains.get(sessionId) ?? Promise.resolve();

    const next = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          return await work();
        } finally {
          this.pendingCounts.set(sessionId, Math.max(0, this.pendingCount(sessionId) - 1));
        }
      });

    this.chains.set(sessionId, next);
    next.finally(() => {
      if (this.chains.get(sessionId) === next) {
        this.chains.delete(sessionId);
      }
    }).catch(() => undefined);

    return next;
  }

  pendingCount(sessionId: string): number {
    return this.pendingCounts.get(sessionId) ?? 0;
  }
}
```

- [ ] **Step 3: Write notify tests**

Create `tests/notify.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { startNotifyServer } from "../src/notify.js";

describe("startNotifyServer", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers.length = 0;
  });

  it("accepts turn-ended notifications", async () => {
    const handler = vi.fn(async () => undefined);
    const server = await startNotifyServer({ host: "127.0.0.1", port: 0, onTurnEnded: handler });
    servers.push(server);

    const response = await fetch(`${server.url}/notify/turn-ended`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: "s1", final_message: "done" })
    });

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith({ session_id: "s1", final_message: "done" });
  });
});
```

- [ ] **Step 4: Implement notify server**

Create `src/notify.ts`:

```ts
import Fastify from "fastify";

interface NotifyServerOptions {
  host: string;
  port: number;
  onTurnEnded: (payload: unknown) => Promise<void>;
}

export async function startNotifyServer(options: NotifyServerOptions) {
  const app = Fastify({ logger: false });

  app.post("/notify/turn-ended", async (request, reply) => {
    await options.onTurnEnded(request.body);
    return reply.send({ ok: true });
  });

  await app.listen({ host: options.host, port: options.port });

  return {
    url: app.server.address() && typeof app.server.address() === "object"
      ? `http://${options.host}:${app.server.address().port}`
      : `http://${options.host}:${options.port}`,
    close: async () => {
      await app.close();
    }
  };
}
```

- [ ] **Step 5: Verify queue and notify**

Run:

```bash
npm test -- tests/queue.test.ts tests/notify.test.ts
npm run build
```

Expected: tests pass and TypeScript compiles.

- [ ] **Step 6: Commit queue and notify**

```bash
git add src/queue.ts src/notify.ts tests/queue.test.ts tests/notify.test.ts
git commit -m "feat: add session queue and notify endpoint"
```

## Task 6: Add Discord Bot Service

**Files:**
- Create: `src/bot.ts`
- Create: `tests/bot.test.ts`

- [ ] **Step 1: Write bot handler tests around injected ports**

Create `tests/bot.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createBridgeHandlers } from "../src/bot.js";

describe("createBridgeHandlers", () => {
  it("creates a session and posts the first Codex result", async () => {
    const createThread = vi.fn(async () => ({ id: "thread1", name: "Hello" }));
    const postMessage = vi.fn(async () => undefined);
    const store = {
      createSession: vi.fn((input) => ({ id: "bridge1", ...input, status: "active", createdAt: "", updatedAt: "", lastTurnAt: null, closedAt: null })),
      setCodexSessionId: vi.fn(),
      updateSessionStatus: vi.fn(),
      markTurn: vi.fn(),
      recordEvent: vi.fn()
    };
    const codex = { start: vi.fn(async () => ({ sessionId: "codex1", finalMessage: "done", rawEvents: [] })) };
    const handlers = createBridgeHandlers({
      config: { discordGuildId: "guild", discordChannelId: "channel", allowedUserIds: ["u1"], allowedRoleIds: [] },
      store: store as never,
      codex: codex as never,
      queue: { enqueue: vi.fn((_id, work) => work()), pendingCount: vi.fn(() => 0) } as never,
      discord: { createThread, postMessage }
    });

    await handlers.handleNewCommand({ userId: "u1", roleIds: [], prompt: "Hello" });

    expect(createThread).toHaveBeenCalledWith("channel", "Hello");
    expect(codex.start).toHaveBeenCalledWith("Hello");
    expect(postMessage).toHaveBeenCalledWith("thread1", "done");
  });

  it("denies unauthorized users", async () => {
    const handlers = createBridgeHandlers({
      config: { discordGuildId: "guild", discordChannelId: "channel", allowedUserIds: ["u1"], allowedRoleIds: [] },
      store: {} as never,
      codex: {} as never,
      queue: {} as never,
      discord: { createThread: vi.fn(), postMessage: vi.fn() }
    });

    await expect(handlers.handleNewCommand({ userId: "u2", roleIds: [], prompt: "Hello" })).rejects.toThrow("Not authorized");
  });

  it("reports status for a mapped thread", async () => {
    const store = {
      findSessionByThreadId: vi.fn(() => ({
        id: "bridge1",
        codexSessionId: "codex1",
        discordGuildId: "guild",
        discordChannelId: "channel",
        discordThreadId: "thread1",
        title: "Hello",
        status: "active",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:01:00.000Z",
        lastTurnAt: "2026-04-29T00:01:00.000Z",
        closedAt: null
      }))
    };
    const handlers = createBridgeHandlers({
      config: { discordGuildId: "guild", discordChannelId: "channel", allowedUserIds: ["u1"], allowedRoleIds: [] },
      store: store as never,
      codex: {} as never,
      queue: { pendingCount: vi.fn(() => 2) } as never,
      discord: { createThread: vi.fn(), postMessage: vi.fn() }
    });

    await expect(handlers.handleStatusCommand({ userId: "u1", roleIds: [], threadId: "thread1" })).resolves.toContain("codex1");
  });
});
```

- [ ] **Step 2: Implement testable bot handlers and Discord registration**

Create `src/bot.ts`:

```ts
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message
} from "discord.js";
import { isAuthorized } from "./authz.js";
import { chunkDiscordMessage, makeThreadTitle } from "./format.js";
import type { BridgeConfig } from "./config.js";
import type { SessionQueue } from "./queue.js";
import type { createStore } from "./store.js";
import type { createCodexClient } from "./codex.js";

type Store = ReturnType<typeof createStore>;
type CodexClient = ReturnType<typeof createCodexClient>;

interface MinimalConfig {
  discordGuildId: string;
  discordChannelId: string;
  allowedUserIds: string[];
  allowedRoleIds: string[];
}

interface DiscordPort {
  createThread(channelId: string, title: string): Promise<{ id: string; name: string }>;
  postMessage(threadId: string, content: string): Promise<void>;
}

interface HandlerDeps {
  config: MinimalConfig;
  store: Store;
  codex: CodexClient;
  queue: SessionQueue;
  discord: DiscordPort;
}

export function createBridgeHandlers(deps: HandlerDeps) {
  function assertAuthorized(userId: string, roleIds: string[]) {
    if (!isAuthorized({ userId, roleIds }, deps.config.allowedUserIds, deps.config.allowedRoleIds)) {
      throw new Error("Not authorized");
    }
  }

  async function postLong(threadId: string, content: string) {
    for (const chunk of chunkDiscordMessage(content)) {
      await deps.discord.postMessage(threadId, chunk);
    }
  }

  return {
    async handleNewCommand(input: { userId: string; roleIds: string[]; prompt: string }) {
      assertAuthorized(input.userId, input.roleIds);
      const title = makeThreadTitle(input.prompt);
      const thread = await deps.discord.createThread(deps.config.discordChannelId, title);
      const session = deps.store.createSession({
        codexSessionId: null,
        discordGuildId: deps.config.discordGuildId,
        discordChannelId: deps.config.discordChannelId,
        discordThreadId: thread.id,
        title
      });

      deps.store.recordEvent({ sessionId: session.id, source: "discord", kind: "new", payload: { prompt: input.prompt } });
      await deps.queue.enqueue(session.id, async () => {
        deps.store.updateSessionStatus(session.id, "running");
        const result = await deps.codex.start(input.prompt);
        if (result.sessionId) deps.store.setCodexSessionId(session.id, result.sessionId);
        deps.store.markTurn(session.id);
        deps.store.updateSessionStatus(session.id, "active");
        deps.store.recordEvent({ sessionId: session.id, source: "codex", kind: "turn_result", payload: result });
        await postLong(thread.id, result.finalMessage);
      });
    },

    async handleThreadMessage(input: { userId: string; roleIds: string[]; threadId: string; content: string }) {
      assertAuthorized(input.userId, input.roleIds);
      const session = deps.store.findSessionByThreadId(input.threadId);
      if (!session) return;
      if (session.status === "closed") {
        await deps.discord.postMessage(input.threadId, "This Codex session is closed.");
        return;
      }
      if (!session.codexSessionId) {
        await deps.discord.postMessage(input.threadId, "This Codex session is not ready yet.");
        return;
      }

      deps.store.recordEvent({ sessionId: session.id, source: "discord", kind: "message", payload: { content: input.content } });
      await deps.queue.enqueue(session.id, async () => {
        deps.store.updateSessionStatus(session.id, "running");
        const result = await deps.codex.resume(session.codexSessionId!, input.content);
        deps.store.markTurn(session.id);
        deps.store.updateSessionStatus(session.id, "active");
        deps.store.recordEvent({ sessionId: session.id, source: "codex", kind: "turn_result", payload: result });
        await postLong(input.threadId, result.finalMessage);
      });
    },

    async handleDoneCommand(input: { userId: string; roleIds: string[]; threadId: string }) {
      assertAuthorized(input.userId, input.roleIds);
      const session = deps.store.findSessionByThreadId(input.threadId);
      if (!session || !session.codexSessionId) {
        throw new Error("No mapped Codex session for this thread");
      }
      const result = await deps.queue.enqueue(session.id, async () => deps.codex.summarize(session.codexSessionId!));
      deps.store.updateSessionStatus(session.id, "closed");
      deps.store.recordEvent({ sessionId: session.id, source: "codex", kind: "summary", payload: result });
      await postLong(input.threadId, result.finalMessage);
    },

    async handleStatusCommand(input: { userId: string; roleIds: string[]; threadId: string }) {
      assertAuthorized(input.userId, input.roleIds);
      const session = deps.store.findSessionByThreadId(input.threadId);
      if (!session) {
        return "No Codex session is mapped to this thread.";
      }
      return [
        `Bridge session: ${session.id}`,
        `Codex session: ${session.codexSessionId ?? "not ready"}`,
        `Status: ${session.status}`,
        `Pending queue: ${deps.queue.pendingCount(session.id)}`,
        `Last turn: ${session.lastTurnAt ?? "never"}`
      ].join("\n");
    }
  };
}

export function buildSlashCommands() {
  return [
    new SlashCommandBuilder()
      .setName("codex")
      .setDescription("Manage Codex sessions")
      .addSubcommand((sub) =>
        sub
          .setName("new")
          .setDescription("Create a new Codex session")
          .addStringOption((option) => option.setName("prompt").setDescription("Initial prompt").setRequired(true))
      )
      .addSubcommand((sub) => sub.setName("done").setDescription("Close this Codex session with a final summary"))
      .addSubcommand((sub) => sub.setName("status").setDescription("Show this Codex session status"))
      .toJSON()
  ];
}

export async function registerCommands(config: BridgeConfig) {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  await rest.put(Routes.applicationGuildCommands(config.discordApplicationId, config.discordGuildId), {
    body: buildSlashCommands()
  });
}

function roleIdsFromInteraction(interaction: ChatInputCommandInteraction): string[] {
  const roles = interaction.member && "roles" in interaction.member ? interaction.member.roles : [];
  return Array.isArray(roles) ? roles.map(String) : [];
}

function roleIdsFromMessage(message: Message): string[] {
  const roles = message.member?.roles.cache;
  return roles ? [...roles.keys()] : [];
}

export function createDiscordClient(config: BridgeConfig, handlers: ReturnType<typeof createBridgeHandlers>) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "codex") return;
    try {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "new") {
        await interaction.deferReply({ ephemeral: true });
        await handlers.handleNewCommand({
          userId: interaction.user.id,
          roleIds: roleIdsFromInteraction(interaction),
          prompt: interaction.options.getString("prompt", true)
        });
        await interaction.editReply("Codex thread created.");
      } else if (subcommand === "done") {
        await interaction.deferReply({ ephemeral: true });
        await handlers.handleDoneCommand({
          userId: interaction.user.id,
          roleIds: roleIdsFromInteraction(interaction),
          threadId: interaction.channelId
        });
        await interaction.editReply("Codex session closed.");
      } else if (subcommand === "status") {
        await interaction.reply({
          ephemeral: true,
          content: await handlers.handleStatusCommand({
            userId: interaction.user.id,
            roleIds: roleIdsFromInteraction(interaction),
            threadId: interaction.channelId
          })
        });
      }
    } catch (error) {
      const content = error instanceof Error ? error.message : "Unknown bridge error";
      if (interaction.deferred || interaction.replied) await interaction.editReply(content);
      else await interaction.reply({ ephemeral: true, content });
    }
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot || message.channel.type !== ChannelType.PublicThread) return;
    await handlers.handleThreadMessage({
      userId: message.author.id,
      roleIds: roleIdsFromMessage(message),
      threadId: message.channelId,
      content: message.content
    });
  });

  return client;
}
```

- [ ] **Step 3: Verify bot handlers**

Run:

```bash
npm test -- tests/bot.test.ts
npm run build
```

Expected: bot tests pass and TypeScript compiles.

- [ ] **Step 4: Commit bot service**

```bash
git add src/bot.ts tests/bot.test.ts
git commit -m "feat: add Discord bot handlers"
```

## Task 7: Wire the Application and Notify Fanout Script

**Files:**
- Create: `src/index.ts`
- Create: `scripts/codex-discord-notify.mjs`
- Create: `docs/discord-setup.md`

- [ ] **Step 1: Implement app entrypoint**

Create `src/index.ts`:

```ts
import "dotenv/config";
import { loadConfigFromEnv } from "./config.js";
import { createStore } from "./store.js";
import { createCodexClient } from "./codex.js";
import { SessionQueue } from "./queue.js";
import { startNotifyServer } from "./notify.js";
import { createBridgeHandlers, createDiscordClient, registerCommands } from "./bot.js";
import { chunkDiscordMessage } from "./format.js";

const config = loadConfigFromEnv();
const store = createStore(config.dbPath);
const codex = createCodexClient({
  codexBin: config.codexBin,
  codexHome: config.codexHome,
  cwd: process.cwd()
});
const queue = new SessionQueue();

const discordPort = {
  async createThread(channelId: string, title: string) {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !("threads" in channel)) {
      throw new Error(`Discord channel ${channelId} cannot create threads`);
    }
    const thread = await channel.threads.create({ name: title, autoArchiveDuration: 1440 });
    return { id: thread.id, name: thread.name };
  },
  async postMessage(threadId: string, content: string) {
    const channel = await client.channels.fetch(threadId);
    if (!channel || !("send" in channel)) {
      throw new Error(`Discord thread ${threadId} cannot receive messages`);
    }
    await channel.send(content);
  }
};

const handlers = createBridgeHandlers({ config, store, codex, queue, discord: discordPort });
const client = createDiscordClient(config, handlers);

function extractNotifyFields(payload: unknown): { codexSessionId: string | null; finalMessage: string | null } {
  const direct = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  let parsedStdin: Record<string, unknown> = {};
  if (typeof direct.stdin === "string" && direct.stdin.trim().startsWith("{")) {
    try {
      parsedStdin = JSON.parse(direct.stdin) as Record<string, unknown>;
    } catch {
      parsedStdin = {};
    }
  }
  const merged = { ...direct, ...parsedStdin };
  const codexSessionId = typeof merged.session_id === "string"
    ? merged.session_id
    : typeof merged.sessionId === "string"
      ? merged.sessionId
      : null;
  const finalMessage = typeof merged.final_message === "string"
    ? merged.final_message
    : typeof merged.message === "string"
      ? merged.message
      : null;
  return { codexSessionId, finalMessage };
}

const notifyServer = await startNotifyServer({
  host: config.notifyHost,
  port: config.notifyPort,
  onTurnEnded: async (payload) => {
    const fields = extractNotifyFields(payload);
    const session = fields.codexSessionId ? store.findSessionByCodexSessionId(fields.codexSessionId) : null;
    store.recordEvent({ sessionId: session?.id ?? null, source: "codex", kind: "turn_result", payload });
    if (session && fields.finalMessage) {
      store.markTurn(session.id);
      for (const chunk of chunkDiscordMessage(fields.finalMessage)) {
        await discordPort.postMessage(session.discordThreadId, chunk);
      }
    }
  }
});

await registerCommands(config);
await client.login(config.discordToken);

console.log(`Discord-Codex bridge running. Notify endpoint: ${notifyServer.url}/notify/turn-ended`);

async function shutdown() {
  await notifyServer.close();
  await client.destroy();
  store.close();
}

process.once("SIGINT", () => {
  shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  shutdown().finally(() => process.exit(0));
});
```

- [ ] **Step 2: Implement Codex notify fanout script**

Create `scripts/codex-discord-notify.mjs`:

```js
#!/usr/bin/env node

const endpoint = process.env.BRIDGE_NOTIFY_URL ?? "http://127.0.0.1:43765/notify/turn-ended";
const chunks = [];

for await (const chunk of process.stdin) {
  chunks.push(Buffer.from(chunk));
}

const stdin = Buffer.concat(chunks).toString("utf8");
const payload = {
  argv: process.argv.slice(2),
  stdin,
  received_at: new Date().toISOString()
};

try {
  await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
}

const existingNotifier = "/Users/cxymds/.codex/plugins/cache/openai-bundled/computer-use/1.0.758/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient";
try {
  const { spawn } = await import("node:child_process");
  const child = spawn(existingNotifier, process.argv.slice(2), { stdio: ["pipe", "ignore", "ignore"] });
  child.stdin.end(stdin);
} catch {
  process.exit(0);
}
```

- [ ] **Step 3: Write setup documentation**

Create `docs/discord-setup.md`:

```md
# Discord Setup

1. Create a Discord application and bot in the Discord Developer Portal.
2. Enable bot permissions for slash commands, reading messages, sending messages, creating threads, and sending messages in threads.
3. Invite the bot to the target guild.
4. Copy `.env.example` to `.env` and fill in:
   - `DISCORD_TOKEN`
   - `DISCORD_APPLICATION_ID`
   - `DISCORD_GUILD_ID`
   - `DISCORD_CHANNEL_ID`
   - `DISCORD_ALLOWED_USER_IDS` or `DISCORD_ALLOWED_ROLE_IDS`
5. Run `npm install`.
6. Run `npm run build`.
7. Run `npm run dev`.
8. In Discord, run `/codex new prompt:你好，确认桥接可用`.

## Codex Notify Hook

To forward Codex turn-ended notifications to Discord while preserving the existing Computer Use notifier, update `~/.codex/config.toml` so `notify` points at:

```toml
notify = ["node", "/Users/cxymds/Documents/New project 2/scripts/codex-discord-notify.mjs", "turn-ended"]
```

Keep a backup of the previous `notify` value before changing it.
```

- [ ] **Step 4: Verify app build**

Run:

```bash
npm run build
```

Expected: TypeScript compiles.

- [ ] **Step 5: Commit app wiring**

```bash
git add src/index.ts scripts/codex-discord-notify.mjs docs/discord-setup.md
git commit -m "feat: wire bridge application"
```

## Task 8: End-to-End Manual Verification

**Files:**
- Modify: `docs/discord-setup.md`
- Modify: `.env.example` if a missing variable is discovered

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass and TypeScript compiles.

- [ ] **Step 2: Start the bridge**

Run:

```bash
npm run dev
```

Expected: the console prints `Discord-Codex bridge running` and the notify endpoint URL.

- [ ] **Step 3: Verify Discord new-session flow**

In the configured Discord channel, run:

```text
/codex new prompt: 请回复 Discord-Codex bridge online
```

Expected: a new thread appears and receives the Codex response.

- [ ] **Step 4: Verify Discord continuation flow**

In the created thread, send:

```text
请用一句话确认这是同一个会话。
```

Expected: the reply appears in the same thread and references the existing context.

- [ ] **Step 5: Verify close flow**

In the same thread, run:

```text
/codex done
```

Expected: the bot posts a concise final summary and marks the session closed in SQLite.

- [ ] **Step 6: Verify notify script payload capture**

With the bridge running, run:

```bash
printf '{"session_id":"manual-check","final_message":"notify ok"}' | node scripts/codex-discord-notify.mjs turn-ended
```

Expected: the bridge records a `turn_result` event without crashing, and the existing Computer Use notifier still receives the fanout attempt.

- [ ] **Step 7: Document any real Discord permission findings**

If Discord reports a missing permission, update `docs/discord-setup.md` with the exact permission name shown by Discord.

- [ ] **Step 8: Commit verification docs**

```bash
git add docs/discord-setup.md .env.example
git commit -m "docs: document bridge verification"
```

## Self-Review

Spec coverage:

- Discord thread per Codex session: Task 6 creates threads and stores mappings.
- Discord can create and continue Codex sessions: Tasks 4 and 6 cover `start` and `resume`.
- Codex results appear in Discord: Tasks 4, 5, 6, and 7 cover result parsing, message posting, and notify capture.
- Explicit final summary: Task 6 implements `handleDoneCommand` with `codex.summarize`.
- SQLite state survives restart: Task 3 persists sessions and events.
- Authorization: Task 2 implements user and role checks; Task 6 applies them.
- Queueing: Task 5 implements per-session queues; Task 6 uses them.
- Setup and manual verification: Tasks 7 and 8 document and verify the running bridge.

Implementation caveats to resolve during execution:

- `src/codex.ts` starts with tolerant JSONL parsing. Task 4 includes a manual Codex JSONL check so exact event names can be tightened.
- `src/index.ts` routes notification payloads when they include `session_id` and `final_message`; Task 8 verifies the real payload shape so extraction can be adjusted before completion.
- `/codex status` returns the mapped bridge session, Codex session, status, queue length, and last turn timestamp.
