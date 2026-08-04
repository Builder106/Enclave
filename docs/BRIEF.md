# Enclave — project brief

> **Working title.** A local-first, agentic LLM system for clinical/billing
> documents. PHI never leaves the machine: an on-device open-weights model
> does OCR → extraction → code-matching → anomaly flagging, and we *measure*
> that it reaches parity with AWS Bedrock at zero PHI egress and ~$0 marginal
> inference cost. Built end-to-end in Claude Code.

This is the **third leg** of the `AI_ML/` lane, deliberately filling the gap the
other two leave:

| Project | Lane | What it proves |
| --- | --- | --- |
| `IMC_Prosperity` (TradeTell) | RAG / retrieval | *Retrieve* to ground a hosted model |
| `Helm` | Agent / orchestration / measurement | *Orchestrate + measure* hosted models, find where they break |
| **Enclave** | **Local inference + agentic + adaptation** | Run it *locally* where hosted models legally can't go — and prove the local model is good enough |

---

## Why this project (job-coverage map)

Targets the AI-build internships, head-on:

| Job | Signal Enclave hits |
| --- | --- |
| **Armada Recovery** (AI-Native Dev) | Near-exact stack: Next.js + TS + shadcn/ui, healthcare data, regulated industry, dashboards. Bedrock is our hosted baseline. |
| **PPRG Holdings** (AI Eng) | Local LLMs + agentic system — the literal job description. |
| **TALD** (Generative AI Dev) | The code-matching / semantic-search-over-records feature = "search / recommendations / matching." |
| **Associated Environmental** (SWE) | Built entirely in Claude Code, AI-native workflow documented as a first-class artifact. |
| **Wesleyan / Castillo-García** (Research) | OCR-of-documents pipeline is directly transferable (R/Python OCR of historical records). |

The two cross-cutting requirements **Armada and AES both make mandatory** —
*demonstrated use of AI tools in building* — are satisfied at the repo level:
the entire commit history is Claude Code-driven, and there's a "How this was
built" section + a `JOURNAL.md` of direct-and-verify sessions.

---

## The thesis (what makes it non-slop)

Healthcare data is legally constrained — PHI can't be shipped to a hosted API
without a BAA and a lot of risk. So the architecturally-correct move is to run
the model **on-prem / on-device**. Enclave's headline is a *measured* claim, not
a vibe:

> **A fully-local agentic pipeline extracts and code-matches clinical documents
> at parity with AWS Bedrock — zero PHI egress, $0 marginal inference cost —
> built end-to-end in Claude Code.**

If the local model *doesn't* reach parity, that's still a finding worth
publishing (Helm's whole credibility comes from reporting the 54% payout-math
failure honestly). The eval harness is the product.

---

## Stack

Mirror Armada's stack where it's cheap to; deviate only for the local-model thesis.

