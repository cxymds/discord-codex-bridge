import { describe, expect, it } from "vitest";
import { chunkDiscordMessage, makeProjectThreadTitle, makeThreadTitle } from "../src/format.js";

describe("chunkDiscordMessage", () => {
  it("keeps short messages as one chunk", () => {
    expect(chunkDiscordMessage("hello")).toEqual(["hello"]);
  });

  it("splits long messages under Discord limits", () => {
    const chunks = chunkDiscordMessage("a".repeat(4100), 2000);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.length <= 2000)).toBe(true);
  });
});

describe("makeThreadTitle", () => {
  it("creates a compact title from the prompt", () => {
    expect(makeThreadTitle("  Build a Discord bridge for Codex sessions  ")).toBe("Build a Discord bridge for Codex sessions");
  });

  it("falls back for empty prompts", () => {
    expect(makeThreadTitle("   ")).toBe("Codex session");
  });
});

describe("makeProjectThreadTitle", () => {
  it("prefixes Codex session titles with the project name", () => {
    expect(makeProjectThreadTitle("discord-codex-bridge", "  Build the sync  ")).toBe("[discord-codex-bridge] Build the sync");
  });

  it("keeps the final title inside Discord limits", () => {
    const title = makeProjectThreadTitle("discord-codex-bridge", "a".repeat(200), 90);

    expect(title).toHaveLength(90);
    expect(title).toMatch(/^\[discord-codex-bridge\] /);
    expect(title.endsWith("...")).toBe(true);
  });
});
