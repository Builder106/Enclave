// Relative imports: tsx does not resolve the "@" path alias.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import {
  PROVIDERS,
  type DocumentRunResult,
  type EvalMetrics,
  type GeneratedDocument,
  type MeasurementFile,
  type PRF1,
  type Provider,
} from "../src/lib/contract";
import { generateBatch } from "../src/generators";
import { runDocument } from "../src/agent/run";
import { computeMetrics } from "../src/eval/metrics";
import { audit } from "../src/db/audit";
import { ensureTables, getDb, newId } from "../src/db/client";
import { evalRuns, runs } from "../src/db/schema";

try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional
}

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      flags.set(arg.slice(2), "");
    } else {
      flags.set(arg.slice(2), value);
      i++;
    }
  }
  return flags;
}

function intFlag(flags: Map<string, string>, name: string, fallback: number): number {
  const raw = flags.get(name);
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`--${name} must be a non-negative integer, got "${raw}"`);
  }
  return n;
}

interface BatchFile {
  seed: number;
  generatedAt: string;
  docs: GeneratedDocument[];
}

function loadOrGenerateBatch(seed: number): GeneratedDocument[] {
  const file = path.join(process.cwd(), "data", "documents", `seed-${seed}.json`);
  if (existsSync(file)) {
    return (JSON.parse(readFileSync(file, "utf8")) as BatchFile).docs;
  }
  const docs = generateBatch(seed);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ seed, generatedAt: new Date().toISOString(), docs }, null, 2));
  console.log(`No batch file for seed ${seed}; generated ${docs.length} docs and wrote ${file}`);
  return docs;
}

// Infrastructure noise (quota/rate-limit rejections) is never a model
// measurement: excluded from metrics, and 3 in a row aborts the run.
const INFRA_NOISE = /too many|throttl|quota|rate limit|429/i;

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const prf = (p: PRF1): string => `P ${pct(p.precision)}  R ${pct(p.recall)}  F1 ${pct(p.f1)}`;

