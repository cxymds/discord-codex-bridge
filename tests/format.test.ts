import { describe, expect, it } from "vitest";
import { chunkDiscordMessage, makeThreadTitle } from "../src/format.js";

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