- **Frontend:** Next.js (App Router) + TypeScript + **shadcn/ui** + Tailwind. The dashboard *is* the demo (Helm pattern).
- **Agent + provider layer:** **Vercel AI SDK**. One interface, two providers — `@ai-sdk/amazon-bedrock` for the hosted baseline and an OpenAI-compatible provider pointed at **Ollama** for local. Swapping local↔hosted for the A/B eval is a one-line provider switch. Tool-calling via the SDK's `tools` API.
- **Local model:** Ollama serving **Qwen2.5 7B** or **Llama 3.1 8B** (both support tool use). Vision/OCR: **Llama 3.2 Vision 11B** if hardware allows, else **docTR/Tesseract** → text → LLM. (LinuxBenchHub already characterizes your hardware — use it to pick.)
- **Hosted baseline:** **AWS Bedrock** (Claude). This is the comparison, not the default path.
- **Data:** **Drizzle ORM** targeting **Azure SQL / SQL Server** (Armada match), with **libSQL/SQLite** for local dev — which also echoes MedCore, easing the harvest.
- **Eval/data generation:** TypeScript, seeded + deterministic (Helm's `measure:*` DNA).

Keep it a **monolith** — Next.js full-stack, Ollama as external infra (a model server, not a second app). No microservice sprawl.

---

## Harvest from MedCore (don't rebuild the boring parts)

Lift, don't merge — separate repo, but pull these in:

- `YAIS/MedCore/server/src/lib/fhir-mappers.ts` — FHIR R4 resource shapes. Reuse the clinical data model wholesale.
- `YAIS/MedCore/server/src/middleware/audit.ts` + `routes/audit.ts` — audit-log pattern. Regulated-industry table stakes Armada cares about.
- MedCore's **offline-first / mock-fallback architecture** — conceptual; it's literally the thesis Enclave extends.

**Narrative link:** Enclave is the AI-layer sequel to MedCore's offline thesis —
*"MedCore proved African clinics need offline-first records; Enclave proves the
AI layer can run offline too."* Cross-link the READMEs so MedCore's YAIS-winner
halo reflects onto Enclave.

---

## The agent loop

A typed tool-use loop over a single document:

1. `ocr_document(file)` → raw text + layout (local vision model or docTR)
2. `extract_fields(text)` → structured clinical/billing fields (FHIR-shaped, from the harvested mappers)
3. `match_codes(fields)` → semantic search assigning ICD-10 / CPT / billing codes (the "matching" feature)
4. `flag_anomaly(fields, codes)` → rule + model check (echoes Helm's reconciler)
5. `write_record(...)` → persist via Drizzle, with an audit-log entry (harvested)

The model orchestrates the tools; deterministic code validates outputs (Zod
schemas, the "LLM proposes, code disposes" lesson from Helm's payout reconciler).

---

## Eval — the measured claim

Held-out split of **seeded synthetic** clinical/billing documents with known
ground truth (no real PHI — generate it deterministically, like Helm's policy
engine). Run the *same* agent against local vs Bedrock:

| Metric | Local (Ollama) | Bedrock (baseline) |
| --- | --- | --- |
| Field accuracy (%) | — | — |
| Exact-match rate (%) | — | — |
| Code-match F1 | — | — |
| $ / document | ~$0 marginal | measured |
| p50 / p95 latency (ms) | — | — |
| **PHI egress (bytes)** | **0** | measured |

`pnpm measure:enclave --seed 1 --provider {local,bedrock}` reproduces each
column. The dashboard renders both side-by-side.

---

## Build sequence

- **Phase 0 — Scaffold.** Next.js + shadcn + Drizzle + AI SDK. Repo baseline (see below). First commit onward = Claude Code.
- **Phase 1 — Ground truth.** Synthetic clinical/billing doc generator + FHIR-shaped labels (harvest MedCore mappers).
- **Phase 2 — Local extraction.** OCR ingestion + single-shot field extraction on the local model.
- **Phase 3 — Agent loop.** Wire the 5 tools; Zod validation; audit logging.
- **Phase 4 — Hosted baseline.** Same agent, Bedrock provider (one-line swap via AI SDK).
- **Phase 5 — Eval + dashboard.** `measure:enclave`, the comparison table, local-vs-Bedrock dashboard. **This is the MVP demo.**
- **Stretch — Adaptation.** LoRA fine-tune the local model on the extraction task to close any parity gap. Adds the *fine-tuning* competency → folder then ticks every applied-GenAI box (retrieve / orchestrate / local / adapt).

MVP = Phases 0–5. The stretch is what turns "good portfolio project" into "and I can train models too."

---

## AI-native build protocol (mandatory for Armada / AES)

- Build **entirely in Claude Code** — every line.
- `JOURNAL.md` logs notable direct-and-verify sessions (decisions, where the AI was wrong and how you caught it). You keep a JOURNAL on every repo anyway; here it doubles as hiring evidence.
- README **"How this was built"** section: the AI-native workflow, the verification discipline, what you owned vs. directed. This is the artifact Armada/AES are screening for.

---

## Repo baseline (per standard checklist)

Banner (light/dark SVG, 1200×420) · shields.io badges (CI, Node, Next, license, demo-live) · Mermaid sequence diagram of the agent loop · Gherkin E2E demo recordings (reuse your Playwright + reporter infra) · `CONTRIBUTING.md` · `JOURNAL.md` · root `LICENSE` (MIT) · SVG logo + 180×180 apple-touch-icon · `.github/workflows/deploy.yml` gating tests + deploying to Vercel · unit + integration tests · `@vercel/analytics` + `@vercel/speed-insights` (Vercel deploy). Set repo description, homepage = live demo, 8–12 topics.
