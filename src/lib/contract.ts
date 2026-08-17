// Enclave domain contract — the single authoritative source for types shared
// across the generator, agent loop, eval harness, API, and dashboard.
// All money is integer cents. All dates are ISO strings (YYYY-MM-DD).

import { z } from "zod";

// Providers

export const PROVIDERS = ["rules", "local", "groq", "bedrock"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<Provider, string> = {
  rules: "Rules baseline (deterministic)",
  local: "Local LLM (Ollama)",
  groq: "Groq (hosted open-weights)",
  bedrock: "AWS Bedrock (hosted)",
};

// Clinical/billing domain

export const ENCOUNTER_TYPES = [
  "office_visit",
  "telehealth",
  "urgent_care",
  "preventive",
] as const;
export type EncounterType = (typeof ENCOUNTER_TYPES)[number];

export const PatientSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  /** YYYY-MM-DD */
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** e.g. MRN-4821937 */
  mrn: z.string().regex(/^MRN-\d{7}$/),
  /** e.g. (555) 123-4567 */
  phone: z.string().min(7),
});
export type Patient = z.infer<typeof PatientSchema>;

export const EncounterSchema = z.object({
  /** YYYY-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(ENCOUNTER_TYPES),
  providerName: z.string().min(1),
  /** 10-digit National Provider Identifier */
  npi: z.string().regex(/^\d{10}$/),
});
export type Encounter = z.infer<typeof EncounterSchema>;

