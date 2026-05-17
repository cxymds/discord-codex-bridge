# Discord Codex Bridge Improvement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the existing Discord Codex Bridge into a more reliable, observable, and safer daily-use service without changing its core local-first architecture.

**Architecture:** Keep the current TypeScript Node service, SQLite store, Discord slash command interface, Codex CLI wrapper, Codex Desktop app-server adapter, per-session queue, and local notify endpoint. Add small, testable capabilities around diagnostics, retry state, Discord UX, config validation, and docs rather than replacing the working bridge.

**Tech Stack:** Node.js 22+, TypeScript, discord.js, better-sqlite3, Fastify, Vitest, launchd scripts, Codex CLI / Codex Desktop app-server.

---

## Current Baseline

The bridge already supports:

- `/codex new project:<project> prompt:<prompt>` with project path resolution.
- Project aliases through `/codex project add/list/remove`.
- Project autocomplete from registered projects and Codex session history.
- One Discord thread per bridge session.
- Per-session serialized message handling.
- SQLite persistence for sessions, events, and projects.
- Codex CLI start/resume/summarize integration.
- Codex Desktop app-server delivery with CLI fallback.
- Codex `turn-ended` notify forwarding through a local Fastify endpoint.
- macOS launchd service install/start/stop/restart/status scripts.
- Unit tests across config, bot handlers, queue, store, notify, project discovery, Desktop delivery, and formatting.

Known improvement areas:

- Operators need better visibility into bridge health and recent errors.
- Failed Discord posts and notify events are recorded inconsistently and are not easy to retry.
- Discord UX has little progress feedback for queued/running work.
- Security controls are allowlist-based but lack audit-friendly messaging and safer command defaults.
- Documentation was refreshed in `README.md`, but `docs/discord-setup.md` is stale.
- There is no CI workflow to protect future changes.

## Principles

- Keep changes incremental and reversible.
- Add tests before behavior changes.
- Avoid large rewrites of `src/bot.ts` or `src/index.ts` unless a task explicitly creates a smaller boundary first.
- Preserve local-only defaults for notify and Codex access.
- Treat Discord as a remote command surface for the local machine; new features must not broaden access silently.

## Phase 1: Health, Diagnostics, and Operator Visibility

**Outcome:** An authorized user can quickly answer "is the bridge healthy, what mode is it using, and what failed recently?"

**Files:**

- Modify: `src/types.ts`
- Modify: `src/store.ts`
- Modify: `src/bot.ts`
- Modify: `src/index.ts`
- Test: `tests/store.test.ts`
- Test: `tests/bot.test.ts`
- Docs: `README.md`

### Task 1.1: Add Recent Event Queries

- [ ] Add `Store.listRecentEvents(limit: number)` returning newest events first.
- [ ] Add `Store.listRecentErrors(limit: number)` filtering `source = "system"` or `kind = "error"`.
- [ ] Test that the methods respect limits, ordering, and JSON payload parsing.
- [ ] Keep existing event insertion format unchanged.

### Task 1.2: Add `/codex health`

- [ ] Extend `buildSlashCommands()` with `/codex health`.
- [ ] Add `handleHealthCommand()` in `createBridgeHandlers()`.
- [ ] Include bridge health fields:
  - configured guild id
  - configured command channel id
  - turn delivery mode
  - pending queue count total
  - active mapped session count
  - last error summary, if any
- [ ] Return an ephemeral Discord reply.
- [ ] Test authorized and unauthorized behavior.

### Task 1.3: Surface Startup Mode in Logs

- [ ] Add a concise startup log after Discord login with:
  - notify URL
  - `CODEX_TURN_DELIVERY`
  - Desktop socket path
  - whether app-server auto-start is enabled
  - DB path
- [ ] Do not log Discord token, allowlists, prompts, or message bodies.
- [ ] Update README troubleshooting to mention `/codex health`.

**Verification:**

```bash
npm test -- tests/store.test.ts tests/bot.test.ts
npm run build
```

## Phase 2: Retryable Delivery and Notify Robustness

**Outcome:** Discord delivery failures and notify routing failures are visible and retryable rather than disappearing into logs.

**Files:**

