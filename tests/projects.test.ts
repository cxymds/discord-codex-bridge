import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverCodexProjects, formatProjectChoices, mergeProjectChoices } from "../src/projects.js";

describe("discoverCodexProjects", () => {
  it("discovers unique project paths from Codex session metadata", () => {
    const codexHome = join(tmpdir(), `discord-codex-projects-${Date.now()}`);
    const sessionDir = join(codexHome, "sessions", "2026", "04", "30");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, "rollout-a.jsonl"), JSON.stringify({ type: "session_meta", payload: { cwd: "/Users/cxymds/Documents/KAI/rustfs" } }));
    writeFileSync(join(sessionDir, "rollout-b.jsonl"), JSON.stringify({ type: "session_meta", payload: { cwd: "/Users/cxymds/Documents/KAI/rustfs" } }));
    writeFileSync(join(sessionDir, "rollout-c.jsonl"), JSON.stringify({ type: "session_meta", payload: { cwd: "/Users/cxymds/Documents/KAI/console" } }));

    expect(discoverCodexProjects(codexHome)).toEqual([
      { name: "console", path: "/Users/cxymds/Documents/KAI/console", source: "codex" },
      { name: "rustfs", path: "/Users/cxymds/Documents/KAI/rustfs", source: "codex" }
    ]);
  });
});

describe("mergeProjectChoices", () => {
  it("prefers registered projects over discovered projects with the same name", () => {
    expect(
      mergeProjectChoices(
        [{ name: "rustfs", path: "/registered/rustfs", source: "registered" }],
        [
          { name: "rustfs", path: "/discovered/rustfs", source: "codex" },
          { name: "console", path: "/discovered/console", source: "codex" }
        ]
      )
    ).toEqual([
      { name: "console", path: "/discovered/console", source: "codex" },
      { name: "rustfs", path: "/registered/rustfs", source: "registered" }
    ]);
  });
});

describe("formatProjectChoices", () => {
  it("filters project choices for Discord autocomplete", () => {
    expect(
      formatProjectChoices(
        [
          { name: "console", path: "/Users/cxymds/Documents/KAI/console", source: "codex" },
          { name: "rustfs", path: "/Users/cxymds/Documents/KAI/rustfs", source: "registered" }
        ],
        "rust"
      )
    ).toEqual([{ name: "rustfs  /Users/cxymds/Documents/KAI/rustfs", value: "rustfs" }]);
  });
});
