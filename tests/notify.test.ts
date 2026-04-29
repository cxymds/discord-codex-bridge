import { afterEach, describe, expect, it, vi } from "vitest";
import { startNotifyServer } from "../src/notify.js";

describe("startNotifyServer", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers.length = 0;
  });

  it("accepts turn-ended notifications", async () => {
    const handler = vi.fn(async () => undefined);
    const server = await startNotifyServer({ host: "127.0.0.1", port: 0, onTurnEnded: handler });
    servers.push(server);

    const response = await fetch(`${server.url}/notify/turn-ended`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: "s1", final_message: "done" })
    });

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith({ session_id: "s1", final_message: "done" });
  });
});
