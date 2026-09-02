import { describe, expect, it } from 'vitest';
import type {
  DocumentRunResult,
  Extraction,
  GeneratedDocument,
  ResolvedExtraction,
  SuperbillTruth,
} from '@/lib/contract';
import { computeMetrics } from '@/eval/metrics';

const truthA: SuperbillTruth = {
  patient: {
    firstName: 'Ada',
    lastName: 'Okafor',
    dob: '1985-03-12',
    mrn: 'MRN-1234567',
    phone: '(555) 555-0101',
  },
  encounter: {
    date: '2026-01-15',
    type: 'office_visit',
    providerName: 'Dr. Lena Park',
    npi: '1234567890',
  },
  diagnoses: [{ description: 'Streptococcal pharyngitis', icd10: 'J02.0' }],
  lines: [
    { description: 'Rapid strep', cpt: '87880', units: 1, chargeCents: 3000 },
    { description: 'Rapid strep', cpt: '87880', units: 1, chargeCents: 3000 },
  ],
  payer: { name: 'Aetna', memberId: 'ABC00000001' },
  subtotalCents: 6000,
  printedTotalCents: 6000,
  injectedAnomalies: ['duplicate_line'],
};

const truthB: SuperbillTruth = {
  patient: {
    firstName: 'Tomas',
    lastName: 'Nguyen',
    dob: '1972-11-03',
    mrn: 'MRN-7654321',
    phone: '(555) 555-0142',
  },
  encounter: {
    date: '2026-02-20',
    type: 'telehealth',
    providerName: 'Dr. Ada Yu',
    npi: '1093817465',
  },
  diagnoses: [{ description: 'Fever, unspecified', icd10: 'R50.9' }],
  lines: [{ description: 'Lipid panel', cpt: '80061', units: 1, chargeCents: 5000 }],
  payer: { name: 'Cigna', memberId: 'KQM00412233' },
  subtotalCents: 5000,
  printedTotalCents: 4500,
  injectedAnomalies: ['charge_total_mismatch'],
};

