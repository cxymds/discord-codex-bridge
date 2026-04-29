# Discord-Codex Bridge Design

Date: 2026-04-29
Status: Approved for planning

## Goal

Build a local bridge service that connects Codex sessions to Discord. The first version should let the user manage Codex from one Discord channel while still allowing normal Codex use locally.

The bridge will:

- Create one Discord thread for each Codex session.
- Let Discord create new Codex sessions.
- Let messages inside a Discord thread continue the mapped Codex session.
- Send Codex turn results back to the mapped Discord thread.
- Send an explicit final summary when the user closes a session.

## Scope

In scope:

- A local Discord bot process.
- One configured Discord guild and one configured channel, such as `#codex`.
- Discord threads as the session UI.
- A local SQLite mapping store.
- Codex CLI integration for creating and continuing sessions.
- Codex `turn-ended` notification integration for pushing final turn output to Discord.
- Per-session message queueing so one Codex session is not driven concurrently.
- Basic authorization by Discord user id or role id.

Out of scope for the first version:

- Full replacement of the Codex Desktop UI.
- Multi-server Discord support.
- Public bot hosting.
- Rich web dashboard.
- Perfect two-way sync of every intermediate Codex event.
- Automatic long-term archival beyond Discord threads and the local SQLite store.

## User Experience

The bot works only in one configured Discord channel.

### New Session

The user runs:

```text
/codex new <prompt>
```

The bot creates a Discord thread under the configured channel, starts a new Codex session with the prompt, stores the mapping, and posts the Codex reply in the thread.

### Continue Session

Inside a mapped Discord thread, the user sends a normal message.

The bot looks up the thread mapping and sends the message to the mapped Codex session. When Codex finishes the turn, the result is posted back into the same thread.

### Close Session

Inside a mapped Discord thread, the user runs:

```text
/codex done
```

The bot marks the session as closed, asks Codex for a concise final summary, posts that final summary to the thread, and prevents further normal messages from driving the closed session unless the user explicitly reopens or forks it in a later version.

### Status

The user can run:

```text
/codex status
```

The bot reports the mapped Codex session id, current bridge state, pending queue length, and last successful sync time.

## Architecture

Use Node.js with TypeScript. Discord bot support is mature in Node, and TypeScript gives useful guardrails around command payloads, stored mappings, and Codex process results.

Main modules:

- `src/index.ts`: process entrypoint, config loading, service startup and shutdown.
- `src/config.ts`: environment parsing and validation.
- `src/bot.ts`: Discord client, slash commands, thread event handling, message filtering.
- `src/codex.ts`: Codex CLI wrapper for new sessions, resumed sessions, final summaries, and session id discovery.
- `src/store.ts`: SQLite schema and repository functions.
- `src/queue.ts`: per-session execution queue.
- `src/notify.ts`: HTTP endpoint or local command endpoint for Codex `turn-ended` notifications.
- `src/format.ts`: Discord-safe message chunking and formatting.
- `src/authz.ts`: Discord user and role authorization checks.

## Data Model

SQLite tables:

### `sessions`

- `id`: bridge-generated id.
- `codex_session_id`: Codex session id once known.
- `discord_guild_id`: configured guild id.
- `discord_channel_id`: configured parent channel id.
- `discord_thread_id`: thread id.
- `title`: display title.
- `status`: `active`, `running`, `queued`, `closed`, or `error`.
- `created_at`: ISO timestamp.
- `updated_at`: ISO timestamp.
- `last_turn_at`: ISO timestamp.
- `closed_at`: ISO timestamp or null.

### `events`

- `id`: event id.
- `session_id`: bridge session id.
- `source`: `discord`, `codex`, or `system`.
- `kind`: `new`, `message`, `turn_result`, `summary`, `error`, or `status_change`.
- `payload_json`: event payload.
- `created_at`: ISO timestamp.

The store is the source of truth for Discord-to-Codex mapping. Codex's own `~/.codex/session_index.jsonl` and logs can be read for discovery, but the bridge does not treat them as its primary state.

## Codex Integration

The local Codex CLI is available at:

```text
/Applications/Codex.app/Contents/Resources/codex
```

The CLI supports `exec`, `resume`, and `fork`. The bridge will wrap these commands rather than automate the desktop window.

Expected operations:

- Start a new session with `codex exec` or an equivalent non-interactive invocation.
- Continue an existing session with `codex resume <session>` if the installed CLI supports direct session ids; otherwise use the most reliable supported resume mechanism discovered during implementation.
- Generate a final summary by sending a summary prompt to the mapped session before closing it.
- Parse or discover the session id from Codex output, `session_index.jsonl`, or another stable local source.

