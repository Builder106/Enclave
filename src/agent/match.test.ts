import { describe, expect, it } from 'vitest';
import { CPT_CODES, ICD10_CODES } from '@/lib/codes';
import type { CodeEntry, Extraction } from '@/lib/contract';
import { matchCode, resolveCodes } from '@/agent/match';

describe('matchCode', () => {
  it('hits on an exact description', () => {
    const entry = CPT_CODES.find((e) => e.code === '80053')!;
    const match = matchCode(entry.description, CPT_CODES);
    expect(match?.entry.code).toBe('80053');
  });

  it('hits on a synonym', () => {
    const match = matchCode('strep throat', ICD10_CODES);
    expect(match?.entry.code).toBe('J02.0');
  });

  it('hits on a casing/punctuation variant', () => {
    const match = matchCode('comprehensive, METABOLIC panel!!', CPT_CODES);
    expect(match?.entry.code).toBe('80053');
  });

  it('handles candidates with empty descriptions/synonyms and restoration of digits', () => {
    const customEntries: CodeEntry[] = [
      { code: 'EMPTY', description: '', synonyms: [''] },
      { code: 'RESTORED', description: 'headache cephalalgia', synonyms: [] },
    ];
    // "headache cepha1gia" -> restored is "headache cephalalgia", which matches RESTORED
    const match = matchCode('headache cepha1gia', customEntries);
    expect(match?.entry.code).toBe('RESTORED');

    // Empty candidates list or unmatchable
    expect(matchCode('something', [{ code: 'EMPTY', description: '', synonyms: [''] }])).toBeNull();
  });

  it('repairs OCR substitutions in printed ICD and CPT codes', () => {
    const extraction = {
      ...({} as Extraction),
      patient: {
        firstName: 'A',
        lastName: 'B',
        dob: '1985-03-12',
        mrn: 'MRN-1234567',
        phone: '5555555555',
      },
      encounter: {
        date: '2026-01-01',
        type: 'office_visit' as const,
        providerName: 'Dr. A',
        npi: '1234567890',
      },
      diagnoses: [{ description: 'Fever', icd10: 'R5O.9' }],
      lines: [{ description: 'CMP', cpt: '8O053', units: 1, chargeCents: 4500 }],
      payer: { name: 'Plan', memberId: 'ABC12345678' },
      printedTotalCents: 4500,
    };
    const resolved = resolveCodes(extraction);
    expect(resolved?.diagnoses[0].icd10).toBe('R50.9');
    expect(resolved?.lines[0].cpt).toBe('80053');
  });

  it('returns null when a missing description cannot be matched', () => {
    const extraction = {
      ...({} as Extraction),
      diagnoses: [{ description: 'unmatchable', icd10: null }],
      lines: [],
    };
    expect(resolveCodes(extraction)).toBeNull();
  });
});

describe('resolveCodes', () => {
  it('fills null codes from verbatim descriptions and keeps valid printed codes', () => {
    const dxEntry = ICD10_CODES.find((e) => e.code === 'J20.9')!;
    const lineEntry = CPT_CODES.find((e) => e.code === '84443')!;

    const extraction: Extraction = {
      patient: {
        firstName: 'Mae',
        lastName: 'Carver',
        dob: '1972-04-18',
        mrn: 'MRN-2345678',
        phone: '(555) 555-0142',
      },
      encounter: {
        date: '2026-02-11',
        type: 'telehealth',
        providerName: 'Dr. Ada Yu',
        npi: '1093817465',
      },
      diagnoses: [
        { description: dxEntry.description, icd10: null },
        { description: 'Acute upper respiratory infection, unspecified', icd10: 'J06.9' },
      ],
      lines: [
        { description: lineEntry.description, cpt: null, units: 1, chargeCents: 6000 },
        { description: 'Office visit, established', cpt: '99213', units: 1, chargeCents: 18000 },
      ],
      payer: { name: 'Cigna', memberId: 'KQM00412233' },
      printedTotalCents: 24000,
    };
    const resolved = resolveCodes(extraction);
    expect(resolved).not.toBeNull();
    expect(resolved!.diagnoses[0].icd10).toBe(dxEntry.code);
    expect(resolved!.diagnoses[1].icd10).toBe('J06.9');
    expect(resolved!.lines[0].cpt).toBe(lineEntry.code);
    expect(resolved!.lines[1].cpt).toBe('99213');
  });

  it('handles empty descriptions and phrases gracefully in matchCode', () => {
    expect(matchCode('', CPT_CODES)).toBeNull();
    expect(matchCode('!!!', CPT_CODES)).toBeNull();
  });

  it('leaves unknown printed ICD-10 and CPT codes uppercase as-is', () => {
    const extraction: Extraction = {
      patient: {
        firstName: 'A',
        lastName: 'B',
        dob: '1985-03-12',
        mrn: 'MRN-1234567',
        phone: '5555555555',
      },
      encounter: {
        date: '2026-01-01',
        type: 'office_visit',
        providerName: 'Dr. A',
        npi: '1234567890',
      },
      diagnoses: [{ description: 'Custom dx', icd10: 'custom.99' }],
      lines: [{ description: 'Custom line', cpt: 'customcpt', units: 1, chargeCents: 1000 }],
      payer: { name: 'Plan', memberId: 'ABC12345678' },
      printedTotalCents: 1000,
    };
    const resolved = resolveCodes(extraction);
    expect(resolved?.diagnoses[0].icd10).toBe('CUSTOM.99');
    expect(resolved?.lines[0].cpt).toBe('CUSTOMCPT');
  });

  it('returns null when a missing line description cannot be matched', () => {
    const extraction: Extraction = {
      patient: {
        firstName: 'A',
        lastName: 'B',
        dob: '1985-03-12',
        mrn: 'MRN-1234567',
        phone: '5555555555',
      },
      encounter: {
        date: '2026-01-01',
        type: 'office_visit',
        providerName: 'Dr. A',
        npi: '1234567890',
      },
      diagnoses: [{ description: 'Fever', icd10: 'R50.9' }],
      lines: [{ description: 'unmatchable service xyz', cpt: null, units: 1, chargeCents: 1000 }],
      payer: { name: 'Plan', memberId: 'ABC12345678' },
      printedTotalCents: 1000,
    };
    expect(resolveCodes(extraction)).toBeNull();
  });
});
