import { describe, expect, it } from "vitest";
import { isAuthorized } from "../src/authz.js";

describe("isAuthorized", () => {
  it("allows matching users", () => {
    expect(isAuthorized({ userId: "u1", roleIds: [] }, ["u1"], [])).toBe(true);
  });

  it("allows matching roles", () => {
    expect(isAuthorized({ userId: "u2", roleIds: ["r1"] }, [], ["r1"])).toBe(true);
  });

  it("denies actors without a matching user or role", () => {
    expect(isAuthorized({ userId: "u2", roleIds: ["r2"] }, ["u1"], ["r1"])).toBe(false);
  });
});