Implementation must verify the exact resume/session-id behavior before relying on it. If the installed CLI cannot resume by id non-interactively, the first implementation plan must include a fallback such as storing enough context in the bridge to use `codex exec` for Discord-driven sessions while still posting local Codex `turn-ended` results when available.

## Notification Integration

The user's current Codex config has a `notify` command for `turn-ended`. The bridge will integrate with that notification path.

Target behavior:

- When Codex finishes a turn, Codex invokes a bridge notification command or script.
- The bridge receives the turn-ended payload or derives the latest turn details from local Codex state.
- The bridge resolves the Codex session id to a Discord thread.
- The bridge posts the final turn result to the thread.

Because Codex notification payload details may vary by version, implementation must first capture and inspect an actual notification payload. The design allows two compatible mechanisms:

- A small executable script configured in `~/.codex/config.toml` that forwards notification data to the bridge.
- A local HTTP endpoint exposed by the bridge, called by the notification script.

The bridge must preserve the user's existing Computer Use notification behavior if still desired. If the Codex config allows only one notify command, the bridge notification script should fan out to both the existing notifier and Discord bridge.

## Discord Integration

Use slash commands for explicit actions and message listeners for thread continuation.

Commands:

- `/codex new prompt:<text>`: create a session and thread.
- `/codex done`: close the current mapped thread and post final summary.
- `/codex status`: show mapping and queue state.

Message handling:

- Ignore bot messages.
- Ignore messages outside the configured channel and its managed threads.
- In a mapped thread, authorized user messages enqueue a Codex turn.
- If the session is already running, the bot acknowledges that the message was queued.

Thread naming:

- Use a short title derived from the initial prompt.
- Include a stable bridge id or Codex short id if helpful for debugging.

## Authorization

The bridge controls a local Codex process, so Discord access must be restricted.

Configurable authorization:

- `DISCORD_ALLOWED_USER_IDS`: comma-separated user ids.
- `DISCORD_ALLOWED_ROLE_IDS`: comma-separated role ids.

At least one allowed user id or role id is required. Unauthorized commands and messages receive a short denial response and are not sent to Codex.

## Configuration

Environment variables:

- `DISCORD_TOKEN`: bot token.
- `DISCORD_APPLICATION_ID`: application id for command registration.
- `DISCORD_GUILD_ID`: guild id.
- `DISCORD_CHANNEL_ID`: parent channel id for sessions.
- `DISCORD_ALLOWED_USER_IDS`: authorized users.
- `DISCORD_ALLOWED_ROLE_IDS`: authorized roles.
- `CODEX_BIN`: defaults to `/Applications/Codex.app/Contents/Resources/codex`.
- `CODEX_HOME`: defaults to `~/.codex`.
- `BRIDGE_DB_PATH`: defaults to `./data/bridge.sqlite`.
- `BRIDGE_NOTIFY_PORT`: local-only port for notification forwarding.

Secrets belong in `.env`, which must be gitignored.

## Error Handling

- If Codex command execution fails, post a concise error in the thread and store an `error` event.
- If Discord posting fails, keep the event in SQLite with an error status so it can be retried manually.
- If notification arrives for an unknown Codex session, store it as an unmapped event and log it for diagnosis.
- If a message exceeds Discord limits, split it into ordered chunks.
- If the bridge starts while sessions are running, it loads active mappings from SQLite and resumes listening.

## Testing

Automated tests:

- Config validation.
- Store schema and mapping lookups.
- Authorization checks.
- Discord message formatting and chunking.
- Queue ordering for a single session.
- Codex CLI wrapper command construction with a mocked process runner.
- Notification routing with sample payload fixtures.

Manual verification:

- Register slash commands in the configured guild.
- Run `/codex new`.
- Confirm a Discord thread is created.
- Confirm a Codex result appears in the thread.
- Send a follow-up message in the thread and confirm it continues the session.
- Trigger a local Codex turn and confirm the turn-ended notification reaches Discord.
- Run `/codex done` and confirm the final summary is posted and the session status becomes closed.

## Risks and Open Implementation Checks

- Codex CLI resume-by-id behavior must be verified on this machine.
- Codex `turn-ended` notification payload must be captured before finalizing the notification adapter.
- Existing Codex notification behavior should not be broken accidentally.
- Discord bot permissions must include creating public/private threads, sending messages in threads, reading messages, and using slash commands.
- Long Codex runs need visible Discord feedback so the user knows work is still running.

## Acceptance Criteria

- A configured Discord channel can create a new Codex session with `/codex new`.
- The bridge creates one Discord thread per Codex session.
- Messages in that thread continue the mapped session.
- Codex final turn output appears in the mapped Discord thread.
- `/codex done` posts a final summary and marks the session closed.
- Unauthorized Discord users cannot invoke Codex.
- Session mappings survive bridge restart.
