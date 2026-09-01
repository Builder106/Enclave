import { describe, expect, it, vi } from 'vitest';
import { llmExtract, normalizeExtraction } from '@/agent/extract';
import type { LenientExtraction } from '@/lib/contract';

const { getLanguageModel, generateObject } = vi.hoisted(() => ({
  getLanguageModel: vi.fn(),
  generateObject: vi.fn(),
}));

vi.mock('@/lib/providers', () => ({ getLanguageModel }));
vi.mock('ai', () => ({
  generateObject,
  NoObjectGeneratedError: {
    isInstance: (error: unknown) =>
      error instanceof Error && error.name === 'NoObjectGeneratedError',
  },
}));

const input: LenientExtraction = {
  patient: {
    firstName: '  Ada   ',
    lastName: '  okafor ',
    dob: '3/12/1985',
    mrn: 'mrn-1234567 ',
    phone: '(555) 555-0101',
  },
  encounter: {
    date: '02-20-2026',
    type: 'telehealth',
    providerName: ' Dr.   Yu ',
    npi: '109 381 7465',
  },
  diagnoses: [{ description: '  Fever   unspecified ', icd10: ' r50.9 ' }],
  lines: [{ description: ' Lipid panel ', cpt: ' 80061 ', units: 1, chargeCents: 5000 }],
  payer: { name: ' Cigna ', memberId: ' KQM1 ' },
  printedTotalCents: 5000,
};

describe('normalizeExtraction', () => {
  it('normalizes whitespace, dates, codes, and numeric identifiers', () => {
    expect(normalizeExtraction(input)).toEqual({
      extraction: {
        patient: {
          firstName: 'Ada',
          lastName: 'okafor',
          dob: '1985-03-12',
          mrn: 'MRN-1234567',
          phone: '(555) 555-0101',
        },
        encounter: {
          date: '2026-02-20',
          type: 'telehealth',
          providerName: 'Dr. Yu',
          npi: '1093817465',
        },
        diagnoses: [{ description: 'Fever unspecified', icd10: 'R50.9' }],
        lines: [{ description: 'Lipid panel', cpt: '80061', units: 1, chargeCents: 5000 }],
        payer: { name: 'Cigna', memberId: 'KQM1' },
        printedTotalCents: 5000,
      },
      error: null,
    });
  });

  it('preserves ISO dates and nullable codes', () => {
    const result = normalizeExtraction({
      ...input,
      patient: { ...input.patient, dob: '1985-03-12' },
      encounter: { ...input.encounter, date: '2026-02-20' },
      diagnoses: [{ ...input.diagnoses[0], icd10: null }],
      lines: [{ ...input.lines[0], cpt: null }],
    });
    expect(result.extraction?.patient.dob).toBe('1985-03-12');
    expect(result.extraction?.diagnoses[0].icd10).toBeNull();
    expect(result.extraction?.lines[0].cpt).toBeNull();
  });

  it('leaves an unrecognized date shape unchanged', () => {
    expect(
      normalizeExtraction({ ...input, patient: { ...input.patient, dob: 'not-a-date' } }).extraction
        ?.patient.dob,
    ).toBe('not-a-date');
  });

  it('returns normalized model output and usage', async () => {
    getLanguageModel.mockReturnValue({ model: 'fake-model', modelId: 'fake-id' });
    generateObject.mockResolvedValue({
      object: input,
      usage: { inputTokens: 12, outputTokens: 7 },
    });
    await expect(llmExtract('document', 'local')).resolves.toMatchObject({
      extraction: expect.any(Object),
      modelId: 'fake-id',
      usage: { inputTokens: 12, outputTokens: 7 },
      error: null,
    });

    // When result.usage tokens are undefined
    generateObject.mockResolvedValueOnce({ object: input, usage: {} });
    await expect(llmExtract('document', 'local')).resolves.toMatchObject({
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  it('returns provider errors and preserves NoObjectGenerated usage', async () => {
    getLanguageModel.mockReturnValue({ model: 'fake-model', modelId: 'fake-id' });
    const error = new Error('could not generate');
    error.name = 'NoObjectGeneratedError';
    Object.assign(error, { usage: { inputTokens: 3, outputTokens: 4 } });
    generateObject.mockRejectedValueOnce(error);
    await expect(llmExtract('document', 'local')).resolves.toMatchObject({
      extraction: null,
      modelId: 'fake-id',
      usage: { inputTokens: 3, outputTokens: 4 },
      error: 'could not generate',
    });

    const errorNoUsage = new Error('no usage error');
    errorNoUsage.name = 'NoObjectGeneratedError';
    generateObject.mockRejectedValueOnce(errorNoUsage);
    await expect(llmExtract('document', 'local')).resolves.toMatchObject({
      extraction: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      error: 'no usage error',
    });

    generateObject.mockRejectedValueOnce('plain failure');
    await expect(llmExtract('document', 'local')).resolves.toMatchObject({
      extraction: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      error: 'plain failure',
    });
  });
});
