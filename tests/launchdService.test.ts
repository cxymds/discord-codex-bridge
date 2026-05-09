import path from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error The launchd helper is a Node CLI script with named testable exports.
import { buildPlist, servicePaths } from "../scripts/launchd-service.mjs";

describe("launchd service helpers", () => {
  test("builds a launchd plist without file logging by default", () => {
    const projectRoot = "/Users/example/discord-codex-bridge";
    const paths = servicePaths(projectRoot, "/Users/example");

    const plist = buildPlist({
      label: "com.local.discord-codex-bridge",
      nodeBin: "/opt/homebrew/bin/node",
      paths,
      pathEnv: "/opt/homebrew/bin:/usr/bin:/bin"
    });

    expect(plist).toContain("<string>/opt/homebrew/bin/node</string>");
    expect(plist).toContain(`<string>${path.join(projectRoot, "dist/src/index.js")}</string>`);
    expect(plist).toContain(`<string>${projectRoot}</string>`);
    expect(plist).not.toContain("StandardOutPath");
    expect(plist).not.toContain("StandardErrorPath");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
  });

  test("adds stdout and stderr file logging when enabled", () => {
    const projectRoot = "/Users/example/discord-codex-bridge";
    const paths = servicePaths(projectRoot, "/Users/example");

    const plist = buildPlist({
      label: "com.local.discord-codex-bridge",
      nodeBin: "/opt/homebrew/bin/node",
      paths,
      pathEnv: "/opt/homebrew/bin:/usr/bin:/bin",
      logToFiles: true
    });

    expect(plist).toContain("<key>StandardOutPath</key>");
    expect(plist).toContain(`<string>${path.join(projectRoot, "logs/bridge.out.log")}</string>`);
    expect(plist).toContain("<key>StandardErrorPath</key>");
    expect(plist).toContain(`<string>${path.join(projectRoot, "logs/bridge.err.log")}</string>`);
  });

  test("escapes XML-sensitive values in plist strings", () => {
    const paths = servicePaths("/Users/example/discord & codex", "/Users/example");

    const plist = buildPlist({
      label: "com.local.discord-codex-bridge",
      nodeBin: "/opt/homebrew/bin/node",
      paths,
      pathEnv: "/tmp/a&b:/usr/bin"
    });

    expect(plist).toContain("/Users/example/discord &amp; codex");
    expect(plist).toContain("/tmp/a&amp;b:/usr/bin");
  });
});
