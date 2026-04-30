import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_CHANNEL_ID: z.string().min(1),
  DISCORD_ALLOWED_USER_IDS: z.string().default(""),
  DISCORD_ALLOWED_ROLE_IDS: z.string().default(""),
  DISCORD_PROXY_URL: z.string().optional(),
  BRIDGE_PROJECT_NAME: z.string().default("discord-codex-bridge"),
  CODEX_BIN: z.string().default("/Applications/Codex.app/Contents/Resources/codex"),
  CODEX_HOME: z.string().default(`${process.env.HOME ?? ""}/.codex`),
  BRIDGE_DB_PATH: z.string().default("./data/bridge.sqlite"),
  BRIDGE_NOTIFY_HOST: z.string().default("127.0.0.1"),
  BRIDGE_NOTIFY_PORT: z.coerce.number().int().positive().default(43765),
  BRIDGE_PUBLIC_BASE_URL: z.string().optional()
});

export interface BridgeConfig {
  projectName: string;
  discordToken: string;
  discordApplicationId: string;
  discordGuildId: string;
  discordChannelId: string;
  allowedUserIds: string[];
  allowedRoleIds: string[];
  discordProxyUrl: string | null;
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
    projectName: parsed.BRIDGE_PROJECT_NAME,
    discordApplicationId: parsed.DISCORD_APPLICATION_ID,
    discordGuildId: parsed.DISCORD_GUILD_ID,
    discordChannelId: parsed.DISCORD_CHANNEL_ID,
    allowedUserIds,
    allowedRoleIds,
    discordProxyUrl: parsed.DISCORD_PROXY_URL ?? null,
    codexBin: parsed.CODEX_BIN,
    codexHome: parsed.CODEX_HOME,
    dbPath: parsed.BRIDGE_DB_PATH,
    notifyHost: parsed.BRIDGE_NOTIFY_HOST,
    notifyPort: parsed.BRIDGE_NOTIFY_PORT,
    publicBaseUrl: parsed.BRIDGE_PUBLIC_BASE_URL ?? `http://${parsed.BRIDGE_NOTIFY_HOST}:${parsed.BRIDGE_NOTIFY_PORT}`
  };
}
