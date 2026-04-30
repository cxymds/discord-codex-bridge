import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ensureAppServerProcess } from "../src/appServerProcess.js";

function childProcessDouble() {
  const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> };
  child.kill = vi.fn();
  return child;
}

describe("ensureAppServerProcess", () => {
  it("starts the Codex app-server when auto-start is enabled and the socket is missing", async () => {
    const child = childProcessDouble();
    const spawn = vi.fn(() => child);

    const processHandle = await ensureAppServerProcess({
      autoStart: true,
      deliveryMode: "auto",
      codexBin: "/codex",
      codexHome: "/home/.codex",
      socketPath: "/home/.codex/app-server-control/app-server-control.sock",
      cwd: "/bridge",
      socketExists: () => false,
      spawn,
      mkdir: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined)
    });

    expect(spawn).toHaveBeenCalledWith(
      "/codex",
      ["app-server", "--listen", "unix:///home/.codex/app-server-control/app-server-control.sock"],
      expect.objectContaining({
        cwd: "/bridge",
        env: expect.objectContaining({ CODEX_HOME: "/home/.codex" }),
        stdio: "inherit"
      })
    );
    expect(processHandle.started).toBe(true);
    processHandle.close();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("does not start a duplicate app-server when the socket already exists", async () => {
    const spawn = vi.fn();

    const processHandle = await ensureAppServerProcess({
      autoStart: true,
      deliveryMode: "desktop",
      codexBin: "/codex",
      codexHome: "/home/.codex",
      socketPath: "/home/.codex/app-server-control/app-server-control.sock",
      cwd: "/bridge",
      socketExists: () => true,
      spawn,
      mkdir: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined)
    });

    expect(spawn).not.toHaveBeenCalled();
    expect(processHandle.started).toBe(false);
  });

  it("does not start app-server for cli delivery", async () => {
    const spawn = vi.fn();

    await ensureAppServerProcess({
      autoStart: true,
      deliveryMode: "cli",
      codexBin: "/codex",
      codexHome: "/home/.codex",
      socketPath: "/home/.codex/app-server-control/app-server-control.sock",
      cwd: "/bridge",
      socketExists: () => false,
      spawn,
      mkdir: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined)
    });

    expect(spawn).not.toHaveBeenCalled();
  });
});