export const DiagnosisSchema = z.object({
  description: z.string().min(1),
  /** ICD-10-CM, e.g. J06.9 */
  icd10: z.string().min(3),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

export const ServiceLineSchema = z.object({
  description: z.string().min(1),
  /** CPT/HCPCS, e.g. 99213 */
  cpt: z.string().min(5),
  units: z.number().int().min(1),
  /** charge for ALL units, integer cents */
  chargeCents: z.number().int().min(0),
});
export type ServiceLine = z.infer<typeof ServiceLineSchema>;

export const PayerSchema = z.object({
  name: z.string().min(1),
  memberId: z.string().min(1),
});
export type Payer = z.infer<typeof PayerSchema>;

export const ANOMALY_KINDS = [
  "charge_total_mismatch", // printed total ≠ sum of line charges
  "duplicate_line", // same CPT + description repeated
  "unit_charge_outlier", // per-unit charge wildly off the code's usual fee
  "missing_field", // a required field absent from the document
] as const;
export type AnomalyKind = (typeof ANOMALY_KINDS)[number];

/** Ground truth for one synthetic superbill. */
export const SuperbillTruthSchema = z.object({
  patient: PatientSchema,
  encounter: EncounterSchema,
  diagnoses: z.array(DiagnosisSchema).min(1).max(4),
  lines: z.array(ServiceLineSchema).min(1).max(5),
  payer: PayerSchema,
  /** sum of line chargeCents (pre-anomaly) */
  subtotalCents: z.number().int().min(0),
  /** what the document PRINTS as its total (≠ subtotal when anomalous) */
  printedTotalCents: z.number().int().min(0),
  /** anomalies the generator deliberately injected (empty = clean doc) */
  injectedAnomalies: z.array(z.enum(ANOMALY_KINDS)),
});
export type SuperbillTruth = z.infer<typeof SuperbillTruthSchema>;

// Generated documents

export interface GeneratedDocument {
  /** e.g. DOC-00042 */
  id: string;
  /** master seed the batch was generated from */
  seed: number;
  /** index within the batch */
  index: number;
  truth: SuperbillTruth;
  /** noisy OCR-style text rendering — what providers actually see */
  text: string;
  /** clean rendering, for debugging only — NEVER shown to providers */
  cleanText: string;
  /** 'eval' = held-out measurement split, 'dev' = free to iterate on */
  split: "dev" | "eval";
}

// Extraction (what providers produce from the noisy text)
// Codes are nullable: some documents omit printed codes, and match_codes
// resolves them afterward against the ICD-10/CPT datasets.

export const ExtractedDiagnosisSchema = z.object({
  description: z.string().min(1),
  icd10: z.string().nullable(),
});
export const ExtractedLineSchema = z.object({
  description: z.string().min(1),
  cpt: z.string().nullable(),
  units: z.number().int().min(1),
  chargeCents: z.number().int().min(0),
});

export const ExtractionSchema = z.object({
  patient: PatientSchema,
  encounter: EncounterSchema,
  diagnoses: z.array(ExtractedDiagnosisSchema).min(1).max(6),
  lines: z.array(ExtractedLineSchema).min(1).max(8),
  payer: PayerSchema,
  printedTotalCents: z.number().int().min(0).nullable(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

/**
 * Model-facing variant of ExtractionSchema with no regex patterns or length
 * constraints. llama.cpp's JSON-schema→GBNF converter chokes on `pattern`
 * (Ollama then silently generates UNCONSTRAINED — observed as the model
 * echoing the document), and grammar-enforced formats would over-help the
 * model anyway. Strict format checks live in code: llmExtract validates the
 * lenient result against ExtractionSchema after normalization.
 */
export const LenientExtractionSchema = z.object({
  patient: z.object({
    firstName: z.string(),
    lastName: z.string(),
    dob: z.string(),
    mrn: z.string(),
    phone: z.string(),
  }),
  encounter: z.object({
    date: z.string(),
    type: z.enum(ENCOUNTER_TYPES),
    providerName: z.string(),
    npi: z.string(),
  }),
  diagnoses: z.array(
    z.object({ description: z.string(), icd10: z.string().nullable() }),
  ),
  lines: z.array(
    z.object({
      description: z.string(),
      cpt: z.string().nullable(),
      units: z.number().int(),
      chargeCents: z.number().int(),
    }),
  ),
  payer: z.object({ name: z.string(), memberId: z.string() }),
  printedTotalCents: z.number().int().nullable(),
});
export type LenientExtraction = z.infer<typeof LenientExtractionSchema>;

/** Extraction after match_codes has resolved every null code. */
export const ResolvedExtractionSchema = ExtractionSchema.extend({
  diagnoses: z.array(DiagnosisSchema).min(1).max(6),
  lines: z.array(ServiceLineSchema.extend({ cpt: z.string().min(5) })).min(1).max(8),
});
export type ResolvedExtraction = z.infer<typeof ResolvedExtractionSchema>;

export const AnomalyFlagSchema = z.object({
  kind: z.enum(ANOMALY_KINDS),
  detail: z.string(),
});
export type AnomalyFlag = z.infer<typeof AnomalyFlagSchema>;

// Code datasets

export interface CodeEntry {
  code: string;
  description: string;
  /** alternate phrasings a clinician might write on a superbill */
  synonyms: string[];
  /** CPT only: typical per-unit fee in cents, for outlier detection */
  typicalFeeCents?: number;
}

// Per-document run results

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface DocumentRunResult {
  documentId: string;
  provider: Provider;
  /** concrete model id, or 'deterministic' for the rules baseline */
  model: string;
  extraction: Extraction | null;
  resolved: ResolvedExtraction | null;
  anomalies: AnomalyFlag[];
  latencyMs: number;
  usage: TokenUsage;
  costUsd: number;
  /** bytes of document content sent off-machine. 0 for rules and local. */
  egressBytes: number;
  error: string | null;
}

/**
 * The agent-loop entry point. src/agent/run.ts MUST export exactly:
 *   export async function runDocument(
 *     doc: Pick<GeneratedDocument, "id" | "text">,
 *     opts: { provider: Provider; model?: string },
 *   ): Promise<DocumentRunResult>
 */

// Eval metrics

export interface FieldScore {
  field: string;
  correct: number;
  total: number;
}

export interface PRF1 {
  precision: number;
  recall: number;
  f1: number;
}

export interface EvalMetrics {
  provider: Provider;
  model: string;
  docCount: number;
  /** docs where extraction parsed + validated at all */
  parseRate: number;
  /** micro-averaged scalar-field accuracy across all docs */
  fieldAccuracy: number;
  /** fraction of docs with every field correct */
  exactMatchRate: number;
  /** ICD-10 + CPT assignment vs truth */
  codeMatch: PRF1;
  /** anomaly flags vs injected anomalies */
  anomalyDetection: PRF1;
  latencyMsP50: number;
  latencyMsP95: number;
  totalCostUsd: number;
  costPerDocUsd: number;
  egressBytesTotal: number;
  perField: FieldScore[];
}

export interface MeasurementFile {
  version: 1;
  seed: number;
  split: "eval";
  docCount: number;
  generatedAt: string;
  results: EvalMetrics[];
}

// Pricing (USD per million tokens)

export const BEDROCK_PRICING: Record<string, { inPerMTok: number; outPerMTok: number }> = {
  // Claude Haiku 4.5 on Bedrock
  "us.anthropic.claude-haiku-4-5-20251001-v1:0": { inPerMTok: 1.0, outPerMTok: 5.0 },
};

/**
 * Groq list prices. The free tier bills $0 at our volume — costUsd meters the
 * list price anyway: it's the marginal cost the moment usage outgrows the
 * free tier, which is the economically honest number to compare.
 */
export const GROQ_PRICING: Record<string, { inPerMTok: number; outPerMTok: number }> = {
  "openai/gpt-oss-120b": { inPerMTok: 0.15, outPerMTok: 0.75 },
  "llama-3.3-70b-versatile": { inPerMTok: 0.59, outPerMTok: 0.79 },
  "llama-3.1-8b-instant": { inPerMTok: 0.05, outPerMTok: 0.08 },
};

// Defaults

export const DEFAULTS = {
  /** 8 GB M1 ceiling: a 3B-class model is the honest local pick */
  localModel: "qwen2.5:3b-instruct",
  bedrockModel: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  /**
   * Hosted open-weights ceiling — what 40x the params buys over the local
   * 3B. gpt-oss-120b because Groq's json_schema structured outputs only
   * cover select models (llama-3.3-70b and qwen3-32b rejected it).
   */
  groqModel: "openai/gpt-oss-120b",
  ollamaBaseUrl: "http://localhost:11434/v1",
  groqBaseUrl: "https://api.groq.com/openai/v1",
  dbUrl: "file:./data/enclave.db",
  evalDocCount: 50,
  devDocCount: 10,
  /** fraction of generated docs that get an injected anomaly */
  anomalyRate: 0.2,
  /** fraction of docs that print their ICD-10/CPT codes (rest need matching) */
  printedCodeRate: 0.5,
} as const;
