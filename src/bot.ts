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
import { chunkDiscordMessage, makeProjectThreadTitle } from "./format.js";
import type { BridgeConfig } from "./config.js";
import type { createCodexClient } from "./codex.js";
import type { SessionQueue } from "./queue.js";
import type { createStore } from "./store.js";

type Store = ReturnType<typeof createStore>;
type CodexClient = ReturnType<typeof createCodexClient>;

interface MinimalConfig {
  projectName: string;
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

  async function reportCodexError(sessionId: string, threadId: string, error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown Codex error";
    deps.store.updateSessionStatus(sessionId, "error");
    deps.store.recordEvent({ sessionId, source: "system", kind: "error", payload: { message } });
    await deps.discord.postMessage(threadId, `Codex run failed: ${message}`);
  }

  return {
    async handleNewCommand(input: { userId: string; roleIds: string[]; prompt: string }) {
      assertAuthorized(input.userId, input.roleIds);
      const title = makeProjectThreadTitle(deps.config.projectName, input.prompt);
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
        try {
          const result = await deps.codex.start(input.prompt);
          if (result.sessionId) deps.store.setCodexSessionId(session.id, result.sessionId);
          deps.store.markTurn(session.id);
          deps.store.updateSessionStatus(session.id, "active");
          deps.store.recordEvent({ sessionId: session.id, source: "codex", kind: "turn_result", payload: result });
          await postLong(thread.id, result.finalMessage);
        } catch (error) {
          await reportCodexError(session.id, thread.id, error);
          throw error;
        }
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
        try {
          const result = await deps.codex.resume(session.codexSessionId!, input.content);
          deps.store.markTurn(session.id);
          deps.store.updateSessionStatus(session.id, "active");
          deps.store.recordEvent({ sessionId: session.id, source: "codex", kind: "turn_result", payload: result });
          await postLong(input.threadId, result.finalMessage);
        } catch (error) {
          await reportCodexError(session.id, input.threadId, error);
          throw error;
        }
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

export function roleIdsFromInteractionMember(member: unknown): string[] {
  if (!member || typeof member !== "object" || !("roles" in member)) {
    return [];
  }

  const roles = (member as { roles?: unknown }).roles;
  if (Array.isArray(roles)) {
    return roles.map(String);
  }

  if (roles && typeof roles === "object" && "cache" in roles) {
    const cache = (roles as { cache?: unknown }).cache;
    if (cache && typeof cache === "object" && "keys" in cache && typeof cache.keys === "function") {
      return [...cache.keys()].map(String);
    }
  }

  return [];
}

function roleIdsFromInteraction(interaction: ChatInputCommandInteraction): string[] {
  return roleIdsFromInteractionMember(interaction.member);
}

function roleIdsFromMessage(message: Message): string[] {
  const roles = message.member?.roles.cache;
  return roles ? [...roles.keys()] : [];
}

export function isConfiguredCommandChannel(config: Pick<MinimalConfig, "discordChannelId">, channelId: string): boolean {
  return channelId === config.discordChannelId;
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
        if (!isConfiguredCommandChannel(config, interaction.channelId)) {
          await interaction.reply({ ephemeral: true, content: "Use /codex new in the configured Discord channel." });
          return;
        }
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
    if (message.author.bot || (message.channel.type !== ChannelType.PublicThread && message.channel.type !== ChannelType.PrivateThread)) return;
    await handlers.handleThreadMessage({
      userId: message.author.id,
      roleIds: roleIdsFromMessage(message),
      threadId: message.channelId,
      content: message.content
    });
  });

  return client;
}