function printMetrics(metrics: EvalMetrics, seed: number): void {
  console.log("");
  console.log(`── ${metrics.provider} | ${metrics.model} | seed ${seed} ──`);
  console.log(`docs             ${metrics.docCount}`);
  console.log(`parse rate       ${pct(metrics.parseRate)}`);
  console.log(`field accuracy   ${pct(metrics.fieldAccuracy)}`);
  console.log(`exact match      ${pct(metrics.exactMatchRate)}`);
  console.log(`code match       ${prf(metrics.codeMatch)}`);
  console.log(`anomaly detect   ${prf(metrics.anomalyDetection)}`);
  console.log(`latency p50/p95  ${metrics.latencyMsP50.toFixed(2)} / ${metrics.latencyMsP95.toFixed(2)} ms`);
  console.log(`cost total       $${metrics.totalCostUsd.toFixed(6)}`);
  console.log(`cost per doc     $${metrics.costPerDocUsd.toFixed(6)}`);
  console.log(`egress total     ${metrics.egressBytesTotal} bytes`);
  console.log("per-field:");
  for (const f of metrics.perField) {
    console.log(`  ${f.field.padEnd(24)} ${f.correct}/${f.total}  ${pct(f.total === 0 ? 0 : f.correct / f.total)}`);
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const seed = intFlag(flags, "seed", 1);
  const providerRaw = flags.get("provider");
  if (providerRaw === undefined || !(PROVIDERS as readonly string[]).includes(providerRaw)) {
    throw new Error(`--provider is required and must be one of: ${PROVIDERS.join(" | ")}`);
  }
  const provider = providerRaw as Provider;
  const model = flags.get("model");
  const count = flags.has("count") ? intFlag(flags, "count", 0) : undefined;
  const offset = intFlag(flags, "offset", 0);
  const resume = flags.has("resume");

  const docs = loadOrGenerateBatch(seed);
  const allEvalDocs = docs.filter((d) => d.split === "eval");

  await ensureTables();
  const { db } = getDb();

  // Chunked runs: [offset, offset+count). Metrics accumulate across chunks
  // from the runs table (latest row per document wins, so retries supersede
  // quota-throttled failures). --resume instead targets exactly the docs
  // that still lack a clean run — cron-safe: re-running costs nothing once
  // coverage is complete.
  let candidates = allEvalDocs;
  if (resume) {
    const cleanIds = new Set(
      (await db.select().from(runs).where(and(eq(runs.provider, provider), eq(runs.seed, seed))))
        .filter((row) => !(row.error !== null && INFRA_NOISE.test(row.error)))
        .map((row) => row.documentId),
    );
    candidates = allEvalDocs.filter((d) => !cleanIds.has(d.id));
    if (candidates.length === 0) {
      console.log(`coverage already complete: ${allEvalDocs.length}/${allEvalDocs.length} for ${provider} — nothing to do`);
      return;
    }
  }
  const chunk = candidates.slice(offset, count !== undefined ? offset + count : undefined);
  if (chunk.length === 0) throw new Error(`no eval documents in range for seed ${seed}`);
  const startedAt = Date.now();
  await audit({
    actor: "cli",
    action: "measure_start",
    detail: `seed=${seed} provider=${provider} docs=${chunk.length} offset=${offset}`,
  });

  console.log(`Measuring ${provider} on ${chunk.length} eval docs (seed ${seed}, offset ${offset})`);
  const results: DocumentRunResult[] = [];
  // Sequential on purpose: local models share one machine's compute budget.
  for (let i = 0; i < chunk.length; i++) {
    const doc = chunk[i];
    const result = await runDocument(
      { id: doc.id, text: doc.text },
      model !== undefined ? { provider, model } : { provider },
    );
    results.push(result);
    await db.insert(runs).values({
      id: newId("RUN"),
      documentId: result.documentId,
      seed,
      provider: result.provider,
      model: result.model,
      resultJson: JSON.stringify(result),
      latencyMs: result.latencyMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd: result.costUsd,
      egressBytes: result.egressBytes,
      error: result.error,
      createdAt: Date.now(),
    });
    if ((i + 1) % 10 === 0 || i + 1 === chunk.length) {
      const errors = results.filter((r) => r.error !== null).length;
      console.log(`  [${i + 1}/${chunk.length}] last=${doc.id} ${Math.round(result.latencyMs)}ms errors=${errors}`);
    }
    const tail = results.slice(-3);
    if (tail.length === 3 && tail.every((r) => r.error !== null && INFRA_NOISE.test(r.error))) {
      console.log(`  aborting after 3 consecutive quota/throttle errors at ${doc.id} — rerun this range after the quota resets`);
      break;
    }
  }

  // Cumulative view: latest run per document across every chunk so far.
  // Quota/throttle rows are infrastructure noise, not model measurements —
  // they never count; the doc stays unmeasured until a clean rerun.
  const rows = (
    await db
      .select()
      .from(runs)
      .where(and(eq(runs.provider, provider), eq(runs.seed, seed)))
  ).filter((row) => !(row.error !== null && INFRA_NOISE.test(row.error)));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const prev = latest.get(row.documentId);
    if (!prev || row.createdAt > prev.createdAt) latest.set(row.documentId, row);
  }
  const measuredDocs = allEvalDocs.filter((d) => latest.has(d.id));
  const cumulative = measuredDocs.map(
    (d) => JSON.parse(latest.get(d.id)!.resultJson) as DocumentRunResult,
  );
  console.log(
    `coverage: ${measuredDocs.length}/${allEvalDocs.length} eval docs measured for ${provider}`,
  );
  if (measuredDocs.length === 0) {
    await audit({
      actor: "cli",
      action: "measure_finish",
      detail: `seed=${seed} provider=${provider} no clean runs — nothing written`,
    });
    console.log("no clean measurements yet — measurement file untouched");
    return;
  }

  const metrics = computeMetrics(measuredDocs, cumulative);

  const measurePath = path.join(process.cwd(), "data", "measurements", `seed-${seed}.json`);
  let otherResults: EvalMetrics[] = [];
  if (existsSync(measurePath)) {
    const prev = JSON.parse(readFileSync(measurePath, "utf8")) as MeasurementFile;
    otherResults = prev.results.filter((r) => r.provider !== provider);
  }
  const measurement: MeasurementFile = {
    version: 1,
    seed,
    split: "eval",
    docCount: allEvalDocs.length,
    generatedAt: new Date().toISOString(),
    results: [...otherResults, metrics],
  };
  mkdirSync(path.dirname(measurePath), { recursive: true });
  writeFileSync(measurePath, JSON.stringify(measurement, null, 2));

  await db.insert(evalRuns).values({
    id: newId("EVAL"),
    seed,
    provider,
    model: metrics.model,
    docCount: metrics.docCount,
    metricsJson: JSON.stringify(metrics),
    startedAt,
    finishedAt: Date.now(),
  });
  await audit({
    actor: "cli",
    action: "measure_finish",
    detail: `seed=${seed} provider=${provider} docs=${metrics.docCount} fieldAcc=${metrics.fieldAccuracy.toFixed(3)}`,
  });

  printMetrics(metrics, seed);
  console.log(`\nwrote ${measurePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
