import { describe, expect, it } from 'vitest';
import { generateSuperbill } from '@/generators/superbill';
import { ICD10_CODES } from '@/lib/codes';
import type { CodeEntry } from '@/lib/contract';

describe('generateSuperbill', () => {
  it('generates clean superbills with custom codes and empty synonyms/missing typical fees', () => {
    const customCodes = {
      icd10: [{ code: 'Z00.00', description: 'General exam', synonyms: [] }] as CodeEntry[],
      cpt: [{ code: '99213', description: 'Office visit', synonyms: [] }] as CodeEntry[], // no typicalFeeCents
    };

    // Rng that forces:
    // 1) rng() >= DEFAULTS.anomalyRate (clean doc, no injected anomaly)
    // 2) picks first item everywhere
    const rng = () => 0.999;
    const truth = generateSuperbill(rng, customCodes);
    expect(truth.diagnoses[0].description).toBe('General exam');
    expect(truth.lines[0].description).toBe('Office visit');
    expect(truth.injectedAnomalies).toEqual([]);
    expect(truth.printedTotalCents).toBe(truth.subtotalCents);
  });

  it('handles injected charge_total_mismatch with dropped lines and digit slip', () => {
    const customCodes = {
      icd10: ICD10_CODES.slice(0, 3),
      cpt: [
        { code: '99213', description: 'Office visit', synonyms: [], typicalFeeCents: 10000 },
        { code: '80053', description: 'CMP', synonyms: [], typicalFeeCents: 5000 },
      ],
    };

    // Low constant rng (0.1 < 0.2 anomaly rate, pick index 0 = charge_total_mismatch):
    const truth = generateSuperbill(() => 0.1, customCodes);
    expect(truth.injectedAnomalies).toContain('charge_total_mismatch');
    expect(truth.printedTotalCents).not.toBe(truth.subtotalCents);

    // Single line charge_total_mismatch (forcing lines.length === 1 so rng() < 0.5 is not used for dropping)
    const singleCode = {
      icd10: ICD10_CODES.slice(0, 1),
      cpt: [{ code: '99213', description: 'Office visit', synonyms: [], typicalFeeCents: 10000 }],
    };
    const singleTruth = generateSuperbill(() => 0.05, singleCode);
    expect(singleTruth.injectedAnomalies).toContain('charge_total_mismatch');
    expect(singleTruth.printedTotalCents).not.toBe(singleTruth.subtotalCents);
  });

  it('handles injected duplicate_line anomaly', () => {
    const customCodes = {
      icd10: [{ code: 'Z00.00', description: 'General exam', synonyms: [] }],
      cpt: [{ code: '99213', description: 'Office visit', synonyms: [] }],
    };
    // With 1 dx (no synonyms) and 1 line (no synonyms):
    // Total RNG calls before anomaly check: exactly 21 calls.
    // Call 22 is anomalyRate check (< 0.2 triggers anomaly).
    // Call 23 is pick(ANOMALY_KINDS) -> 0.35 * 4 = 1.4 -> index 1 ("duplicate_line").
    // Call 24 is pickInt(0, lines.length - 1) for duplicate_line index.
    let call = 0;
    const rng = () => {
      call++;
      if (call === 22) return 0.05;
      return 0.35;
    };
    const truth = generateSuperbill(rng, customCodes);
    expect(truth.injectedAnomalies).toContain('duplicate_line');
    expect(truth.lines.length).toBe(2);
  });

  it('handles unit_charge_outlier with known typicalFeeCents and digitSlip with single digit value', () => {
    const knownFeeCodes = {
      icd10: [{ code: 'Z00.00', description: 'General exam', synonyms: [] }],
      cpt: [{ code: '99213', description: 'Office visit', synonyms: [], typicalFeeCents: 15000 }],
    };
    // Call 22 is anomalyRate (< 0.2)
    // Call 23 is pick(ANOMALY_KINDS) -> 0.55 * 4 = 2 ("unit_charge_outlier")
    let call = 0;
    const rng = () => {
      call++;
      if (call === 22) return 0.05;
      return 0.55;
    };
    const truth = generateSuperbill(rng, knownFeeCodes);
    expect(truth.injectedAnomalies).toContain('unit_charge_outlier');
    expect(truth.lines[0].chargeCents).toBeGreaterThan(15000 * 5);

    // Test multi-unit service lines (rng() >= 0.75 in units calculation)
    const multiUnitCodes = {
      icd10: [{ code: 'Z00.00', description: 'General exam', synonyms: [] }],
      cpt: [{ code: '99213', description: 'Office visit', synonyms: [] }],
    };
    const multiUnitTruth = generateSuperbill(() => 0.85, multiUnitCodes);
    expect(multiUnitTruth.lines[0].units).toBeGreaterThanOrEqual(2);
  });

  it('covers missing outlier fees and zero-charge mismatch fallbacks', () => {
    const noFeeCodes = {
      icd10: [{ code: 'Z00.00', description: 'General exam', synonyms: [] }],
      cpt: [{ code: '99213', description: 'Office visit', synonyms: [] }],
    };
    let outlierCall = 0;
    const outlierRng = () => {
      outlierCall++;
      if (outlierCall === 22) return 0.05;
      if (outlierCall === 23) return 0.55;
      return 0.35;
    };
    const outlierTruth = generateSuperbill(outlierRng, noFeeCodes);
    expect(outlierTruth.injectedAnomalies).toContain('unit_charge_outlier');

    const zeroFeeCodes = {
      icd10: [{ code: 'Z00.00', description: 'General exam', synonyms: [] }],
      cpt: [
        { code: '99213', description: 'Office visit', synonyms: [], typicalFeeCents: 0 },
        { code: '80053', description: 'CMP', synonyms: [], typicalFeeCents: 0 },
      ],
    };
    let mismatchCall = 0;
    const mismatchRng = () => {
      mismatchCall++;
      return mismatchCall <= 25 ? 0.9 : 0.05;
    };
    const mismatchTruth = generateSuperbill(mismatchRng, zeroFeeCodes);
    expect(mismatchTruth.injectedAnomalies).toContain('charge_total_mismatch');
    expect(mismatchTruth.lines.length).toBeGreaterThan(1);
    expect(mismatchTruth.subtotalCents).toBe(0);
    expect(mismatchTruth.printedTotalCents).toBeGreaterThan(0);
  });
});
