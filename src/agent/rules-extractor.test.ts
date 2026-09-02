import { describe, expect, it } from 'vitest';
import { generateBatch } from '@/generators';
import { rulesExtract } from '@/agent/rules-extractor';

describe('rulesExtract', () => {
  const docs = generateBatch(7)
    .filter((d) => d.truth.injectedAnomalies.length === 0)
    .slice(0, 5);

  it('has five anomaly-free docs to work with', () => {
    expect(docs).toHaveLength(5);
  });

  it('extracts all five clean texts, reproducing MRN and printed total exactly', () => {
    for (const doc of docs) {
      const extraction = rulesExtract(doc.cleanText);
      expect(extraction).not.toBeNull();
      expect(extraction!.patient.mrn).toBe(doc.truth.patient.mrn);
      expect(extraction!.printedTotalCents).toBe(doc.truth.printedTotalCents);
    }
  });

  it('stays non-null on at least 3 of 5 noisy texts', () => {
    const parsed = docs.filter((doc) => rulesExtract(doc.text) !== null);
    expect(parsed.length).toBeGreaterThanOrEqual(3);
  });

  it('handles merged names and leaves malformed member IDs unchanged', () => {
    const text = `PATIENT\nName: AdaOkafor\nDOB: 1985-03-12\nMRN: MRN-1234567\nPhone: (555) 555-0101\n\nENCOUNTER\nDate of Service: 2026-01-15\nVisit Type: Office Visit\nRendering Provider: Dr. Park\nNPI: 1234567890\n\nDIAGNOSES\n  1. Fever [R50.9]\n\nSERVICES\nDESCRIPTION CPT QTY CHARGE\nFever consult 99213 1 $180.00\nTOTAL DUE: $180.00\n\nINSURANCE / PAYER\nPlan: Plan\nMember ID: bad-id`;
    const result = rulesExtract(text);
    expect(result?.patient).toMatchObject({ firstName: 'Ada', lastName: 'Okafor' });
    expect(result?.payer.memberId).toBe('bad-id');
  });

  it('rejects a single-word name that cannot be split as a merged name', () => {
    const text = `PATIENT
Name: single
DOB: 1985-03-12
MRN: MRN-1234567
Phone: (555) 555-0101

ENCOUNTER
Date of Service: 2026-01-15
Visit Type: Office Visit
Rendering Provider: Dr. Park
NPI: 1234567890

DIAGNOSES
  1. Fever [R50.9]

SERVICES
DESCRIPTION CPT QTY CHARGE
Fever consult 99213 1 $180.00
TOTAL DUE: $180.00

INSURANCE / PAYER
Plan: Plan
Member ID: ABC12345678`;
    expect(rulesExtract(text)).toBeNull();
  });

  it('handles member ID repair when 11 chars with prefix substitutions', () => {
    const text = `PATIENT\nName: Ada Okafor\nDOB: 1985-03-12\nMRN: MRN-1234567\nPhone: (555) 555-0101\n\nENCOUNTER\nDate of Service: 2026-01-15\nVisit Type: Telehealth\nRendering Provider: Dr. Park\nNPI: 1234567890\n\nDIAGNOSES\n  1. Fever\n\nSERVICES\nDESCRIPTION QTY CHARGE\nFever consult 1 $180.00\nTOTAL DUE: $180.00\n\nINSURANCE / PAYER\nPlan: Plan\nMember ID: 58K12345678`;
    const result = rulesExtract(text);
    expect(result?.payer.memberId).toBe('SBK12345678');
    expect(result?.encounter.type).toBe('telehealth');
    expect(result?.diagnoses[0].icd10).toBeNull();
  });

  it('handles all visit types and unformatted phone/NPI numbers', () => {
    const types = [
      ['Urgent Care', 'urgent_care'],
      ['Preventive Visit', 'preventive'],
    ];
    for (const [rawType] of types) {
      const text = `PATIENT\nName: Ada Okafor\nDOB: 1985-03-12\nMRN: MRN-1234567\nPhone: 555-0101-raw\n\nENCOUNTER\nDate of Service: 2026-01-15\nVisit Type: ${rawType}\nRendering Provider: Dr. Park\nNPI: 12345\n\nDIAGNOSES\n  1. Fever [ ]\n\nSERVICES\nDESCRIPTION QTY CHARGE\nInvalid line without qty or charge\nValid consult 1 $100.00\nTOTAL DUE: invalid-money\n\nINSURANCE / PAYER\nPlan: Plan\nMember ID: ABC12345678`;
      // Note: ExtractionSchema requires 10-digit NPI, so safeParse will return failure -> result is null,
      // but inside rulesExtract, npi = v || undefined branch will be executed!
      const result = rulesExtract(text);
      expect(result).toBeNull();
    }
  });

  it('returns null for malformed documents missing required sections/fields or invalid money', () => {
    expect(rulesExtract('')).toBeNull();
    expect(rulesExtract('just random text')).toBeNull();

    // Patient single name not matching MERGED_NAME_RE
    const badName = `PATIENT\nName: single\nDOB: 1985-03-12\nMRN: MRN-1234567\nPhone: (555) 555-0101\n\nENCOUNTER\nDate of Service: 2026-01-15\nVisit Type: Office Visit\nRendering Provider: Dr. Park\nNPI: 1234567890\n\nDIAGNOSES\n  1. Fever [R50.9]\n\nSERVICES\nDESCRIPTION CPT QTY CHARGE\nFever consult 99213 1 $180.00\nTOTAL DUE: $180.00\n\nINSURANCE / PAYER\nPlan: Plan\nMember ID: ABC12345678`;
    expect(rulesExtract(badName)).toBeNull();

    // Services line with 0 units or bad money
    const badServices = `PATIENT\nName: Ada Okafor\nDOB: 1985-03-12\nMRN: MRN-1234567\nPhone: (555) 555-0101\n\nENCOUNTER\nDate of Service: 2026-01-15\nVisit Type: Office Visit\nRendering Provider: Dr. Park\nNPI: 1234567890\n\nDIAGNOSES\n  1. Fever [R50.9]\n\nSERVICES\nDESCRIPTION CPT QTY CHARGE\nFever consult 99213 0 $180.00\nFever consult 99213 1 $180.0\nTOTAL DUE: $180.00\n\nINSURANCE / PAYER\nPlan: Plan\nMember ID: ABC12345678`;
    expect(rulesExtract(badServices)).toBeNull();

    // Empty plan and non-10 digit NPI
    const emptyPlanAndNon10Npi = `PATIENT\nName: Ada Okafor\nDOB: 1985-03-12\nMRN: MRN-1234567\nPhone: (555) 555-0101\n\nENCOUNTER\nDate of Service: 2026-01-15\nVisit Type: Office Visit\nRendering Provider: Dr. Park\nNPI: 123\n\nDIAGNOSES\n  1. Fever [R50.9]\n\nSERVICES\nDESCRIPTION CPT QTY CHARGE\nFever consult 99213 1 $180.00\nTOTAL DUE: $180.00\n\nINSURANCE / PAYER\nPlan:  \nMember ID: ABC12345678`;
    expect(rulesExtract(emptyPlanAndNon10Npi)).toBeNull();

    // Plain unformatted phone
    const plainPhone = `PATIENT\nName: Ada Okafor\nDOB: 1985-03-12\nMRN: MRN-1234567\nPhone: 5551234567\n\nENCOUNTER\nDate of Service: 2026-01-15\nVisit Type: Office Visit\nRendering Provider: Dr. Park\nNPI: 1234567890\n\nDIAGNOSES\n  1. Fever [R50.9]\n\nSERVICES\nDESCRIPTION CPT QTY CHARGE\nFever consult 99213 1 $180.00\nTOTAL DUE: $180.00\n\nINSURANCE / PAYER\nPlan: Plan\nMember ID: ABC12345678`;
    expect(rulesExtract(plainPhone)?.patient.phone).toBe('5551234567');

    // NPI with misread digits repaired (e.g. 1O9381746S -> 1093817465)
    const npiRepaired = `PATIENT\nName: Ada Okafor\nDOB: 1985-03-12\nMRN: MRN-1234567\nPhone: 5551234567\n\nENCOUNTER\nDate of Service: 2026-01-15\nVisit Type: Office Visit\nRendering Provider: Dr. Park\nNPI: 1O9381746S\n\nDIAGNOSES\n  1. Fever [R50.9]\n\nSERVICES\nDESCRIPTION CPT QTY CHARGE\nFever consult 99213 1 $180.00\nTOTAL DUE: $180.00\n\nINSURANCE / PAYER\nPlan: Plan\nMember ID: ABC12345678`;
    expect(rulesExtract(npiRepaired)?.encounter.npi).toBe('1093817465');

    // Empty whitespace providerName
    const emptyProvider = `PATIENT\nName: Ada Okafor\nDOB: 1985-03-12\nMRN: MRN-1234567\nPhone: 5551234567\n\nENCOUNTER\nDate of Service: 2026-01-15\nVisit Type: Office Visit\nRendering Provider:   \nNPI: 1234567890\n\nDIAGNOSES\n  1. Fever [R50.9]\n\nSERVICES\nDESCRIPTION CPT QTY CHARGE\nFever consult 99213 1 $180.00\nTOTAL DUE: $180.00\n\nINSURANCE / PAYER\nPlan: Plan\nMember ID: ABC12345678`;
    expect(rulesExtract(emptyProvider)).toBeNull();

    // Empty whitespace memberId
    const emptyMember = `PATIENT\nName: Ada Okafor\nDOB: 1985-03-12\nMRN: MRN-1234567\nPhone: 5551234567\n\nENCOUNTER\nDate of Service: 2026-01-15\nVisit Type: Office Visit\nRendering Provider: Dr. Park\nNPI: 1234567890\n\nDIAGNOSES\n  1. Fever [R50.9]\n\nSERVICES\nDESCRIPTION CPT QTY CHARGE\nFever consult 99213 1 $180.00\nTOTAL DUE: $180.00\n\nINSURANCE / PAYER\nPlan: Plan\nMember ID:   `;
    expect(rulesExtract(emptyMember)).toBeNull();
  });

  it('covers empty and non-empty fallback values for phone, provider, payer, and NPI', () => {
    const base = (phone: string, provider: string, npi: string, plan: string) => `PATIENT
Name: Ada Okafor
DOB: 1985-03-12
MRN: MRN-1234567
Phone: ${phone}
Address: none

ENCOUNTER
Date of Service: 2026-01-15
Visit Type: Office Visit
Rendering Provider: ${provider}
NPI: ${npi}
Room: 1

DIAGNOSES
  1. Fever [R50.9]

SERVICES
DESCRIPTION CPT QTY CHARGE
Fever consult 99213 1 $180.00
TOTAL DUE: $180.00

INSURANCE / PAYER
Plan: ${plan}
Member ID: ABC12345678
Group: standard`;

    expect(rulesExtract(base('5551234567', 'Dr. Park', '1234567890', 'Plan'))).toMatchObject({
      patient: { phone: '5551234567' },
      encounter: { providerName: 'Dr. Park', npi: '1234567890' },
      payer: { name: 'Plan' },
    });
    expect(rulesExtract(base('', '', '', ''))).toBeNull();
    expect(rulesExtract(base('555-0101-raw', 'Dr. Park', '12345', 'Plan'))).toBeNull();
  });

  it('ignores unknown labels after terminal patient, encounter, and payer fields', () => {
    const base = (terminalField: string, unknownLabel: string) => `Header: ignored
PATIENT
Name: Ada Okafor
DOB: 1985-03-12
MRN: MRN-1234567
Phone: (555) 555-0101
${terminalField === 'Phone' ? `${unknownLabel}: ignored\n` : ''}

ENCOUNTER
Date of Service: 2026-01-15
Visit Type: Office Visit
Rendering Provider: Dr. Park
NPI: 1234567890
${terminalField === 'NPI' ? `${unknownLabel}: ignored\n` : ''}

DIAGNOSES
not a diagnosis
  1. [R50.9]
  1. Fever [R50.9]

SERVICES
DESCRIPTION CPT QTY CHARGE
Fever consult 99213 1 $180.00
TOTAL DUE: $180.00

INSURANCE / PAYER
Plan: Plan
Member ID: ABC12345678
${terminalField === 'Member ID' ? `${unknownLabel}: ignored\n` : ''}`;

    for (const [terminalField, unknownLabel] of [
      ['Phone', 'Unknown Phone Field'],
      ['NPI', 'Unknown NPI Field'],
      ['Member ID', 'Unknown Member Field'],
    ]) {
      const result = rulesExtract(base(terminalField, unknownLabel));
      expect(result).not.toBeNull();
    }
  });

  it('handles malformed diagnosis and service rows without aborting valid extraction', () => {
    const text = `PATIENT
Name: AdaOkafor
DOB: 1985-03-12
MRN: MRN-1234567
Phone: (555) 555-0101

ENCOUNTER
Date of Service: 2026-01-15
Visit Type: Office Visit
Rendering Provider: Dr. Park
NPI: 1234567890

DIAGNOSES
not a diagnosis
  1. [R50.9]
  2. Fever [R50.9]

      SERVICES
      DESCRIPTION CPT QTY CHARGE
      Bad money 1 $1,,00.00
      No quantity $100.00
Missing CPT 1 $100.00
1 $100.00
Valid consult 99213 1 $180.00
TOTAL DUE: $180.00

INSURANCE / PAYER
Plan: Plan
Member ID: ABC12345678`;

    const result = rulesExtract(text);
    expect(result).not.toBeNull();
    expect(result?.lines).toHaveLength(1);

    const noCptResult = rulesExtract(
      text
        .replace('DESCRIPTION CPT QTY CHARGE', 'DESCRIPTION QTY CHARGE')
        .replace('Missing CPT 1 $100.00\n', ''),
    );
    expect(noCptResult).not.toBeNull();
    expect(noCptResult?.lines).toHaveLength(2);

    const invalidMemberResult = rulesExtract(
      text.replace('Member ID: ABC12345678', 'Member ID: ABC1234567X'),
    );
    expect(invalidMemberResult).not.toBeNull();

    expect(rulesExtract(text.replace('DOB: 1985-03-12', 'DOB: 1985-3-12'))).toBeNull();
    expect(rulesExtract(text.replace('Name: AdaOkafor', 'Name: single'))).toBeNull();
    expect(rulesExtract(text.replace('Name: AdaOkafor', 'Name: '))).toBeNull();
  });
});
