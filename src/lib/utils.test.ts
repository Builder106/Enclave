import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins conditional class values and resolves conflicting utilities", () => {
    expect(cn("p-2", false && "hidden", "text-sm")).toBe("p-2 text-sm");
    expect(cn("px-2", "px-4", undefined)).toBe("px-4");
  });
});
