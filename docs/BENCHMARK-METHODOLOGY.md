# Enclave: Benchmark & Evaluation Methodology

This document details the evaluation methodology, metric definitions, and OCR-noise rendering algorithms used to measure clinical document extraction accuracy and PHI egress across deterministic rules, local models, and cloud hosted models.

---

## 1. Evaluation Split & Ground Truth

- **Corpus Size:** 50 held-out synthetic superbill clinical billing specimens (`seed 1`).
- **Ground Truth Format:** Standardized FHIR R4 JSON structures containing patient identifiers, encounter details, line items (CPT procedures, ICD-10 diagnoses, units, charges), total amounts, and financial anomaly flags.
- **Seeded Generation:** Generated deterministically via `pnpm generate --seed 1`.

---

## 2. Metric Definitions

### Primary Accuracy Metrics

1. **Field Accuracy (%)**: The proportion of top-level and nested key-value pairs matching ground truth exactly after string normalization (lowercase, space trim).
2. **Exact Match Rate (%)**: The percentage of documents where *every single field* matches ground truth without any error.
3. **ICD-10 Code F1 Score**: Harmonic mean of precision and recall for predicted vs ground-truth diagnosis codes.
4. **CPT Procedure F1 Score**: Harmonic mean of precision and recall for procedure codes.
5. **Anomaly Detection F1 Score**: Precision and recall of detecting intentionally injected billing discrepancies (e.g. sum mismatches, fee ceiling breaches, invalid modifier combinations).

### System & Egress Metrics

1. **Marginal Cost ($ / doc)**: API billing cost incurred per document run.
2. **PHI Egress (Bytes)**: Measured network payload size (bytes) transmitted outside the local machine boundary (`0 B`for`rules`and`local` Ollama extractors).
3. **Latency (p50 / p95 ms)**: End-to-end processing time per document from text ingestion to structured JSON emission.

---

## 3. OCR Noise Injection Algorithm

To simulate real-world physical superbill scans, synthetic text undergoes controlled noise transformations before being fed to extractors:

- **Character Swaps:** Substitution of visually similar glyphs (e.g., `0`↔`O`, `1`↔`l`, `5`↔`S`).
- **Line Smearing:** Random insertion of whitespace and tab shifts across columns.
- **Header Truncation:** Drop of leading pixels or non-critical header lines simulating scanner margin cutoffs.

---

## 4. Evaluation Execution

Evaluations are reproducible using the CLI:

```bash

# Run deterministic rules parser baseline

pnpm measure --provider rules --seed 1

# Run local Qwen2.5 3B model via Ollama

pnpm measure --provider local --seed 1

# Run Groq cloud model

pnpm measure --provider groq --seed 1
```

Results are saved to `data/demo/seed-1.json` for playback in the interactive workbench.
