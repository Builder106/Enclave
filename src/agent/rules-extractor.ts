import { ExtractionSchema, type EncounterType, type Extraction } from '@/lib/contract';

type Section = 'none' | 'patient' | 'encounter' | 'diagnoses' | 'services' | 'payer';

const SECTION_NAMES: Record<string, Section | undefined> = {
  PATIENT: 'patient',
  ENCOUNTER: 'encounter',
  DIAGNOSES: 'diagnoses',
  SERVICES: 'services',
  INSURANCEPAYER: 'payer',
};

const VISIT_TYPES: Record<string, EncounterType | undefined> = {
  OFFICEVISIT: 'office_visit',
  TELEHEALTH: 'telehealth',
  URGENTCARE: 'urgent_care',
  PREVENTIVEVISIT: 'preventive',
};

const MISREAD_TO_DIGIT: Record<string, string> = { O: '0', l: '1', S: '5', B: '8' };
const DIGIT_TO_LETTER: Record<string, string> = { '0': 'O', '1': 'L', '5': 'S', '8': 'B' };

// OCR noise flips header-case and swaps O/0, l/1, S/5, B/8. Labels may be
// repaired freely; values only ever via the strict format anchors below.
function normalizeLabel(s: string): string {
  return s
    .toUpperCase()
    .replace(/[0158]/g, (d) => DIGIT_TO_LETTER[d])
    .replace(/[^A-Z]/g, '');
}

