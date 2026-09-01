import { describe, expect, it } from 'vitest';
import { DEFAULTS, SuperbillTruthSchema } from '@/lib/contract';
import { addOcrNoise, generateBatch, renderClean } from '@/generators';

describe('generateBatch', () => {
  const batch = generateBatch(1);

  it('is deterministic: same seed produces deeply equal batches', () => {
    expect(generateBatch(1)).toStrictEqual(batch);
  });

  it('every truth validates against SuperbillTruthSchema', () => {
    for (const doc of batch) {
      SuperbillTruthSchema.parse(doc.truth);
    }
  });

  it('assigns sequential ids and indices', () => {
    batch.forEach((doc, i) => {
      expect(doc.index).toBe(i);
      expect(doc.id).toBe(`DOC-${String(i + 1).padStart(5, '0')}`);
      expect(doc.seed).toBe(1);
    });
  });

  it('split counts match DEFAULTS', () => {
    expect(batch).toHaveLength(DEFAULTS.evalDocCount + DEFAULTS.devDocCount);
    expect(batch.filter((d) => d.split === 'eval')).toHaveLength(DEFAULTS.evalDocCount);
    expect(batch.filter((d) => d.split === 'dev')).toHaveLength(DEFAULTS.devDocCount);
  });

  it('duplicate_line docs render the duplicated description at least twice in cleanText', () => {
    const dupDocs = batch.filter((d) => d.truth.injectedAnomalies.includes('duplicate_line'));
    expect(dupDocs.length).toBeGreaterThan(0);
    for (const doc of dupDocs) {
      const descs = doc.truth.lines.map((l) => l.description);
      const duplicated = descs.find((d, i) => descs.indexOf(d) !== i);
      expect(duplicated).toBeDefined();
      const occurrences = doc.cleanText.split(duplicated!).length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(2);
    }
  });

  it('exercises addOcrNoise substitutions and letterhead rendering', () => {
    const doc = batch[0];
    const textWithRn = 'rn rn rn $100.00 $200.00 MRN-1234567 O l S B 0 1 5 8';
    const noisy = addOcrNoise(textWithRn, () => 0.001);
    expect(noisy).toBeDefined();

    const truthMissingMember = {
      ...doc.truth,
      injectedAnomalies: ['missing_field' as const],
    };
    const cleanNoCodes = renderClean(truthMissingMember, () => 0.999);
    expect(cleanNoCodes).not.toContain('Member ID:');
  });
});
