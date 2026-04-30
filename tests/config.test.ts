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
    DISCORD_PROXY_URL: "http://127.0.0.1:7897",
    CODEX_BIN: "/Applications/Codex.app/Contents/Resources/codex",
    CODEX_HOME: "/Users/cxymds/.codex",
    BRIDGE_WORKSPACE_PATH: "/Users/cxymds/Documents/KAI",
    BRIDGE_DB_PATH: "./data/bridge.sqlite",
    BRIDGE_NOTIFY_HOST: "127.0.0.1",
    BRIDGE_NOTIFY_PORT: "43765"
  };

  it("parses comma-separated allow lists", () => {
    const config = loadConfigFromEnv(validEnv);
    expect(config.allowedUserIds).toEqual(["u1", "u2"]);
    expect(config.allowedRoleIds).toEqual([]);
    expect(config.discordProxyUrl).toBe("http://127.0.0.1:7897");
    expect(config.workspacePath).toBe("/Users/cxymds/Documents/KAI");
    expect(config.notifyPort).toBe(43765);
  });

  it("derives the public base URL from notify host and port when omitted", () => {
    const config = loadConfigFromEnv({
      ...validEnv,
      BRIDGE_NOTIFY_HOST: "0.0.0.0",
      BRIDGE_NOTIFY_PORT: "5000"
    });

    expect(config.publicBaseUrl).toBe("http://0.0.0.0:5000");
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
