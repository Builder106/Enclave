import { describe, expect, it } from "vitest";
import type {
  DocumentRunResult,
  Extraction,
  GeneratedDocument,
  ResolvedExtraction,
  SuperbillTruth,
} from "@/lib/contract";
import { computeMetrics } from "@/eval/metrics";

const truthA: SuperbillTruth = {
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
  diagnoses: [{ description: "Streptococcal pharyngitis", icd10: "J02.0" }],
  lines: [
    { description: "Rapid strep", cpt: "87880", units: 1, chargeCents: 3000 },
    { description: "Rapid strep", cpt: "87880", units: 1, chargeCents: 3000 },
  ],
  payer: { name: "Aetna", memberId: "ABC00000001" },
  subtotalCents: 6000,
  printedTotalCents: 6000,
  injectedAnomalies: ["duplicate_line"],
};

const truthB: SuperbillTruth = {
  patient: {
    firstName: "Tomas",
    lastName: "Nguyen",
    dob: "1972-11-03",
    mrn: "MRN-7654321",
    phone: "(555) 555-0142",
  },
  encounter: {
    date: "2026-02-20",
    type: "telehealth",
    providerName: "Dr. Ada Yu",
    npi: "1093817465",
  },
  diagnoses: [{ description: "Fever, unspecified", icd10: "R50.9" }],
  lines: [{ description: "Lipid panel", cpt: "80061", units: 1, chargeCents: 5000 }],
  payer: { name: "Cigna", memberId: "KQM00412233" },
  subtotalCents: 5000,
  printedTotalCents: 4500,
  injectedAnomalies: ["charge_total_mismatch"],
};

function makeDoc(id: string, index: number, truth: SuperbillTruth): GeneratedDocument {
  return { id, seed: 42, index, truth, text: "", cleanText: "", split: "eval" };
}

function extractionFrom(truth: SuperbillTruth): ResolvedExtraction {
  return {
    patient: { ...truth.patient },
    encounter: { ...truth.encounter },
    diagnoses: truth.diagnoses.map((d) => ({ ...d })),
    lines: truth.lines.map((l) => ({ ...l })),
    payer: { ...truth.payer },
    printedTotalCents: truth.printedTotalCents,
  };
}

function makeResult(
  documentId: string,
  extraction: Extraction | null,
  resolved: ResolvedExtraction | null,
  overrides?: Partial<DocumentRunResult>,
): DocumentRunResult {
  return {
    documentId,
    provider: "rules",
    model: "deterministic",
    extraction,
    resolved,
    anomalies: [],
    latencyMs: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: 0,
    egressBytes: 0,
    error: null,
    ...overrides,
  };
}

describe("computeMetrics", () => {
  const docs = [makeDoc("DOC-00001", 0, truthA), makeDoc("DOC-00002", 1, truthB)];

  const perfectA = extractionFrom(truthA);
  const resultA = makeResult("DOC-00001", perfectA, perfectA, {
    anomalies: [{ kind: "duplicate_line", detail: "Rapid strep appears twice." }],
    latencyMs: 100,
  });

  const flawedB = extractionFrom(truthB);
  flawedB.patient.lastName = "Smith";
  const resultB = makeResult("DOC-00002", flawedB, flawedB, {
    latencyMs: 300,
    costUsd: 0.01,
    egressBytes: 2048,
  });

  const metrics = computeMetrics(docs, [resultA, resultB]);

  it("scores field accuracy as the exact micro-averaged fraction", () => {
    // 12 scalar fields per doc; doc B misses exactly patient.lastName.
    expect(metrics.fieldAccuracy).toBe(23 / 24);
    const lastName = metrics.perField.find((f) => f.field === "patient.lastName")!;
    expect(lastName).toEqual({ field: "patient.lastName", correct: 1, total: 2 });
  });

  it("counts only the fully correct doc toward exact match", () => {
    expect(metrics.exactMatchRate).toBe(0.5);
  });

  it("scores anomaly detection: one hit, one miss", () => {
    expect(metrics.anomalyDetection.precision).toBe(1);
    expect(metrics.anomalyDetection.recall).toBe(0.5);
    expect(metrics.anomalyDetection.f1).toBeCloseTo(2 / 3, 12);
  });

  it("computes nearest-rank latency percentiles from known latencies", () => {
    expect(metrics.latencyMsP50).toBe(100);
    expect(metrics.latencyMsP95).toBe(300);
  });

  it("sums cost and egress", () => {
    expect(metrics.totalCostUsd).toBe(0.01);
    expect(metrics.costPerDocUsd).toBeCloseTo(0.005, 12);
    expect(metrics.egressBytesTotal).toBe(2048);
  });

  it("reports docCount, parseRate, and perfect code match", () => {
    expect(metrics.docCount).toBe(2);
    expect(metrics.parseRate).toBe(1);
    expect(metrics.codeMatch).toEqual({ precision: 1, recall: 1, f1: 1 });
  });

  it("treats empty anomaly sets on both sides as perfect PRF1", () => {
    const cleanTruth: SuperbillTruth = {
      ...truthA,
      lines: [truthA.lines[0]],
      subtotalCents: 3000,
      printedTotalCents: 3000,
      injectedAnomalies: [],
    };
    const doc = makeDoc("DOC-00003", 2, cleanTruth);
    const extraction = extractionFrom(cleanTruth);
    const result = makeResult("DOC-00003", extraction, extraction, { latencyMs: 50 });
    const m = computeMetrics([doc], [result]);
    expect(m.anomalyDetection).toEqual({ precision: 1, recall: 1, f1: 1 });
  });

  it("handles empty results and missing extractions", () => {
    const empty = computeMetrics([], []);
    expect(empty).toMatchObject({ provider: "rules", model: "unknown", docCount: 0, parseRate: 0, fieldAccuracy: 0, exactMatchRate: 0, costPerDocUsd: 0, latencyMsP50: 0, latencyMsP95: 0 });

    const result = makeResult("DOC-00001", null, null, {
      extraction: null,
      resolved: null,
      anomalies: [{ kind: "charge_total_mismatch", detail: "wrong" }],
    });
    const metrics = computeMetrics([makeDoc("DOC-00001", 0, truthA)], [result]);
    expect(metrics.parseRate).toBe(0);
    expect(metrics.codeMatch).toEqual({ precision: 0, recall: 0, f1: 0 });
    expect(metrics.anomalyDetection).toEqual({ precision: 0, recall: 0, f1: 0 });
  });

  it("rejects results for unknown documents", () => {
    expect(() => computeMetrics([], [makeResult("missing", perfectA, perfectA)])).toThrow("no document");
  });
});
