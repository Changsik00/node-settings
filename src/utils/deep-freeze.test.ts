import { describe, expect, it } from "vitest";
import { deepFreeze } from "./deep-freeze.js";

describe("deepFreeze", () => {
  it("freezes a flat object", () => {
    const obj = deepFreeze({ a: 1, b: "x" });
    expect(Object.isFrozen(obj)).toBe(true);
  });

  it("freezes nested objects", () => {
    const obj = deepFreeze({ a: { b: { c: 42 } } });
    expect(Object.isFrozen(obj.a)).toBe(true);
    expect(Object.isFrozen(obj.a.b)).toBe(true);
  });

  it("freezes arrays and their elements", () => {
    const obj = deepFreeze({ list: [{ x: 1 }, { x: 2 }] });
    expect(Object.isFrozen(obj.list)).toBe(true);
    expect(Object.isFrozen(obj.list[0])).toBe(true);
    expect(Object.isFrozen(obj.list[1])).toBe(true);
  });

  it("does not throw on primitives", () => {
    expect(() => deepFreeze(42)).not.toThrow();
    expect(() => deepFreeze("str")).not.toThrow();
    expect(() => deepFreeze(null)).not.toThrow();
  });

  it("does not re-freeze already frozen objects", () => {
    const inner = Object.freeze({ x: 1 });
    const obj = deepFreeze({ inner });
    expect(Object.isFrozen(obj.inner)).toBe(true);
  });

  it("mutation on nested object throws in strict mode", () => {
    const obj = deepFreeze({ db: { host: "localhost" } });
    expect(() => {
      "use strict";
      (obj.db as { host: string }).host = "hacked";
    }).toThrow(TypeError);
  });
});
