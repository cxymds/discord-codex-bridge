import "dotenv/config";
import { ChannelType, type NewsChannel, type TextChannel } from "discord.js";
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

let client: ReturnType<typeof createDiscordClient>;

const discordPort = {
  async createThread(channelId: string, title: string) {
    const channel = await client.channels.fetch(channelId);
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
      throw new Error(`Discord channel ${channelId} cannot create threads`);
    }
    const threadableChannel = channel as TextChannel | NewsChannel;
    const thread = await threadableChannel.threads.create({ name: title, autoArchiveDuration: 1440 });
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
client = createDiscordClient(config, handlers);

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
  client.destroy();
  store.close();
}

process.once("SIGINT", () => {
  shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  shutdown().finally(() => process.exit(0));
});
