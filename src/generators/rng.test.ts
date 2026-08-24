import { describe, expect, it } from "vitest";
import { createRng, pick, pickInt, shuffle } from "@/generators/rng";

describe("generator rng helpers", () => {
  it("is deterministic and produces values in [0, 1)", () => {
    const a = createRng(123);
    const b = createRng(123);
    const values = Array.from({ length: 8 }, () => a());
    expect(values).toEqual(Array.from({ length: 8 }, () => b()));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it("picks values and inclusive integer bounds", () => {
    expect(pick(() => 0, ["a", "b"])).toBe("a");
    expect(pick(() => 0.999, ["a", "b"])).toBe("b");
    expect(pickInt(() => 0, 3, 3)).toBe(3);
    expect(pickInt(() => 0.999, 3, 5)).toBe(5);
  });

  it("shuffles a copy without mutating the input", () => {
    const input = [1, 2, 3, 4];
    const output = shuffle(() => 0, input);
    expect(input).toEqual([1, 2, 3, 4]);
    expect(output).toEqual([2, 3, 4, 1]);
  });
});
