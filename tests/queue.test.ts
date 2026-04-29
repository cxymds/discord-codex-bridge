import { describe, expect, it } from "vitest";
import { SessionQueue } from "../src/queue.js";

describe("SessionQueue", () => {
  it("runs work for the same session sequentially", async () => {
    const queue = new SessionQueue();
    const order: string[] = [];

    const first = queue.enqueue("s1", async () => {
      order.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("first-end");
      return "first";
    });

    const second = queue.enqueue("s1", async () => {
      order.push("second");
      return "second";
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });
});