function makeDoc(id: string, index: number, truth: SuperbillTruth): GeneratedDocument {
  return { id, seed: 42, index, truth, text: '', cleanText: '', split: 'eval' };
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
    provider: 'rules',
    model: 'deterministic',
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

describe('computeMetrics', () => {
  const docs = [makeDoc('DOC-00001', 0, truthA), makeDoc('DOC-00002', 1, truthB)];

  const perfectA = extractionFrom(truthA);
  const resultA = makeResult('DOC-00001', perfectA, perfectA, {
    anomalies: [{ kind: 'duplicate_line', detail: 'Rapid strep appears twice.' }],
    latencyMs: 100,
  });

  const flawedB = extractionFrom(truthB);
  flawedB.patient.lastName = 'Smith';
  const resultB = makeResult('DOC-00002', flawedB, flawedB, {
    latencyMs: 300,
    costUsd: 0.01,
    egressBytes: 2048,
  });

  const metrics = computeMetrics(docs, [resultA, resultB]);

  it('handles exact match calculation when all scalar fields are correct but multiset codes differ', () => {
    const doc = makeDoc('DOC-00010', 0, truthA);
    const extraction = extractionFrom(truthA);
    // Keep all scalar fields correct, but change diagnosis code in resolved to be different
    const resolvedDiffCode = {
      ...extraction,
      diagnoses: [{ description: 'Streptococcal pharyngitis', icd10: 'J06.9' }], // J06.9 instead of J02.0
    };
    const res = makeResult('DOC-00010', extraction, resolvedDiffCode);
    const m = computeMetrics([doc], [res]);
    expect(m.exactMatchRate).toBe(0);
  });

  it('scores field accuracy as the exact micro-averaged fraction', () => {
    // 12 scalar fields per doc; doc B misses exactly patient.lastName.
    expect(metrics.fieldAccuracy).toBe(23 / 24);
    const lastName = metrics.perField.find((f) => f.field === 'patient.lastName')!;
    expect(lastName).toEqual({ field: 'patient.lastName', correct: 1, total: 2 });
  });

  it('counts only the fully correct doc toward exact match', () => {
    expect(metrics.exactMatchRate).toBe(0.5);
  });

  it('scores anomaly detection: one hit, one miss', () => {
    expect(metrics.anomalyDetection.precision).toBe(1);
    expect(metrics.anomalyDetection.recall).toBe(0.5);
    expect(metrics.anomalyDetection.f1).toBeCloseTo(2 / 3, 12);
  });

  it('computes nearest-rank latency percentiles from known latencies', () => {
    expect(metrics.latencyMsP50).toBe(100);
    expect(metrics.latencyMsP95).toBe(300);
  });

  it('sums cost and egress', () => {
    expect(metrics.totalCostUsd).toBe(0.01);
    expect(metrics.costPerDocUsd).toBeCloseTo(0.005, 12);
    expect(metrics.egressBytesTotal).toBe(2048);
  });

  it('reports docCount, parseRate, and perfect code match', () => {
    expect(metrics.docCount).toBe(2);
    expect(metrics.parseRate).toBe(1);
    expect(metrics.codeMatch).toEqual({ precision: 1, recall: 1, f1: 1 });
  });

  it('treats empty anomaly sets on both sides as perfect PRF1', () => {
    const cleanTruth: SuperbillTruth = {
      ...truthA,
      lines: [truthA.lines[0]],
      subtotalCents: 3000,
      printedTotalCents: 3000,
      injectedAnomalies: [],
    };
    const doc = makeDoc('DOC-00003', 2, cleanTruth);
    const extraction = extractionFrom(cleanTruth);
    const result = makeResult('DOC-00003', extraction, extraction, { latencyMs: 50 });
    const m = computeMetrics([doc], [result]);
    expect(m.anomalyDetection).toEqual({ precision: 1, recall: 1, f1: 1 });
  });

  it('handles empty results and missing extractions', () => {
    const empty = computeMetrics([], []);
    expect(empty).toMatchObject({
      provider: 'rules',
      model: 'unknown',
      docCount: 0,
      parseRate: 0,
      fieldAccuracy: 0,
      exactMatchRate: 0,
      costPerDocUsd: 0,
      latencyMsP50: 0,
      latencyMsP95: 0,
    });

    const result = makeResult('DOC-00001', null, null, {
      extraction: null,
      resolved: null,
      anomalies: [{ kind: 'charge_total_mismatch', detail: 'wrong' }],
    });
    const metrics = computeMetrics([makeDoc('DOC-00001', 0, truthA)], [result]);
    expect(metrics.parseRate).toBe(0);
    expect(metrics.codeMatch).toEqual({ precision: 0, recall: 0, f1: 0 });
    expect(metrics.anomalyDetection).toEqual({ precision: 0, recall: 0, f1: 0 });
  });

  it('rejects results for unknown documents', () => {
    expect(() => computeMetrics([], [makeResult('missing', perfectA, perfectA)])).toThrow(
      'no document',
    );
  });

  it('handles predicted null for missing_field anomaly and mismatched line count / multiset', () => {
    const missingFieldTruth: SuperbillTruth = {
      ...truthA,
      injectedAnomalies: ['missing_field'],
    };
    const doc = makeDoc('DOC-00004', 3, missingFieldTruth);
    const extraction = extractionFrom(missingFieldTruth);
    extraction.printedTotalCents = null; // predicted null
    // Same number of distinct keys, but different counts (to hit line 71 in multisetEquals)
    extraction.lines = [
      { description: 'Rapid strep', cpt: '87880', units: 1, chargeCents: 3000 },
      { description: 'Rapid strep', cpt: '87880', units: 1, chargeCents: 3000 },
      { description: 'Rapid strep', cpt: '87880', units: 1, chargeCents: 3000 },
    ];
    const result = makeResult('DOC-00004', extraction, extraction, {
      anomalies: [{ kind: 'missing_field', detail: 'missing' }],
    });
    const m = computeMetrics([doc], [result]);
    expect(m.exactMatchRate).toBe(0);
    expect(m.anomalyDetection).toEqual({ precision: 1, recall: 1, f1: 1 });
  });

  it('handles PRF1 when actual is nonzero and predicted is 0', () => {
    const truthWithAnomaly: SuperbillTruth = {
      ...truthA,
      injectedAnomalies: ['duplicate_line'],
    };
    const doc = makeDoc('DOC-00005', 4, truthWithAnomaly);
    const extraction = extractionFrom(truthWithAnomaly);
    const result = makeResult('DOC-00005', extraction, extraction, {
      anomalies: [], // predicted is 0, actual is 1 -> recall is 0
    });
    const m = computeMetrics([doc], [result]);
    expect(m.anomalyDetection.recall).toBe(0);
    expect(m.anomalyDetection.precision).toBe(0);
    expect(m.anomalyDetection.f1).toBe(0);
  });

  it('covers empty and mismatched multisets and zero-sized PRF1 inputs', () => {
    const clean = { ...truthA, diagnoses: [], lines: [], injectedAnomalies: [] };
    const doc = makeDoc('DOC-00006', 5, clean);
    const extraction = extractionFrom(clean);
    const result = makeResult('DOC-00006', extraction, extraction);
    const m = computeMetrics([doc], [result]);
    expect(m.codeMatch).toEqual({ precision: 1, recall: 1, f1: 1 });

    const mismatch = extractionFrom(truthA);
    mismatch.lines = [{ ...mismatch.lines[0], cpt: '00000' }, mismatch.lines[1]];
    const mismatchResult = makeResult('DOC-00007', mismatch, mismatch);
    const mismatchMetrics = computeMetrics([makeDoc('DOC-00007', 6, truthA)], [mismatchResult]);
    expect(mismatchMetrics.codeMatch.precision).toBeCloseTo(2 / 3);
    expect(mismatchMetrics.codeMatch.recall).toBeCloseTo(2 / 3);
  });

  it('covers recall with no actual anomalies and predicted anomalies', () => {
    const cleanTruth = { ...truthA, injectedAnomalies: [] };
    const doc = makeDoc('DOC-00008', 7, cleanTruth);
    const extraction = extractionFrom(cleanTruth);
    const result = makeResult('DOC-00008', extraction, extraction, {
      anomalies: [{ kind: 'duplicate_line', detail: 'false positive' }],
    });
    const m = computeMetrics([doc], [result]);
    expect(m.anomalyDetection).toEqual({ precision: 0, recall: 0, f1: 0 });
  });
});
