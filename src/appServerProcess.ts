import { spawn as defaultSpawn } from "node:child_process";
import { statSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { TurnDeliveryMode } from "./turnDelivery.js";

interface AppServerChild {
  kill(signal: NodeJS.Signals): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
}

type SpawnAppServer = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: "inherit" }) => AppServerChild;

interface AppServerProcessOptions {
  autoStart: boolean;
  deliveryMode: TurnDeliveryMode;
  codexBin: string;
  codexHome: string;
  socketPath: string;
  cwd: string;
  socketExists?: (socketPath: string) => boolean;
  spawn?: SpawnAppServer;
  mkdir?: (path: string, options: { recursive: true }) => Promise<unknown>;
  unlink?: (path: string) => Promise<unknown>;
}

export interface AppServerProcessHandle {
  started: boolean;
  close(): void;
}

function isSocket(path: string): boolean {
  try {
    return statSync(path).isSocket();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function ensureAppServerProcess(options: AppServerProcessOptions): Promise<AppServerProcessHandle> {
  if (!options.autoStart || options.deliveryMode === "cli") {
    return { started: false, close: () => undefined };
  }

  const socketExists = options.socketExists ?? isSocket;
  if (socketExists(options.socketPath)) {
    return { started: false, close: () => undefined };
  }

  const makeDirectory = options.mkdir ?? mkdir;
  const removeFile = options.unlink ?? unlink;
  const spawn = options.spawn ?? defaultSpawn;

  await makeDirectory(dirname(options.socketPath), { recursive: true });
  await removeFile(options.socketPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });

  const child = spawn(options.codexBin, ["app-server", "--listen", `unix://${options.socketPath}`], {
    cwd: options.cwd,
    env: { ...process.env, CODEX_HOME: options.codexHome },
    stdio: "inherit"
  });

  child.once("error", (error) => {
    console.warn(`Codex app-server failed to start: ${error instanceof Error ? error.message : String(error)}`);
  });

  return {
    started: true,
    close() {
      child.kill("SIGTERM");
    }
  };
}
