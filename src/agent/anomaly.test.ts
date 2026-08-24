import { describe, expect, it } from "vitest";
import { CPT_CODES } from "@/lib/codes";
import type { ResolvedExtraction } from "@/lib/contract";
import { detectAnomalies } from "@/agent/anomaly";

const CMP = CPT_CODES.find((e) => e.code === "80053")!;

function cleanFixture(): ResolvedExtraction {
  return {
    patient: {
      firstName: "Ada",
      lastName: "Okafor",
      dob: "1985-03-12",
      mrn: "MRN-1234567",
      phone: "(555) 555-0101",
    },
    encounter: {
      date: "2026-01-15",
      type: "office_visit",
      providerName: "Dr. Lena Park",
      npi: "1234567890",
    },
    diagnoses: [{ description: "Acute upper respiratory infection, unspecified", icd10: "J06.9" }],
    lines: [
      { description: "Office visit, established", cpt: "99213", units: 1, chargeCents: 18000 },
      { description: CMP.description, cpt: CMP.code, units: 1, chargeCents: CMP.typicalFeeCents! },
    ],
    payer: { name: "Aetna", memberId: "KQM00412233" },
    printedTotalCents: 18000 + CMP.typicalFeeCents!,
  };
}

describe("detectAnomalies", () => {
  it("returns no flags for a clean extraction", () => {
    expect(detectAnomalies(cleanFixture())).toEqual([]);
  });

  it("flags charge_total_mismatch when the printed total deviates from the line sum", () => {
    const fixture = cleanFixture();
    fixture.printedTotalCents = fixture.printedTotalCents! - 500;
    const flags = detectAnomalies(fixture);
    expect(flags.map((f) => f.kind)).toEqual(["charge_total_mismatch"]);
  });

  it("flags duplicate_line when a service line repeats", () => {
    const fixture = cleanFixture();
    fixture.lines.push({ ...fixture.lines[0] });
    fixture.printedTotalCents = fixture.lines.reduce((sum, l) => sum + l.chargeCents, 0);
    const flags = detectAnomalies(fixture);
    expect(flags.map((f) => f.kind)).toEqual(["duplicate_line"]);
  });

  it("flags unit_charge_outlier at 10x the typical fee for a known CPT", () => {
    const fixture = cleanFixture();
    fixture.lines[1] = { ...fixture.lines[1], chargeCents: CMP.typicalFeeCents! * 10 };
    fixture.printedTotalCents = fixture.lines.reduce((sum, l) => sum + l.chargeCents, 0);
    const flags = detectAnomalies(fixture);
    expect(flags.map((f) => f.kind)).toEqual(["unit_charge_outlier"]);
    expect(flags[0].detail).toContain(CMP.code);
  });

  it("flags missing totals and placeholder member IDs", () => {
    const fixture = cleanFixture();
    fixture.printedTotalCents = null;
    fixture.payer.memberId = "unknown";
    expect(detectAnomalies(fixture).map((flag) => flag.kind)).toEqual([
      "missing_field",
      "missing_field",
    ]);
  });
});