- Modify: `src/types.ts`
- Modify: `src/store.ts`
- Modify: `src/notify.ts`
- Modify: `src/notifyTurnEnded.ts`
- Modify: `src/bot.ts`
- Test: `tests/store.test.ts`
- Test: `tests/notify.test.ts`
- Test: `tests/notifyTurnEnded.test.ts`
- Test: `tests/bot.test.ts`

### Task 2.1: Track Delivery State for Outbound Discord Messages

- [ ] Add an `outbox` table with:
  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `session_id TEXT`
  - `discord_thread_id TEXT NOT NULL`
  - `content TEXT NOT NULL`
  - `status TEXT NOT NULL`
  - `attempts INTEGER NOT NULL`
  - `last_error TEXT`
  - `created_at TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`
- [ ] Add store methods:
  - `createOutboxMessage(sessionId, threadId, content)`
  - `markOutboxSent(id)`
  - `markOutboxFailed(id, error)`
  - `listFailedOutbox(limit)`
  - `listPendingOutbox(limit)`
- [ ] Test insert, sent, failed, retry listing, and ordering.

### Task 2.2: Route `postLong()` Through the Outbox

- [ ] Replace direct chunk posting inside bridge handlers with outbox-backed sending.
- [ ] For each chunk, create an outbox row before posting.
- [ ] Mark the row sent after Discord accepts it.
- [ ] Mark the row failed if Discord posting throws, then rethrow for current error handling.
- [ ] Keep Discord message chunking behavior unchanged.

### Task 2.3: Add `/codex retry`

- [ ] Add `/codex retry` for the current thread.
- [ ] Retry failed outbox messages for that thread in creation order.
- [ ] Return an ephemeral summary: attempted count, sent count, failed count.
- [ ] Test that retries only affect the current mapped thread.

### Task 2.4: Harden Notify Endpoint Responses

- [ ] Wrap `onTurnEnded` failures in `startNotifyServer()` so the HTTP response includes `{ ok: false, error: string }` with a non-2xx status.
- [ ] Record unknown or unrouteable notify payloads as events with enough metadata for diagnosis.
- [ ] Add tests for successful notify, handler failure, and unknown session behavior.

**Verification:**

```bash
npm test -- tests/store.test.ts tests/notify.test.ts tests/notifyTurnEnded.test.ts tests/bot.test.ts
npm run build
```

## Phase 3: Better Discord Session UX

**Outcome:** Users get clear feedback when work starts, queues, completes, or fails, without spamming threads.

**Files:**

- Modify: `src/queue.ts`
- Modify: `src/bot.ts`
- Modify: `src/format.ts`
- Test: `tests/queue.test.ts`
- Test: `tests/bot.test.ts`
- Test: `tests/format.test.ts`
- Docs: `README.md`

### Task 3.1: Add Queue Position Feedback

- [ ] When a thread message is accepted while a session is running, post a short queued acknowledgement.
- [ ] Include the pending count from `SessionQueue.pendingCount(session.id)`.
- [ ] Avoid acknowledgements for the first message that starts immediately.
- [ ] Test queued and non-queued paths.

### Task 3.2: Add Running and Failed Status Messages

- [ ] For `/codex new`, post an initial thread message before Codex starts: `Codex is working on this request...`.
- [ ] For thread continuations, post a short "working" message only when the queue was previously empty.
- [ ] Keep failure messages concise and avoid leaking stack traces.
- [ ] Test that errors still update session status to `error`.

### Task 3.3: Improve `/codex status`

- [ ] Include project path when known.
- [ ] Include whether the current session is running or queued.
- [ ] Include failed outbox count after Phase 2.
- [ ] Include last turn timestamp and closed timestamp when present.
- [ ] Test status output for active, running, queued, closed, and unmapped threads.

**Verification:**

```bash
npm test -- tests/queue.test.ts tests/bot.test.ts tests/format.test.ts
npm run build
```

## Phase 4: Security and Configuration Hardening

**Outcome:** Risky local-machine controls are explicit, auditable, and harder to enable by accident.

**Files:**

- Modify: `src/config.ts`
- Modify: `src/authz.ts`
- Modify: `src/bot.ts`
- Modify: `.env.example`
- Test: `tests/config.test.ts`
- Test: `tests/authz.test.ts`
- Test: `tests/bot.test.ts`
- Docs: `README.md`

