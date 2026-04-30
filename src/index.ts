import "dotenv/config";
import type { NewsChannel, TextChannel } from "discord.js";
import { HttpsProxyAgent } from "https-proxy-agent";
import { createRequire } from "node:module";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { loadConfigFromEnv, type BridgeConfig } from "./config.js";
import { createStore } from "./store.js";
import { createCodexClient } from "./codex.js";
import { SessionQueue } from "./queue.js";
import { startNotifyServer } from "./notify.js";
import { chunkDiscordMessage } from "./format.js";
import { extractNotifyFields } from "./notifyPayload.js";
import {
  codexSessionIndexPath,
  createCodexSessionIndexPoller,
  findCodexSessionIndexEntry,
  syncCodexSessionToDiscord
} from "./sessionSync.js";

async function configureDiscordProxy(config: BridgeConfig) {
  if (!config.discordProxyUrl) {
    return;
  }

  setGlobalDispatcher(new ProxyAgent(config.discordProxyUrl));

  const require = createRequire(import.meta.url);
  const ws = require("ws") as typeof import("ws");
  const OriginalWebSocket = ws.WebSocket;
  const agent = new HttpsProxyAgent(config.discordProxyUrl);
  class ProxiedWebSocket extends OriginalWebSocket {
    constructor(address: ConstructorParameters<typeof OriginalWebSocket>[0], protocols?: ConstructorParameters<typeof OriginalWebSocket>[1], options: Record<string, unknown> = {}) {
      super(address, protocols, { ...options, agent });
    }
  }

  const patchedWs = ws as unknown as { WebSocket: unknown; default: unknown };
  patchedWs.WebSocket = ProxiedWebSocket;
  patchedWs.default = ProxiedWebSocket;
}

const config = loadConfigFromEnv();
await configureDiscordProxy(config);
const { ChannelType } = await import("discord.js");
const { createBridgeHandlers, createDiscordClient, registerCommands } = await import("./bot.js");
const store = createStore(config.dbPath);
const codex = createCodexClient({
  codexBin: config.codexBin,
  codexHome: config.codexHome,
  cwd: config.workspacePath
});
const queue = new SessionQueue();
const sessionIndexPath = codexSessionIndexPath(config.codexHome);

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
const sessionIndexPoller = createCodexSessionIndexPoller({
  indexPath: sessionIndexPath,
  projectName: config.projectName,
  discordGuildId: config.discordGuildId,
  discordChannelId: config.discordChannelId,
  store,
  discord: discordPort
});

const notifyServer = await startNotifyServer({
  host: config.notifyHost,
  port: config.notifyPort,
  onTurnEnded: async (payload) => {
    const fields = extractNotifyFields(payload);
    const session = fields.codexSessionId
      ? await syncCodexSessionToDiscord({
          entry: findCodexSessionIndexEntry(sessionIndexPath, fields.codexSessionId) ?? {
            id: fields.codexSessionId,
            threadName: "Codex session"
          },
          projectName: config.projectName,
          discordGuildId: config.discordGuildId,
          discordChannelId: config.discordChannelId,
          store,
          discord: discordPort,
          claimPendingDiscordSession: true
        })
      : null;
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
sessionIndexPoller.start();

console.log(`Discord-Codex bridge running. Notify endpoint: ${notifyServer.url}/notify/turn-ended`);

async function shutdown() {
  sessionIndexPoller.stop();
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
