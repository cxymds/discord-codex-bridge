import { describe, expect, it, vi } from "vitest";
import { createTurnDeliveryClient } from "../src/turnDelivery.js";
import type { CodexRunResult } from "../src/types.js";

function result(finalMessage: string): CodexRunResult {
  return { sessionId: "s1", finalMessage, rawEvents: [] };
}

describe("createTurnDeliveryClient", () => {
  it("falls back to CLI delivery in auto mode when Desktop delivery fails", async () => {
    const desktopError = new Error("Codex Desktop app-server proxy failed: missing socket");
    const cli = {
      resume: vi.fn(async () => result("cli")),
      resumeInProject: vi.fn(async () => result("cli project"))
    };
    const desktop = {
      resume: vi.fn(async () => {
        throw desktopError;
      }),
      resumeInProject: vi.fn(async () => {
        throw desktopError;
      })
    };
    const onDesktopFailure = vi.fn();

    const client = createTurnDeliveryClient({ mode: "auto", cli, desktop, onDesktopFailure });

    await expect(client.resumeInProject("/work", "s1", "hello")).resolves.toMatchObject({ finalMessage: "cli project" });
    expect(desktop.resumeInProject).toHaveBeenCalledWith("/work", "s1", "hello");
    expect(cli.resumeInProject).toHaveBeenCalledWith("/work", "s1", "hello");
    expect(onDesktopFailure).toHaveBeenCalledWith(desktopError);
  });

  it("falls back to CLI delivery when Desktop returns no final agent message", async () => {
    const desktopError = new Error("Codex Desktop app-server returned no final agent message");
    const cli = {
      resume: vi.fn(async () => result("cli")),
      resumeInProject: vi.fn(async () => result("cli project"))
    };
    const desktop = {
      resume: vi.fn(async () => {
        throw desktopError;
      }),
      resumeInProject: vi.fn(async () => {
        throw desktopError;
      })
    };

    const client = createTurnDeliveryClient({ mode: "auto", cli, desktop });

    await expect(client.resumeInProject("/work", "s1", "hello")).resolves.toMatchObject({ finalMessage: "cli project" });
    expect(cli.resumeInProject).toHaveBeenCalledWith("/work", "s1", "hello");
  });

  it("keeps Desktop delivery strict in desktop mode", async () => {
    const desktopError = new Error("missing socket");
    const cli = {
      resume: vi.fn(async () => result("cli")),
      resumeInProject: vi.fn(async () => result("cli project"))
    };
    const desktop = {
      resume: vi.fn(async () => {
        throw desktopError;
      }),
      resumeInProject: vi.fn(async () => {
        throw desktopError;
      })
    };

    const client = createTurnDeliveryClient({ mode: "desktop", cli, desktop });

    await expect(client.resumeInProject("/work", "s1", "hello")).rejects.toThrow("missing socket");
    expect(cli.resumeInProject).not.toHaveBeenCalled();
  });

  it("uses CLI delivery directly in cli mode", async () => {
    const cli = {
      resume: vi.fn(async () => result("cli")),
      resumeInProject: vi.fn(async () => result("cli project"))
    };
    const desktop = {
      resume: vi.fn(async () => result("desktop")),
      resumeInProject: vi.fn(async () => result("desktop project"))
    };

    const client = createTurnDeliveryClient({ mode: "cli", cli, desktop });

    await expect(client.resume("s1", "hello")).resolves.toMatchObject({ finalMessage: "cli" });
    expect(desktop.resume).not.toHaveBeenCalled();
  });
});
