import { describe, expect, it, vi } from 'vitest';
import { runDocument } from '@/agent/run';
import * as extractModule from '@/agent/extract';
import * as matchModule from '@/agent/match';
import * as rulesModule from '@/agent/rules-extractor';
import * as anomalyModule from '@/agent/anomaly';
import type { Extraction, ResolvedExtraction } from '@/lib/contract';

vi.mock('ai', () => ({
  generateObject: vi.fn(),
  NoObjectGeneratedError: {
    isInstance: (error: unknown) =>
      error instanceof Error && error.name === 'NoObjectGeneratedError',
  },
}));

vi.mock('@/lib/providers', () => ({
  computeCostUsd: vi.fn((_provider, _model, _usage) => (_provider === 'groq' ? 0.001 : 0)),
  computeEgressBytes: vi.fn((_provider, _promptText) => (_provider === 'groq' ? 100 : 0)),
  getLanguageModel: vi.fn(),
}));

describe('runDocument', () => {
  const dummyExtraction: Extraction = {
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
      providerName: 'Dr. Park',
      npi: '1234567890',
    },
    diagnoses: [{ description: 'Fever', icd10: 'R50.9' }],
    lines: [{ description: 'Consult', cpt: '99213', units: 1, chargeCents: 18000 }],
    payer: { name: 'Aetna', memberId: 'ABC12345678' },
    printedTotalCents: 18000,
  };

  const dummyResolved: ResolvedExtraction = {
    ...dummyExtraction,
    diagnoses: [{ description: 'Fever', icd10: 'R50.9' }],
    lines: [{ description: 'Consult', cpt: '99213', units: 1, chargeCents: 18000 }],
  };

  it('runs successfully with rules provider and detects anomalies', async () => {
    vi.spyOn(rulesModule, 'rulesExtract').mockReturnValueOnce(dummyExtraction);
    vi.spyOn(matchModule, 'resolveCodes').mockReturnValueOnce(dummyResolved);
    vi.spyOn(anomalyModule, 'detectAnomalies').mockReturnValueOnce([
      { kind: 'duplicate_line', detail: 'duplicated' },
    ]);

    const res = await runDocument({ id: 'DOC-001', text: 'sample text' }, { provider: 'rules' });
    expect(res.documentId).toBe('DOC-001');
    expect(res.provider).toBe('rules');
    expect(res.model).toBe('deterministic');
    expect(res.extraction).toEqual(dummyExtraction);
    expect(res.resolved).toEqual(dummyResolved);
    expect(res.anomalies).toEqual([{ kind: 'duplicate_line', detail: 'duplicated' }]);
    expect(res.error).toBeNull();
    expect(res.egressBytes).toBe(0);
    expect(res.costUsd).toBe(0);
  });

  it('sets error when rulesExtract returns null', async () => {
    vi.spyOn(rulesModule, 'rulesExtract').mockReturnValueOnce(null);

    const res = await runDocument({ id: 'DOC-002', text: 'unparseable' }, { provider: 'rules' });
    expect(res.extraction).toBeNull();
    expect(res.resolved).toBeNull();
    expect(res.anomalies).toEqual([]);
    expect(res.error).toBe('unrecoverable document structure');
  });

  it('catches errors thrown during rulesExtract', async () => {
    vi.spyOn(rulesModule, 'rulesExtract').mockImplementationOnce(() => {
      throw new Error('rules explosion');
    });

    const res = await runDocument({ id: 'DOC-003', text: 'crash' }, { provider: 'rules' });
    expect(res.extraction).toBeNull();
    expect(res.error).toBe('rules explosion');

    // String throw
    vi.spyOn(rulesModule, 'rulesExtract').mockImplementationOnce(() => {
      throw 'string error';
    });
    const resString = await runDocument({ id: 'DOC-003-b', text: 'crash' }, { provider: 'rules' });
    expect(resString.error).toBe('string error');
  });

  it('runs with hosted llm provider (groq)', async () => {
    vi.spyOn(extractModule, 'llmExtract').mockResolvedValueOnce({
      extraction: dummyExtraction,
      usage: { inputTokens: 100, outputTokens: 50 },
      modelId: 'openai/gpt-oss-120b',
      error: null,
    });
    vi.spyOn(matchModule, 'resolveCodes').mockReturnValueOnce(dummyResolved);
    vi.spyOn(anomalyModule, 'detectAnomalies').mockReturnValueOnce([]);

    const res = await runDocument(
      { id: 'DOC-004', text: 'groq text' },
      { provider: 'groq', model: 'openai/gpt-oss-120b' },
    );
    expect(res.provider).toBe('groq');
    expect(res.model).toBe('openai/gpt-oss-120b');
    expect(res.extraction).toEqual(dummyExtraction);
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(res.egressBytes).toBeGreaterThan(0);
    expect(res.costUsd).toBeGreaterThan(0);
    expect(res.error).toBeNull();
  });

  it('handles resolveCodes returning null or throwing error', async () => {
    vi.spyOn(rulesModule, 'rulesExtract').mockReturnValueOnce(dummyExtraction);
    vi.spyOn(matchModule, 'resolveCodes').mockReturnValueOnce(null);

    const res = await runDocument({ id: 'DOC-005', text: 'text' }, { provider: 'rules' });
    expect(res.extraction).toEqual(dummyExtraction);
    expect(res.resolved).toBeNull();
    expect(res.anomalies).toEqual([]);
    expect(res.error).toBeNull();

    // Throwing error during resolveCodes
    vi.spyOn(rulesModule, 'rulesExtract').mockReturnValueOnce(dummyExtraction);
    vi.spyOn(matchModule, 'resolveCodes').mockImplementationOnce(() => {
      throw new Error('resolve failure');
    });
    const resErr = await runDocument({ id: 'DOC-006', text: 'text' }, { provider: 'rules' });
    expect(resErr.error).toBe('resolve failure');
  });
});
