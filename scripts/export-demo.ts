// Builds data/demo/seed-1.json: a curated set of specimens, each with its
// source text, ground truth, and the MEASURED per-provider extraction result
// (from the runs table) plus a precomputed per-field comparison. The
// document-first UI plays these back interactively — real measured data, not
// live inference.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  ANOMALY_KINDS,
  type DocumentRunResult,
  type Extraction,
  type GeneratedDocument,
  type SuperbillTruth,
} from "../src/lib/contract";
import { getDb } from "../src/db/client";
import { runs } from "../src/db/schema";

const PROVIDERS = ["rules", "local", "groq"] as const;
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

const SCALARS: { label: string; get: (x: Extraction | SuperbillTruth) => string }[] = [
  { label: "First name", get: (x) => x.patient.firstName },
  { label: "Last name", get: (x) => x.patient.lastName },
  { label: "DOB", get: (x) => x.patient.dob },
  { label: "MRN", get: (x) => x.patient.mrn },
  { label: "Phone", get: (x) => x.patient.phone },
  { label: "Date of service", get: (x) => x.encounter.date },
  { label: "Visit type", get: (x) => x.encounter.type },
  { label: "Provider", get: (x) => x.encounter.providerName },
  { label: "NPI", get: (x) => x.encounter.npi },
  { label: "Payer", get: (x) => x.payer.name },
  { label: "Member ID", get: (x) => x.payer.memberId },
];

function compareFields(truth: SuperbillTruth, ex: Extraction) {
  const fields = SCALARS.map((f) => {
    const expected = f.get(truth);
    const got = f.get(ex);
    return { label: f.label, expected, got, ok: norm(expected) === norm(got) };
  });
  const totalOk =
    ex.printedTotalCents === truth.printedTotalCents ||
    (truth.injectedAnomalies.includes("missing_field") && ex.printedTotalCents === null);
  fields.push({
    label: "Total",
    expected: (truth.printedTotalCents / 100).toFixed(2),
    got: ex.printedTotalCents === null ? "—" : (ex.printedTotalCents / 100).toFixed(2),
    ok: totalOk,
  });
  return fields;
}

function labelFor(t: SuperbillTruth): string {
  if (t.injectedAnomalies.length === 0) return "clean";
  return t.injectedAnomalies[0].replace(/_/g, " ");
}

async function main(): Promise<void> {
  const batch = JSON.parse(
    readFileSync(path.join(process.cwd(), "data/documents/seed-1.json"), "utf8"),
  ).docs as GeneratedDocument[];
  const evalDocs = batch.filter((d) => d.split === "eval");

  const { db } = getDb();
  const rows = await db.select().from(runs).where(eq(runs.seed, 1));
  const byKey = new Map<string, DocumentRunResult>();
  for (const r of rows) {
    const key = `${r.provider}:${r.documentId}`;
    const prev = byKey.get(key);
    if (!prev || r.createdAt > (prev as unknown as { _ts: number })._ts) {
      const parsed = JSON.parse(r.resultJson) as DocumentRunResult;
      (parsed as unknown as { _ts: number })._ts = r.createdAt;
      byKey.set(key, parsed);
    }
  }

  // Curate: cover each anomaly kind + a few clean docs, capped for a tidy picker.
  const picked: GeneratedDocument[] = [];
  const seenLabels = new Set<string>();
  for (const kind of ["clean", ...ANOMALY_KINDS.map((k) => k.replace(/_/g, " "))]) {
    const want = kind === "clean" ? 3 : 1;
    let n = 0;
    for (const d of evalDocs) {
      if (labelFor(d.truth) === kind && n < want) {
        picked.push(d);
        n++;
        seenLabels.add(kind);
      }
    }
  }
  picked.sort((a, b) => a.index - b.index);

  const documents = picked.map((d) => {
    const providers: Record<string, unknown> = {};
    for (const p of PROVIDERS) {
      const res = byKey.get(`${p}:${d.id}`);
      if (!res) continue;
      const ex = res.extraction;
      providers[p] = {
        model: res.model,
        ok: res.error === null && ex !== null,
        error: res.error,
        egressBytes: res.egressBytes,
        latencyMs: Math.round(res.latencyMs),
        costUsd: res.costUsd,
        fields: ex ? compareFields(d.truth, ex) : [],
        diagnoses: ex ? ex.diagnoses : [],
        lines: ex ? ex.lines : [],
        anomaliesFound: res.anomalies.map((a) => a.kind),
      };
    }
    return {
      id: d.id,
      label: labelFor(d.truth),
      injectedAnomalies: d.truth.injectedAnomalies,
      text: d.text,
      truth: {
        patient: d.truth.patient,
        encounter: d.truth.encounter,
        diagnoses: d.truth.diagnoses,
        lines: d.truth.lines,
        payer: d.truth.payer,
        printedTotalCents: d.truth.printedTotalCents,
      },
      providers,
    };
  });

  const out = { seed: 1, generatedAt: new Date().toISOString(), documents };
  const dir = path.join(process.cwd(), "data", "demo");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "seed-1.json");
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`wrote ${file}: ${documents.length} specimens, providers ${PROVIDERS.join("/")}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
