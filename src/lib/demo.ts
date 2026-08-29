// Shape of data/demo/seed-1.json, produced by scripts/export-demo.ts.

export type DemoProviderId = "rules" | "local" | "groq";

export interface DemoField {
  label: string;
  expected: string;
  got: string;
  ok: boolean;
}

export interface DemoDiagnosis {
  description: string;
  icd10: string | null;
}

export interface DemoLine {
  description: string;
  cpt: string | null;
  units: number;
  chargeCents: number;
}

export interface DemoProviderResult {
  model: string;
  ok: boolean;
  error: string | null;
  egressBytes: number;
  latencyMs: number;
  costUsd: number;
  fields: DemoField[];
  diagnoses: DemoDiagnosis[];
  lines: DemoLine[];
  anomaliesFound: string[];
}

export interface DemoDocument {
  id: string;
  label: string;
  injectedAnomalies: string[];
  text: string;
  truth: {
    diagnoses: DemoDiagnosis[];
    lines: DemoLine[];
    printedTotalCents: number;
  };
  providers: Partial<Record<DemoProviderId, DemoProviderResult>>;
}

export interface DemoData {
  seed: number;
  generatedAt: string;
  documents: DemoDocument[];
}

export const PROVIDER_META: Record<
  DemoProviderId,
  { label: string; sublabel: string; hosted: boolean }
> = {
  rules: { label: "Rules", sublabel: "deterministic parser", hosted: false },
  local: { label: "Local", sublabel: "qwen2.5:3b | Ollama", hosted: false },
  groq: { label: "Groq", sublabel: "gpt-oss-120b | cloud", hosted: true },
};
