import { describe, expect, it } from "vitest";
import { extractNotifyFields } from "../src/notifyPayload.js";

describe("extractNotifyFields", () => {
  it("extracts direct session and message fields", () => {
    expect(extractNotifyFields({ session_id: "s1", final_message: "done" })).toEqual({
      codexSessionId: "s1",
      finalMessage: "done"
    });
  });

  it("extracts observed Codex thread and item fields from JSONL stdin", () => {
    const stdin = [
      JSON.stringify({ type: "thread.started", thread_id: "thread_abc" }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } })
    ].join("\n");

    expect(extractNotifyFields({ stdin })).toEqual({
      codexSessionId: "thread_abc",
      finalMessage: "done"
    });
  });

  it("does not treat generic item ids as session ids", () => {
    const stdin = [
      JSON.stringify({ type: "item.completed", id: "item_123", item: { type: "agent_message", text: "done" } }),
      JSON.stringify({ type: "thread.started", thread_id: "thread_abc" })
    ].join("\n");

    expect(extractNotifyFields({ stdin }).codexSessionId).toBe("thread_abc");
  });
});
