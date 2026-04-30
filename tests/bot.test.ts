import { describe, expect, it, vi } from "vitest";
import { ChannelType } from "discord.js";
import { buildSlashCommands, createBridgeHandlers, isConfiguredCommandChannel, isSupportedThreadChannelType, roleIdsFromInteractionMember } from "../src/bot.js";

describe("createBridgeHandlers", () => {
  it("creates a session and posts the first Codex result", async () => {
    const createThread = vi.fn(async () => ({ id: "thread1", name: "Hello" }));
    const postMessage = vi.fn(async () => undefined);
    const store = {
      findProjectByName: vi.fn(() => null),
      createSession: vi.fn((input) => ({ id: "bridge1", ...input, status: "active", createdAt: "", updatedAt: "", lastTurnAt: null, closedAt: null })),
      setCodexSessionId: vi.fn(),
      updateSessionStatus: vi.fn(),
      markTurn: vi.fn(),
      recordEvent: vi.fn()
    };
    const codex = { startInProject: vi.fn(async () => ({ sessionId: "codex1", finalMessage: "done", rawEvents: [] })) };
    const handlers = createBridgeHandlers({
      config: { discordGuildId: "guild", discordChannelId: "channel", allowedUserIds: ["u1"], allowedRoleIds: [], workspacePath: null },
      store: store as never,
      codex: codex as never,
      queue: { enqueue: vi.fn((_id, work) => work()), pendingCount: vi.fn(() => 0) } as never,
      discord: { createThread, postMessage }
    });

    await handlers.handleNewCommand({ userId: "u1", roleIds: [], project: "/Users/cxymds/Documents/KAI/rustfs", prompt: "Hello" });

    expect(createThread).toHaveBeenCalledWith("channel", "[rustfs] Hello");
    expect(codex.startInProject).toHaveBeenCalledWith("/Users/cxymds/Documents/KAI/rustfs", "Hello");
    expect(postMessage).toHaveBeenCalledWith("thread1", "done");
  });

  it("resolves relative Discord project names from the configured workspace path", async () => {
    const createThread = vi.fn(async () => ({ id: "thread1", name: "Hello" }));
    const postMessage = vi.fn(async () => undefined);
    const store = {
      findProjectByName: vi.fn(() => null),
      createSession: vi.fn((input) => ({ id: "bridge1", ...input, status: "active", createdAt: "", updatedAt: "", lastTurnAt: null, closedAt: null })),
      setCodexSessionId: vi.fn(),
      updateSessionStatus: vi.fn(),
      markTurn: vi.fn(),
      recordEvent: vi.fn()
    };
    const codex = { startInProject: vi.fn(async () => ({ sessionId: "codex1", finalMessage: "done", rawEvents: [] })) };
    const handlers = createBridgeHandlers({
      config: {
        discordGuildId: "guild",
        discordChannelId: "channel",
        allowedUserIds: ["u1"],
        allowedRoleIds: [],
        workspacePath: "/Users/cxymds/Documents/KAI"
      },
      store: store as never,
      codex: codex as never,
      queue: { enqueue: vi.fn((_id, work) => work()), pendingCount: vi.fn(() => 0) } as never,
      discord: { createThread, postMessage },
      projectExists: vi.fn(() => true)
    });

    await handlers.handleNewCommand({ userId: "u1", roleIds: [], project: "rustfs", prompt: "Hello" });

    expect(createThread).toHaveBeenCalledWith("channel", "[rustfs] Hello");
    expect(codex.startInProject).toHaveBeenCalledWith("/Users/cxymds/Documents/KAI/rustfs", "Hello");
  });

  it("resolves registered project aliases before workspace paths", async () => {
    const createThread = vi.fn(async () => ({ id: "thread1", name: "Hello" }));
    const postMessage = vi.fn(async () => undefined);
    const store = {
      findProjectByName: vi.fn(() => ({ name: "rustfs", path: "/Users/cxymds/Documents/KAI/rustfs-real", createdAt: "", updatedAt: "" })),
      createSession: vi.fn((input) => ({ id: "bridge1", ...input, status: "active", createdAt: "", updatedAt: "", lastTurnAt: null, closedAt: null })),
      setCodexSessionId: vi.fn(),
      updateSessionStatus: vi.fn(),
      markTurn: vi.fn(),
      recordEvent: vi.fn()
    };
    const codex = { startInProject: vi.fn(async () => ({ sessionId: "codex1", finalMessage: "done", rawEvents: [] })) };
    const handlers = createBridgeHandlers({
      config: {
        discordGuildId: "guild",
        discordChannelId: "channel",
        allowedUserIds: ["u1"],
        allowedRoleIds: [],
        workspacePath: "/Users/cxymds/Documents/KAI"
      },
      store: store as never,
      codex: codex as never,
      queue: { enqueue: vi.fn((_id, work) => work()), pendingCount: vi.fn(() => 0) } as never,
      discord: { createThread, postMessage },
      projectExists: vi.fn(() => true)
    });

    await handlers.handleNewCommand({ userId: "u1", roleIds: [], project: "rustfs", prompt: "Hello" });

    expect(codex.startInProject).toHaveBeenCalledWith("/Users/cxymds/Documents/KAI/rustfs-real", "Hello");
  });

  it("uses uniquely discovered Codex projects when no registered alias exists", async () => {
    const createThread = vi.fn(async () => ({ id: "thread1", name: "Hello" }));
    const store = {
      findProjectByName: vi.fn(() => null),
      createSession: vi.fn((input) => ({ id: "bridge1", ...input, status: "active", createdAt: "", updatedAt: "", lastTurnAt: null, closedAt: null })),
      setCodexSessionId: vi.fn(),
      updateSessionStatus: vi.fn(),
      markTurn: vi.fn(),
      recordEvent: vi.fn()
    };
    const codex = { startInProject: vi.fn(async () => ({ sessionId: "codex1", finalMessage: "done", rawEvents: [] })) };
    const handlers = createBridgeHandlers({
      config: { discordGuildId: "guild", discordChannelId: "channel", allowedUserIds: ["u1"], allowedRoleIds: [], workspacePath: "/workspace" },
      store: store as never,
      codex: codex as never,
      queue: { enqueue: vi.fn((_id, work) => work()), pendingCount: vi.fn(() => 0) } as never,
      discord: { createThread, postMessage: vi.fn() },
      projectExists: vi.fn(() => true),
      discoverProjects: vi.fn(() => [{ name: "rustfs", path: "/Users/cxymds/Documents/KAI/rustfs", source: "codex" as const }])
    });

    await handlers.handleNewCommand({ userId: "u1", roleIds: [], project: "rustfs", prompt: "Hello" });

    expect(codex.startInProject).toHaveBeenCalledWith("/Users/cxymds/Documents/KAI/rustfs", "Hello");
  });

  it("adds, lists, and removes project aliases", async () => {
    const store = {
      upsertProject: vi.fn(),
      listProjects: vi.fn(() => [
        { name: "console", path: "/Users/cxymds/Documents/KAI/console", createdAt: "", updatedAt: "" },
        { name: "rustfs", path: "/Users/cxymds/Documents/KAI/rustfs", createdAt: "", updatedAt: "" }
      ]),
      removeProject: vi.fn(() => true)
    };
    const handlers = createBridgeHandlers({
      config: { discordGuildId: "guild", discordChannelId: "channel", allowedUserIds: ["u1"], allowedRoleIds: [], workspacePath: null },
      store: store as never,
      codex: {} as never,
      queue: {} as never,
      discord: { createThread: vi.fn(), postMessage: vi.fn() },
      projectExists: vi.fn(() => true)
    });

    await expect(
      handlers.handleProjectAddCommand({ userId: "u1", roleIds: [], name: "rustfs", path: "/Users/cxymds/Documents/KAI/rustfs" })
    ).resolves.toBe("Project registered: rustfs -> /Users/cxymds/Documents/KAI/rustfs");
    await expect(handlers.handleProjectListCommand({ userId: "u1", roleIds: [] })).resolves.toContain("console -> /Users/cxymds/Documents/KAI/console");
    await expect(handlers.handleProjectRemoveCommand({ userId: "u1", roleIds: [], name: "rustfs" })).resolves.toBe("Project removed: rustfs");
  });

  it("rejects missing Discord project paths before creating a thread", async () => {
    const createThread = vi.fn(async () => ({ id: "thread1", name: "Hello" }));
    const handlers = createBridgeHandlers({
      config: {
        discordGuildId: "guild",
        discordChannelId: "channel",
        allowedUserIds: ["u1"],
        allowedRoleIds: [],
        workspacePath: "/Users/cxymds/Documents/KAI"
      },
      store: { findProjectByName: vi.fn(() => null) } as never,
      codex: {} as never,
      queue: {} as never,
      discord: { createThread, postMessage: vi.fn() },
      projectExists: vi.fn(() => false)
    });

    await expect(handlers.handleNewCommand({ userId: "u1", roleIds: [], project: "missing", prompt: "Hello" })).rejects.toThrow(
      "Project path does not exist: /Users/cxymds/Documents/KAI/missing"
    );
    expect(createThread).not.toHaveBeenCalled();
  });

  it("denies unauthorized users", async () => {
    const handlers = createBridgeHandlers({
      config: { discordGuildId: "guild", discordChannelId: "channel", allowedUserIds: ["u1"], allowedRoleIds: [], workspacePath: null },
      store: {} as never,
      codex: {} as never,
      queue: {} as never,
      discord: { createThread: vi.fn(), postMessage: vi.fn() }
    });

    await expect(handlers.handleNewCommand({ userId: "u2", roleIds: [], project: "/work", prompt: "Hello" })).rejects.toThrow("Not authorized");
  });

  it("reports status for a mapped thread", async () => {
    const store = {
      findSessionByThreadId: vi.fn(() => ({
        id: "bridge1",
        codexSessionId: "codex1",
        discordGuildId: "guild",
        discordChannelId: "channel",
        discordThreadId: "thread1",
        projectPath: "/Users/cxymds/Documents/KAI/rustfs",
        title: "Hello",
        status: "active",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:01:00.000Z",
        lastTurnAt: "2026-04-29T00:01:00.000Z",
        closedAt: null
      }))
    };
    const handlers = createBridgeHandlers({
      config: { discordGuildId: "guild", discordChannelId: "channel", allowedUserIds: ["u1"], allowedRoleIds: [], workspacePath: null },
      store: store as never,
      codex: {} as never,
      queue: { pendingCount: vi.fn(() => 2) } as never,
      discord: { createThread: vi.fn(), postMessage: vi.fn() }
    });

    await expect(handlers.handleStatusCommand({ userId: "u1", roleIds: [], threadId: "thread1" })).resolves.toContain("codex1");
  });

  it("marks new sessions as error and reports Codex start failures", async () => {
    const error = new Error("Codex exploded");
    const postMessage = vi.fn(async () => undefined);
    const store = {
      createSession: vi.fn((input) => ({ id: "bridge1", ...input, status: "active", createdAt: "", updatedAt: "", lastTurnAt: null, closedAt: null })),
      setCodexSessionId: vi.fn(),
      updateSessionStatus: vi.fn(),
      markTurn: vi.fn(),
      recordEvent: vi.fn()
    };
    const handlers = createBridgeHandlers({
      config: { discordGuildId: "guild", discordChannelId: "channel", allowedUserIds: ["u1"], allowedRoleIds: [], workspacePath: null },
      store: store as never,
      codex: { startInProject: vi.fn(async () => { throw error; }) } as never,
      queue: { enqueue: vi.fn((_id, work) => work()), pendingCount: vi.fn(() => 0) } as never,
      discord: { createThread: vi.fn(async () => ({ id: "thread1", name: "Hello" })), postMessage },
      projectExists: vi.fn(() => true)
    });

    await expect(handlers.handleNewCommand({ userId: "u1", roleIds: [], project: "/work", prompt: "Hello" })).rejects.toThrow("Codex exploded");

    expect(store.updateSessionStatus).toHaveBeenNthCalledWith(1, "bridge1", "running");
    expect(store.updateSessionStatus).toHaveBeenNthCalledWith(2, "bridge1", "error");
    expect(store.recordEvent).toHaveBeenCalledWith({
      sessionId: "bridge1",
      source: "system",
      kind: "error",
      payload: { message: "Codex exploded" }
    });
    expect(postMessage).toHaveBeenCalledWith("thread1", "Codex run failed: Codex exploded");
  });

  it("marks existing sessions as error and reports Codex resume failures", async () => {
    const error = new Error("Resume failed");
    const postMessage = vi.fn(async () => undefined);
    const store = {
      findSessionByThreadId: vi.fn(() => ({
        id: "bridge1",
        codexSessionId: "codex1",
        discordGuildId: "guild",
        discordChannelId: "channel",
        discordThreadId: "thread1",
        title: "Hello",
        status: "active",
        createdAt: "",
        updatedAt: "",
        lastTurnAt: null,
        closedAt: null
      })),
      updateSessionStatus: vi.fn(),
      markTurn: vi.fn(),
      recordEvent: vi.fn()
    };
    const handlers = createBridgeHandlers({
      config: { discordGuildId: "guild", discordChannelId: "channel", allowedUserIds: ["u1"], allowedRoleIds: [], workspacePath: null },
      store: store as never,
      codex: { resumeInProject: vi.fn(async () => { throw error; }) } as never,
      queue: { enqueue: vi.fn((_id, work) => work()), pendingCount: vi.fn(() => 0) } as never,
      discord: { createThread: vi.fn(), postMessage }
    });

    await expect(handlers.handleThreadMessage({ userId: "u1", roleIds: [], threadId: "thread1", content: "Continue" })).rejects.toThrow("Resume failed");

    expect(store.updateSessionStatus).toHaveBeenNthCalledWith(1, "bridge1", "running");
    expect(store.updateSessionStatus).toHaveBeenNthCalledWith(2, "bridge1", "error");
    expect(store.recordEvent).toHaveBeenCalledWith({
      sessionId: "bridge1",
      source: "system",
      kind: "error",
      payload: { message: "Resume failed" }
    });
    expect(postMessage).toHaveBeenCalledWith("thread1", "Codex run failed: Resume failed");
  });

  it("resumes Discord follow-up messages in the session project", async () => {
    const postMessage = vi.fn(async () => undefined);
    const store = {
      findSessionByThreadId: vi.fn(() => ({
        id: "bridge1",
        codexSessionId: "codex1",
        discordGuildId: "guild",
        discordChannelId: "channel",
        discordThreadId: "thread1",
        projectPath: "/Users/cxymds/Documents/KAI/rustfs",
        title: "Hello",
        status: "active",
        createdAt: "",
        updatedAt: "",
        lastTurnAt: null,
        closedAt: null
      })),
      updateSessionStatus: vi.fn(),
      markTurn: vi.fn(),
      recordEvent: vi.fn()
    };
    const codex = { resumeInProject: vi.fn(async () => ({ sessionId: "codex1", finalMessage: "continued", rawEvents: [] })) };
    const handlers = createBridgeHandlers({
      config: { discordGuildId: "guild", discordChannelId: "channel", allowedUserIds: ["u1"], allowedRoleIds: [], workspacePath: null },
      store: store as never,
      codex: codex as never,
      queue: { enqueue: vi.fn((_id, work) => work()), pendingCount: vi.fn(() => 0) } as never,
      discord: { createThread: vi.fn(), postMessage }
    });

    await handlers.handleThreadMessage({ userId: "u1", roleIds: [], threadId: "thread1", content: "Continue" });

    expect(codex.resumeInProject).toHaveBeenCalledWith("/Users/cxymds/Documents/KAI/rustfs", "codex1", "Continue");
    expect(postMessage).toHaveBeenCalledWith("thread1", "continued");
  });
});