### Task 4.1: Add Explicit Full-Access Confirmation

- [ ] Add env var `CODEX_FULL_ACCESS_CONFIRM`.
- [ ] If `CODEX_FULL_ACCESS=true`, require `CODEX_FULL_ACCESS_CONFIRM=I_UNDERSTAND_DISCORD_CAN_RUN_LOCAL_COMMANDS`.
- [ ] Fail config loading with a direct error if confirmation is missing.
- [ ] Test accepted and rejected combinations.
- [ ] Document the exact confirmation string in README.

### Task 4.2: Restrict Project Paths to Allowed Roots

- [ ] Add env var `BRIDGE_ALLOWED_PROJECT_ROOTS`.
- [ ] Parse it as comma-separated absolute paths.
- [ ] If set, require `/codex new` and `/codex project add` paths to resolve under one of those roots.
- [ ] Keep current behavior when the variable is empty.
- [ ] Test allowed root, rejected sibling path, absolute path, relative path under `BRIDGE_WORKSPACE_PATH`, and project alias behavior.

### Task 4.3: Add Audit Events for Authorization Failures

- [ ] Record an event when an unauthorized command or thread message is rejected.
- [ ] Include Discord user id, role ids, command/message type, and channel/thread id.
- [ ] Do not include prompt or message content in unauthorized audit events.
- [ ] Show recent authorization failures in `/codex health`.
- [ ] Test that unauthorized content is not stored.

**Verification:**

```bash
npm test -- tests/config.test.ts tests/authz.test.ts tests/bot.test.ts
npm run build
```

## Phase 5: Documentation and CI

**Outcome:** The repo has one accurate setup path and automated checks for future pushes.

**Files:**

- Modify: `docs/discord-setup.md`
- Modify: `README.md`
- Create: `.github/workflows/ci.yml`
- Test: local command verification

### Task 5.1: Fix `docs/discord-setup.md`

- [ ] Update slash command examples to include required `project`.
- [ ] Replace stale notify path with `/Users/cxymds/Documents/discord-codex-bridge/scripts/codex-discord-notify.mjs`.
- [ ] Add links back to the canonical README sections instead of duplicating every environment variable.
- [ ] Keep the doc as a concise Discord-specific checklist.

### Task 5.2: Add GitHub Actions CI

- [ ] Create `.github/workflows/ci.yml`.
- [ ] Run on push and pull request to `main`.
- [ ] Use Node.js 22.
- [ ] Run:
  - `npm ci`
  - `npm run build`
  - `npm test`
- [ ] Keep secrets out of CI.

### Task 5.3: Add Release Checklist

- [ ] Add a README section or `docs/release-checklist.md`.
- [ ] Include:
  - `npm test`
  - `npm run build`
  - launchd reinstall/restart command
  - Discord `/codex health`
  - one manual `/codex new` smoke test
  - one thread continuation smoke test

**Verification:**

```bash
npm run build
npm test
```

## Recommended Execution Order

1. Phase 1 first because diagnostics reduce risk for every later phase.
2. Phase 5 can run in parallel with Phase 1 if handled by a separate worker, because it mostly touches docs and CI.
3. Phase 2 before Phase 3, because better UX should build on retryable message delivery.
4. Phase 4 after Phase 2 and Phase 3, because path restrictions and audit events touch command handling and status/health surfaces.

## Acceptance Criteria

- `/codex health` gives useful operational status without exposing secrets.
- Failed Discord delivery can be listed and retried from Discord.
- Notify handler failures return clear HTTP errors and leave diagnostic records.
- Users see concise queue/running/failure feedback in Discord threads.
- Full access mode requires an explicit confirmation variable.
- Optional allowed project roots prevent accidental access outside configured directories.
- `docs/discord-setup.md` no longer contains stale paths or obsolete slash command examples.
- CI runs build and tests on GitHub.
- `npm run build` and `npm test` pass after each phase.

## Deferred Ideas

These are intentionally outside this plan:

- Multi-guild or multi-channel support.
- Public hosted bot mode.
- Web dashboard.
- Rich Discord embeds and buttons.
- Streaming intermediate Codex events.
- Long-term transcript archival beyond SQLite and Discord threads.
