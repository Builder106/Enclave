import { describe, expect, it } from "vitest";
import { generateBatch } from "@/generators";
import { rulesExtract } from "@/agent/rules-extractor";

describe("rulesExtract", () => {
  const docs = generateBatch(7)
    .filter((d) => d.truth.injectedAnomalies.length === 0)
    .slice(0, 5);

  it("has five anomaly-free docs to work with", () => {
    expect(docs).toHaveLength(5);
  });

  it("extracts all five clean texts, reproducing MRN and printed total exactly", () => {
    for (const doc of docs) {
      const extraction = rulesExtract(doc.cleanText);
      expect(extraction).not.toBeNull();
      expect(extraction!.patient.mrn).toBe(doc.truth.patient.mrn);
      expect(extraction!.printedTotalCents).toBe(doc.truth.printedTotalCents);
    }
  });

  it("stays non-null on at least 3 of 5 noisy texts", () => {
    const parsed = docs.filter((doc) => rulesExtract(doc.text) !== null);
    expect(parsed.length).toBeGreaterThanOrEqual(3);
  });

  it("handles merged names and leaves malformed member IDs unchanged", () => {
    const text = `PATIENT\nName: AdaOkafor\nDOB: 1985-03-12\nMRN: MRN-1234567\nPhone: (555) 555-0101\n\nENCOUNTER\nDate of Service: 2026-01-15\nVisit Type: Office Visit\nRendering Provider: Dr. Park\nNPI: 1234567890\n\nDIAGNOSES\n  1. Fever [R50.9]\n\nSERVICES\nDESCRIPTION CPT QTY CHARGE\nFever consult 99213 1 $180.00\nTOTAL DUE: $180.00\n\nINSURANCE / PAYER\nPlan: Plan\nMember ID: bad-id`;
    const result = rulesExtract(text);
    expect(result?.patient).toMatchObject({ firstName: "Ada", lastName: "Okafor" });
    expect(result?.payer.memberId).toBe("bad-id");
  });
});