describe("roleIdsFromInteractionMember", () => {
  it("extracts role ids from raw API arrays", () => {
    expect(roleIdsFromInteractionMember({ roles: ["role1", "role2"] })).toEqual(["role1", "role2"]);
  });

  it("extracts role ids from Discord.js role manager cache shapes", () => {
    expect(roleIdsFromInteractionMember({ roles: { cache: new Map([["role3", {}], ["role4", {}]]) } })).toEqual(["role3", "role4"]);
  });
});

describe("isConfiguredCommandChannel", () => {
  it("only allows commands in the configured channel", () => {
    const config = { discordChannelId: "channel" };

    expect(isConfiguredCommandChannel(config, "channel")).toBe(true);
    expect(isConfiguredCommandChannel(config, "other")).toBe(false);
  });
});

describe("isSupportedThreadChannelType", () => {
  it("accepts public, private, and announcement threads", () => {
    expect(isSupportedThreadChannelType(ChannelType.PublicThread)).toBe(true);
    expect(isSupportedThreadChannelType(ChannelType.PrivateThread)).toBe(true);
    expect(isSupportedThreadChannelType(ChannelType.AnnouncementThread)).toBe(true);
    expect(isSupportedThreadChannelType(ChannelType.GuildText)).toBe(false);
  });
});

describe("buildSlashCommands", () => {
  it("marks the new project option as autocomplete and includes project management commands", () => {
    const command = buildSlashCommands()[0] as { options: Array<{ name: string; options?: Array<{ name: string; autocomplete?: boolean; type?: number }> }> };
    const newCommand = command.options.find((option) => option.name === "new")!;
    const projectGroup = command.options.find((option) => option.name === "project")!;

    expect(newCommand.options?.find((option) => option.name === "project")?.autocomplete).toBe(true);
    expect(projectGroup.options?.map((option) => option.name)).toEqual(["add", "list", "remove"]);
  });
});