function repairAnchoredDigits(s: string): string {
  return s.replace(/[OlSB]/g, (c) => MISREAD_TO_DIGIT[c]);
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const DATE_RE = /([\dOlSB]{4})-([\dOlSB]{2})-([\dOlSB]{2})/;
const PHONE_RE = /\(([\dOlSB]{3})\)\s*([\dOlSB]{3})-([\dOlSB]{4})/;
const MONEY_RE = /\$([\dOlSB][\dOlSB,]*\.[\dOlSB]{2})/;
const SERVICE_LINE_RE = /^(.*?)(\$[\dOlSB][\dOlSB,]*\.[\dOlSB]{2})\s*$/;
const NPI_RE = /^[\dOlSB]{10}$/;
const MRN_RE = /MRN-\d{7}/;
const DIAGNOSIS_RE = /^\s*[\dOlSB]{1,2}\s*[.)]\s*(.+)$/;
const BRACKET_CODE_RE = /\[([^\]]*)\]\s*$/;
// No whitespace anchor: column overflow glues the description to the QTY digit.
const QTY_RE = /([\dOlSB])$/;
const CPT_TAIL_RE = /([\dOlSB]{5})$/;
const DASH_RULE_RE = /^[\s\-=*]+$/;
const MERGED_NAME_RE = /^([A-Z][a-z]+)([A-Z][A-Za-z'-]+)$/;

function parseDate(value: string): string | undefined {
  const m = DATE_RE.exec(value);
  if (!m) return undefined;
  return `${repairAnchoredDigits(m[1])}-${repairAnchoredDigits(m[2])}-${repairAnchoredDigits(m[3])}`;
}

function parseMoneyCents(value: string): number | null {
  const m = MONEY_RE.exec(value);
  if (!m) return null;
  const repaired = repairAnchoredDigits(m[1]).replace(/,/g, '');
  const [dollars, cents] = repaired.split('.');
  return Number(dollars) * 100 + Number(cents);
}

function repairMemberId(value: string): string {
  const v = value.replace(/\s+/g, '');
  if (v.length === 11) {
    const fixed =
      v.slice(0, 3).replace(/5/g, 'S').replace(/8/g, 'B') + repairAnchoredDigits(v.slice(3));
    if (/^[A-Z]{3}\d{8}$/.test(fixed)) return fixed;
  }
  return v;
}

interface ParsedLine {
  description: string;
  cpt: string | null;
  units: number;
  chargeCents: number;
}

function parseServiceLine(raw: string, hasCpt: boolean): ParsedLine | null {
  const m = SERVICE_LINE_RE.exec(raw);
  if (!m) return null;
  const chargeCents = parseMoneyCents(m[2])!;
  let rest = m[1].replace(/\s+$/, '');
  const qm = QTY_RE.exec(rest);
  if (!qm) return null;
  const units = Number(repairAnchoredDigits(qm[1]));
  if (units < 1) return null;
  rest = rest.slice(0, rest.length - 1).replace(/\s+$/, '');
  let cpt: string | null = null;
  if (hasCpt) {
    // Long descriptions overflow their column and abut the CPT with no
    // separator, so the CPT is anchored to the segment end, not to whitespace.
    const cm = CPT_TAIL_RE.exec(rest);
    if (!cm) return null;
    cpt = repairAnchoredDigits(cm[1]);
    rest = rest.slice(0, rest.length - 5);
  }
  const description = collapse(rest);
  if (!description) return null;
  return { description, cpt, units, chargeCents };
}

export function rulesExtract(text: string): Extraction | null {
  let section: Section = 'none';

  let firstName: string | undefined;
  let lastName: string | undefined;
  let dob: string | undefined;
  let mrn: string | undefined;
  let phone: string | undefined;
  let encounterDate: string | undefined;
  let visitType: EncounterType | undefined;
  let providerName: string | undefined;
  let npi: string | undefined;
  let payerName: string | undefined;
  let memberId: string | undefined;
  let printedTotalCents: number | null = null;
  let hasCpt = false;
  const diagnoses: Array<{ description: string; icd10: string | null }> = [];
  const lines: ParsedLine[] = [];

  for (const raw of text.split('\n')) {
    if (!raw.trim() || DASH_RULE_RE.test(raw)) continue;

    const lineNorm = normalizeLabel(raw);
    const nextSection = SECTION_NAMES[lineNorm];
    if (nextSection) {
      section = nextSection;
      continue;
    }

    if (section === 'diagnoses') {
      const dm = DIAGNOSIS_RE.exec(raw);
      if (!dm) continue;
      let body = dm[1];
      let icd10: string | null = null;
      const bm = BRACKET_CODE_RE.exec(body);
      if (bm) {
        icd10 = collapse(bm[1]) || null;
        body = body.slice(0, bm.index);
      }
      const description = collapse(body);
      if (description) diagnoses.push({ description, icd10 });
      continue;
    }

    if (section === 'services') {
      if (lineNorm.includes('DESCRIPTION') && lineNorm.includes('CHARGE')) {
        hasCpt = lineNorm.includes('CPT');
        continue;
      }
      const colon = raw.indexOf(':');
      if (colon !== -1 && normalizeLabel(raw.slice(0, colon)) === 'TOTALDUE') {
        printedTotalCents = parseMoneyCents(raw.slice(colon + 1));
        continue;
      }
      const line = parseServiceLine(raw, hasCpt);
      if (line) lines.push(line);
      continue;
    }

    const colon = raw.indexOf(':');
    if (colon === -1) continue;
    const label = normalizeLabel(raw.slice(0, colon));
    const value = raw.slice(colon + 1).trim();

    if (section === 'patient') {
      if (label === 'NAME') {
        const tokens = collapse(value).split(' ');
        if (tokens.length >= 2) {
          firstName = tokens[0];
          lastName = tokens.slice(1).join(' ');
        } else {
          const nm = MERGED_NAME_RE.exec(tokens[0]);
          if (nm) {
            firstName = nm[1];
            lastName = nm[2];
          }
        }
      } else if (label === 'DOB') {
        dob = parseDate(value);
      } else if (label === 'MRN') {
        mrn = MRN_RE.exec(value)?.[0];
      } else if (label === 'PHONE') {
        const pm = PHONE_RE.exec(value);
        phone = pm
          ? `(${repairAnchoredDigits(pm[1])}) ${repairAnchoredDigits(pm[2])}-${repairAnchoredDigits(pm[3])}`
          : collapse(value) || undefined;
      }
    } else if (section === 'encounter') {
      if (label === 'DATEOFSERVICE') {
        encounterDate = parseDate(value);
      } else if (label === 'VISITTYPE') {
        visitType = VISIT_TYPES[normalizeLabel(value)];
      } else if (label === 'RENDERINGPROVIDER') {
        providerName = collapse(value) || undefined;
      } else if (label === 'NPI') {
        const v = value.replace(/\s+/g, '');
        npi = NPI_RE.test(v) ? repairAnchoredDigits(v) : v || undefined;
      }
    } else if (section === 'payer') {
      if (label === 'PLAN') {
        payerName = collapse(value) || undefined;
      } else if (label === 'MEMBERID') {
        memberId = repairMemberId(value) || undefined;
      }
    }
  }

  const parsed = ExtractionSchema.safeParse({
    patient: { firstName, lastName, dob, mrn, phone },
    encounter: { date: encounterDate, type: visitType, providerName, npi },
    diagnoses,
    lines,
    payer: { name: payerName, memberId },
    printedTotalCents,
  });
  return parsed.success ? parsed.data : null;
}
