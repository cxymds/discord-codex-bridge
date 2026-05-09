#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const SERVICE_LABEL = "com.local.discord-codex-bridge";

function projectRootFromScript() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function servicePaths(projectRoot = projectRootFromScript(), homeDir = os.homedir()) {
  return {
    projectRoot,
    entrypoint: path.join(projectRoot, "dist", "src", "index.js"),
    logsDir: path.join(projectRoot, "logs"),
    stdoutLog: path.join(projectRoot, "logs", "bridge.out.log"),
    stderrLog: path.join(projectRoot, "logs", "bridge.err.log"),
    plistPath: path.join(homeDir, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`)
  };
}

function envFlag(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

export function buildPlist({ label = SERVICE_LABEL, nodeBin, paths, pathEnv = process.env.PATH ?? "", logToFiles = false }) {
  const string = (value) => `<string>${xmlEscape(value)}</string>`;
  const logPaths = logToFiles
    ? `

    <key>StandardOutPath</key>
    ${string(paths.stdoutLog)}

    <key>StandardErrorPath</key>
    ${string(paths.stderrLog)}`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    ${string(label)}

    <key>ProgramArguments</key>
    <array>
      ${string(nodeBin)}
      ${string(paths.entrypoint)}
    </array>

    <key>WorkingDirectory</key>
    ${string(paths.projectRoot)}

    <key>EnvironmentVariables</key>
    <dict>
      <key>NODE_ENV</key>
      <string>production</string>
      <key>PATH</key>
      ${string(pathEnv)}
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>${logPaths}
  </dict>
</plist>
`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with code ${result.status}`);
  }
}

function output(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with code ${result.status}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function ensureMacOS() {
  if (process.platform !== "darwin") {
    throw new Error("launchd service management is only supported on macOS.");
  }
}

function resolveNodeBin() {
  if (process.env.NODE_BIN) {
    return process.env.NODE_BIN;
  }
  return output("/usr/bin/env", ["which", "node"]);
}

function loadService(paths) {
  run("launchctl", ["load", paths.plistPath]);
}

function unloadService(paths) {
  const result = spawnSync("launchctl", ["unload", paths.plistPath], { stdio: "ignore" });
  if (result.error) {
    throw result.error;
  }
}

function bootstrapService(paths) {
  fs.mkdirSync(path.dirname(paths.plistPath), { recursive: true });

  if (!fs.existsSync(paths.entrypoint)) {
    run("npm", ["run", "build"], { cwd: paths.projectRoot });
  }

  if (!fs.existsSync(paths.entrypoint)) {
    throw new Error(`Missing production entrypoint: ${paths.entrypoint}`);
  }
}

export function installService({
  paths = servicePaths(),
  nodeBin = resolveNodeBin(),
  pathEnv = process.env.PATH ?? "",
  logToFiles = envFlag(process.env.LOG_TO_FILES)
} = {}) {
  ensureMacOS();
  bootstrapService(paths);
  if (logToFiles) {
    fs.mkdirSync(paths.logsDir, { recursive: true });
  }
  const plist = buildPlist({ nodeBin, paths, pathEnv, logToFiles });
  fs.writeFileSync(paths.plistPath, plist, "utf8");
  unloadService(paths);
  loadService(paths);
  run("launchctl", ["start", SERVICE_LABEL]);
  return paths;
}

export function uninstallService(paths = servicePaths()) {
  ensureMacOS();
  unloadService(paths);
  if (fs.existsSync(paths.plistPath)) {
    fs.unlinkSync(paths.plistPath);
  }
}

function startService(paths) {
  ensureMacOS();
  run("launchctl", ["start", SERVICE_LABEL]);
}

function stopService(paths) {
  ensureMacOS();
  run("launchctl", ["stop", SERVICE_LABEL]);
}

function restartService(paths) {
  stopService(paths);
  startService(paths);
}

function statusService() {
  ensureMacOS();
  const result = spawnSync("launchctl", ["list", SERVICE_LABEL], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
}

function printHelp() {
  console.log(`Usage: node scripts/launchd-service.mjs <command>

Commands:
  install     Build if needed, write plist, load and start the service
  uninstall   Stop, unload, and remove the plist
  start       Start the loaded service
  stop        Stop the service
  restart     Stop and start the service
  status      Show launchctl status

Environment:
  NODE_BIN       Override the node executable used by launchd
  LOG_TO_FILES   Set to true to write stdout/stderr to logs/bridge.*.log
`);
}

async function main() {
  const command = process.argv[2] ?? "help";
  const paths = servicePaths();

  switch (command) {
    case "install":
      installService({ paths });
      console.log(`Installed ${SERVICE_LABEL}`);
      console.log(`Plist: ${paths.plistPath}`);
      if (envFlag(process.env.LOG_TO_FILES)) {
        console.log(`Logs: ${paths.stdoutLog}`);
        console.log(`Errors: ${paths.stderrLog}`);
      } else {
        console.log("File logging: disabled");
      }
      break;
    case "uninstall":
      uninstallService(paths);
      console.log(`Uninstalled ${SERVICE_LABEL}`);
      break;
    case "start":
      startService(paths);
      break;
    case "stop":
      stopService(paths);
      break;
    case "restart":
      restartService(paths);
      break;
    case "status":
      statusService();
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      printHelp();
      process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
