import { describe, expect, it } from "vitest";
import { CPT_CODES, ICD10_CODES, findCpt, findIcd10 } from "@/lib/codes";

describe("code lookup", () => {
  it("exposes the bundled datasets", () => {
    expect(CPT_CODES.length).toBeGreaterThan(0);
    expect(ICD10_CODES.length).toBeGreaterThan(0);
  });

  it("normalizes case, whitespace, and ICD punctuation", () => {
    expect(findIcd10(" j069 ")?.code).toBe("J06.9");
    expect(findCpt(" 99213 ")?.code).toBe("99213");
  });

  it("returns undefined for an unknown code", () => {
    expect(findIcd10("ZZZ999")).toBeUndefined();
    expect(findCpt("00000")).toBeUndefined();
  });
});
