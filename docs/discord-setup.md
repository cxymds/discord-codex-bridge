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
