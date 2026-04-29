#!/usr/bin/env node

const endpoint = process.env.BRIDGE_NOTIFY_URL ?? "http://127.0.0.1:43765/notify/turn-ended";
const chunks = [];

for await (const chunk of process.stdin) {
  chunks.push(Buffer.from(chunk));
}

const stdin = Buffer.concat(chunks).toString("utf8");
const payload = {
  argv: process.argv.slice(2),
  stdin,
  received_at: new Date().toISOString()
};

try {
  await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
}

const existingNotifier = "/Users/cxymds/.codex/plugins/cache/openai-bundled/computer-use/1.0.758/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient";
try {
  const { spawn } = await import("node:child_process");
  const child = spawn(existingNotifier, process.argv.slice(2), { stdio: ["pipe", "ignore", "ignore"] });
  child.stdin.end(stdin);
} catch {
  process.exit(0);
}
