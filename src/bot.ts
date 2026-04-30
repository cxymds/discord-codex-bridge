import {
  ChannelType,
  Client,
  GatewayIntentBits,
  RESTJSONErrorCodes,
  REST,
  Routes,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Message
} from "discord.js";
import { existsSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { isAuthorized } from "./authz.js";
import { chunkDiscordMessage, makeProjectThreadTitle } from "./format.js";
import type { BridgeConfig } from "./config.js";
import type { createCodexClient } from "./codex.js";
import { discoverCodexProjects, formatProjectChoices, mergeProjectChoices } from "./projects.js";
import type { SessionQueue } from "./queue.js";
import type { createStore } from "./store.js";
import type { ProjectChoice } from "./types.js";

type Store = ReturnType<typeof createStore>;
type CodexClient = ReturnType<typeof createCodexClient>;

interface MinimalConfig {
  discordGuildId: string;
  discordChannelId: string;
  allowedUserIds: string[];
  allowedRoleIds: string[];
  workspacePath: string | null;
  codexHome?: string;
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
  projectExists?: (projectPath: string) => boolean;
  discoverProjects?: () => ProjectChoice[];
}

export function createBridgeHandlers(deps: HandlerDeps) {
  const projectExists = deps.projectExists ?? existsSync;
  const discoverProjects = deps.discoverProjects ?? (() => discoverCodexProjects(deps.config.codexHome ?? ""));

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

  function resolveProjectPath(project: string): string {
    const trimmedProject = project.trim();
    if (!trimmedProject) {
      throw new Error("Project path is required");
    }
    if (!isAbsolute(trimmedProject)) {
      const registeredProject = deps.store.findProjectByName(trimmedProject);
      if (registeredProject) {
        return resolve(registeredProject.path);
      }

      const discoveredMatches = discoverProjects().filter((choice) => choice.name === trimmedProject);
      if (discoveredMatches.length === 1) {
        return resolve(discoveredMatches[0].path);
      }
    }
    const basePath = isAbsolute(trimmedProject) ? trimmedProject : resolve(deps.config.workspacePath ?? process.cwd(), trimmedProject);
    return resolve(basePath);
  }

  function assertProjectPath(projectPath: string): void {
    if (!projectExists(projectPath)) {
      throw new Error(`Project path does not exist: ${projectPath}`);
    }
  }

  return {
    async handleNewCommand(input: { userId: string; roleIds: string[]; project: string; prompt: string }) {
      assertAuthorized(input.userId, input.roleIds);
      const projectPath = resolveProjectPath(input.project);
      assertProjectPath(projectPath);
      const title = makeProjectThreadTitle(basename(projectPath), input.prompt);
      const thread = await deps.discord.createThread(deps.config.discordChannelId, title);
      const session = deps.store.createSession({
        codexSessionId: null,
        discordGuildId: deps.config.discordGuildId,
        discordChannelId: deps.config.discordChannelId,
        discordThreadId: thread.id,
        projectPath,
        title
      });

      deps.store.recordEvent({ sessionId: session.id, source: "discord", kind: "new", payload: { project: projectPath, prompt: input.prompt } });
      await deps.queue.enqueue(session.id, async () => {
        deps.store.updateSessionStatus(session.id, "running");
        try {
          const result = await deps.codex.startInProject(projectPath, input.prompt);
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

    async handleProjectAddCommand(input: { userId: string; roleIds: string[]; name: string; path: string }) {
      assertAuthorized(input.userId, input.roleIds);
      const name = input.name.trim();
      if (!name) {
        throw new Error("Project name is required");
      }
      const projectPath = resolve(input.path);
      assertProjectPath(projectPath);
      deps.store.upsertProject({ name, path: projectPath });
      return `Project registered: ${name} -> ${projectPath}`;
    },

    async handleProjectListCommand(input: { userId: string; roleIds: string[] }) {
      assertAuthorized(input.userId, input.roleIds);
      const projects = deps.store.listProjects();
      if (projects.length === 0) {
        return "No registered projects.";
      }
      return projects.map((project) => `${project.name} -> ${project.path}`).join("\n");
    },

    async handleProjectRemoveCommand(input: { userId: string; roleIds: string[]; name: string }) {
      assertAuthorized(input.userId, input.roleIds);
      const removed = deps.store.removeProject(input.name.trim());
      return removed ? `Project removed: ${input.name.trim()}` : `Project not found: ${input.name.trim()}`;
    },

    async handleProjectAutocomplete(input: { query: string }) {
      const registeredChoices: ProjectChoice[] = deps.store.listProjects().map((project) => ({ name: project.name, path: project.path, source: "registered" }));
      return formatProjectChoices(mergeProjectChoices(registeredChoices, discoverProjects()), input.query);
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
          const projectPath = session.projectPath ?? process.cwd();
          const result = await deps.codex.resumeInProject(projectPath, session.codexSessionId!, input.content);
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
          .addStringOption((option) =>
            option.setName("project").setDescription("Project name or path for this Codex session").setRequired(true).setAutocomplete(true)
          )
          .addStringOption((option) => option.setName("prompt").setDescription("Initial prompt").setRequired(true))
      )
      .addSubcommandGroup((group) =>
        group
          .setName("project")
          .setDescription("Manage Codex project aliases")
          .addSubcommand((sub) =>
            sub
              .setName("add")
              .setDescription("Register a project alias")
              .addStringOption((option) => option.setName("name").setDescription("Project name used in /codex new").setRequired(true))
              .addStringOption((option) => option.setName("path").setDescription("Absolute project path").setRequired(true))
          )
          .addSubcommand((sub) => sub.setName("list").setDescription("List registered project aliases"))
          .addSubcommand((sub) =>
            sub
              .setName("remove")
              .setDescription("Remove a project alias")
              .addStringOption((option) => option.setName("name").setDescription("Project name").setRequired(true).setAutocomplete(true))
          )
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

function roleIdsFromAutocomplete(interaction: AutocompleteInteraction): string[] {
  return roleIdsFromInteractionMember(interaction.member);
}

function roleIdsFromMessage(message: Message): string[] {
  const roles = message.member?.roles.cache;
  return roles ? [...roles.keys()] : [];
}

export function isConfiguredCommandChannel(config: Pick<MinimalConfig, "discordChannelId">, channelId: string): boolean {
  return channelId === config.discordChannelId;
}

export function isSupportedThreadChannelType(type: ChannelType): boolean {
  return type === ChannelType.PublicThread || type === ChannelType.PrivateThread || type === ChannelType.AnnouncementThread;
}

export function createDiscordClient(config: BridgeConfig, handlers: ReturnType<typeof createBridgeHandlers>) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
  });

  client.on("interactionCreate", async (interaction) => {
    if (interaction.isAutocomplete() && interaction.commandName === "codex") {
      let choices: Parameters<AutocompleteInteraction["respond"]>[0] = [];
      try {
        assertAutocompleteAuthorized(interaction, config);
        const focused = interaction.options.getFocused(true);
        if (focused.name === "project" || focused.name === "name") {
          choices = await handlers.handleProjectAutocomplete({ query: String(focused.value ?? "") });
        }
      } catch (error) {
        if (isExpiredInteractionError(error)) return;
        choices = [];
      }

      try {
        await interaction.respond(choices);
      } catch (error) {
        if (!isExpiredInteractionError(error)) throw error;
      }
      return;
    }

    if (!interaction.isChatInputCommand() || interaction.commandName !== "codex") return;
    try {
      const subcommand = interaction.options.getSubcommand();
      const group = interaction.options.getSubcommandGroup(false);
      if (group === "project") {
        await interaction.deferReply({ ephemeral: true });
        if (subcommand === "add") {
          await interaction.editReply(
            await handlers.handleProjectAddCommand({
              userId: interaction.user.id,
              roleIds: roleIdsFromInteraction(interaction),
              name: interaction.options.getString("name", true),
              path: interaction.options.getString("path", true)
            })
          );
        } else if (subcommand === "list") {
          await interaction.editReply(
            await handlers.handleProjectListCommand({
              userId: interaction.user.id,
              roleIds: roleIdsFromInteraction(interaction)
            })
          );
        } else if (subcommand === "remove") {
          await interaction.editReply(
            await handlers.handleProjectRemoveCommand({
              userId: interaction.user.id,
              roleIds: roleIdsFromInteraction(interaction),
              name: interaction.options.getString("name", true)
            })
          );
        }
      } else if (subcommand === "new") {
        if (!isConfiguredCommandChannel(config, interaction.channelId)) {
          await interaction.reply({ ephemeral: true, content: "Use /codex new in the configured Discord channel." });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        await handlers.handleNewCommand({
          userId: interaction.user.id,
          roleIds: roleIdsFromInteraction(interaction),
          project: interaction.options.getString("project", true),
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
    if (message.author.bot || !isSupportedThreadChannelType(message.channel.type)) return;
    await handlers.handleThreadMessage({
      userId: message.author.id,
      roleIds: roleIdsFromMessage(message),
      threadId: message.channelId,
      content: message.content
    });
  });

  return client;
}

function assertAutocompleteAuthorized(interaction: AutocompleteInteraction, config: BridgeConfig): void {
  if (!isAuthorized({ userId: interaction.user.id, roleIds: roleIdsFromAutocomplete(interaction) }, config.allowedUserIds, config.allowedRoleIds)) {
    throw new Error("Not authorized");
  }
}

function isExpiredInteractionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === RESTJSONErrorCodes.UnknownInteraction
  );
}
