import { createEffect, createSignal, For, Show } from "solid-js";
import {
  PROVIDER_META,
  type DemoData,
  type DemoDocument,
  type DemoProviderId,
  type DemoProviderResult,
} from "@/lib/demo";

const PROVIDERS: DemoProviderId[] = ["rules", "local", "groq"];

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function usd(n: number): string {
  if (n === 0) return "$0";
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}
function latency(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
function cents(c: number): string {
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

function Mark(props: { class?: string }) {
  return (
    <svg viewBox="0 0 64 64" class={props.class} aria-hidden fill="none">
      <g
        stroke="currentColor"
        stroke-width="5.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M8 19V14a6 6 0 0 1 6-6h5" />
        <path d="M45 8h5a6 6 0 0 1 6 6v5" />
        <path d="M56 45v5a6 6 0 0 1-6 6h-5" />
        <path d="M19 56h-5a6 6 0 0 1-6-6v-5" />
      </g>
      <rect x="24" y="24" width="16" height="16" rx="4.5" fill="currentColor" />
    </svg>
  );
}

type Phase = "idle" | "working" | "result";

export function Workbench(props: {
  demo: DemoData | null | undefined;
  commit: string | null;
}) {
  const docs = () => props.demo?.documents ?? [];
  const [docId, setDocId] = createSignal(docs()[0]?.id ?? "");
  const [provider, setProvider] = createSignal<DemoProviderId>("groq");
  const [phase, setPhase] = createSignal<Phase>("idle");
  const [egressShown, setEgressShown] = createSignal(0);
  let runToken = 0;

  const doc = () => docs().find((d) => d.id === docId());
  const result = () => doc()?.providers[provider()];
  const hosted = () => PROVIDER_META[provider()].hosted;

  createEffect(() => {
    docId();
    provider();
    
    runToken++;
    setPhase("idle");
    setEgressShown(0);
  });

  function run() {
    const res = result();
    if (!res) return;
    const currentToken = ++runToken;
    setPhase("working");
    setEgressShown(0);
    const transmitting = hosted() && res.egressBytes > 0;
    const workMs = transmitting ? 1300 : 750;
    
    if (transmitting) {
      const start = performance.now();
      const tick = () => {
        if (runToken !== currentToken) return;
        const t = Math.min(1, (performance.now() - start) / workMs);
        setEgressShown(Math.round(res.egressBytes * t));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    
    window.setTimeout(() => {
      if (runToken !== currentToken) return;
      setPhase("result");
    }, workMs);
  }

  const correct = () => result()?.fields.filter((f) => f.ok).length ?? 0;
  const totalFields = () => result()?.fields.length ?? 0;

  return (
    <Show
      when={props.demo && doc()}
      fallback={
        <main class="mx-auto flex min-h-full w-full max-w-2xl flex-1 items-center px-6 py-16">
          <div class="font-mono text-sm text-muted-foreground">
            No specimens on disk. Run{" "}
            <code class="text-foreground">pnpm generate</code>,{" "}
            <code class="text-foreground">pnpm measure</code>, then{" "}
            <code class="text-foreground">tsx scripts/export-demo.ts</code>.
          </div>
        </main>
      }
    >
      <main class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-8 sm:px-8">
        <header class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <Mark class="size-9 shrink-0 text-primary" />
            <div>
              <h1 class="text-lg font-semibold tracking-tight">Enclave</h1>
              <p class="text-xs text-muted-foreground">
                Clinical document AI that never phones home.
              </p>
            </div>
          </div>
          <div class="eyebrow hidden text-ink-faint sm:block">
            intake workbench{props.commit ? ` · #${props.commit}` : ""}
          </div>
        </header>

        <section class="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-end sm:justify-between">
          <label class="flex flex-col gap-1.5">
            <span class="eyebrow text-ink-faint">Specimen</span>
            <select
              value={docId()}
              onChange={(e) => setDocId(e.target.value)}
              class="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-80"
            >
              <For each={docs()}>
                {(d) => (
                  <option value={d.id}>
                    {d.id} · {d.label}
                  </option>
                )}
              </For>
            </select>
          </label>

          <div class="flex flex-col gap-1.5">
            <span class="eyebrow text-ink-faint">Extract with</span>
            <div class="flex gap-1.5">
              <For each={PROVIDERS}>
                {(p) => {
                  const active = () => p === provider();
                  return (
                    <button
                      type="button"
                      onClick={() => setProvider(p)}
                      class={`rounded-md border px-3 py-1.5 text-left transition-colors ${
                        active()
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:border-ink-faint"
                      }`}
                    >
                      <span
                        class={`block text-sm font-medium ${active() ? "text-primary" : "text-foreground"}`}
                      >
                        {PROVIDER_META[p].label}
                      </span>
                      <span class="block font-mono text-[10px] text-muted-foreground">
                        {PROVIDER_META[p].sublabel}
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>

          <button
            type="button"
            onClick={run}
            disabled={phase() === "working" || !result()}
            class="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {phase() === "working" ? "Running…" : "▶  Run extraction"}
          </button>
        </section>

        <div class="grid gap-4 lg:grid-cols-2">
          <SpecimenPanel
            doc={doc()!}
            provider={provider()}
            phase={phase()}
            egressShown={egressShown()}
            result={result()}
          />
          <ExtractionPanel phase={phase()} provider={provider()} result={result()} />
        </div>

        <Show when={phase() === "result" && result()}>
          {(res) => (
            <section class="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
              <Show
                when={!res().error}
                fallback={
                  <span class="text-destructive">
                    extraction failed — {res().error}
                  </span>
                }
              >
                <Stat
                  label="fields correct"
                  value={`${correct()}/${totalFields()}`}
                  tone={correct() === totalFields() ? "good" : "warn"}
                />
                <Stat
                  label="anomaly"
                  value={anomalySummary(doc()!, res())}
                  tone={anomalyTone(doc()!, res())}
                />
                <Stat
                  label="egress"
                  value={bytes(res().egressBytes)}
                  tone={res().egressBytes === 0 ? "good" : "egress"}
                />
                <Stat label="latency" value={latency(res().latencyMs)} />
                <Stat label="cost" value={usd(res().costUsd)} />
              </Show>
            </section>
          )}
        </Show>

        <footer class="mt-2 flex flex-col gap-1.5 border-t border-border pt-4 text-xs text-muted-foreground">
          <p class="font-mono">
            Real measured runs played back · rules → deterministic · local →
            qwen2.5:3b · groq → gpt-oss-120b
          </p>
          <p>
            Synthetic specimens, no real PHI. The egress gauge is the bytes of
            document content each extractor sent off-machine — measured, not
            asserted.
          </p>
        </footer>
      </main>
    </Show>
  );
}

function Stat(props: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "egress";
}) {
  const color = () =>
    props.tone === "good"
      ? "text-primary"
      : props.tone === "egress"
        ? "text-egress"
        : props.tone === "warn"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <span class="flex items-baseline gap-2">
      <span class="eyebrow text-ink-faint">{props.label}</span>
      <span class={`tabular font-mono ${color()}`}>{props.value}</span>
    </span>
  );
}

function anomalySummary(doc: DemoDocument, r: DemoProviderResult): string {
  const expected = doc.injectedAnomalies;
  if (expected.length === 0) {
    return r.anomaliesFound.length === 0
      ? "clean — none"
      : `clean — ${r.anomaliesFound.length} false flag`;
  }
  const kind = expected[0].replace(/_/g, " ");
  return r.anomaliesFound.includes(expected[0])
    ? `${kind} — caught`
    : `${kind} — missed`;
}

function anomalyTone(
  doc: DemoDocument,
  r: DemoProviderResult,
): "good" | "warn" | "egress" {
  const expected = doc.injectedAnomalies;
  if (expected.length === 0)
    return r.anomaliesFound.length === 0 ? "good" : "egress";
  return r.anomaliesFound.includes(expected[0]) ? "good" : "egress";
}

function SpecimenPanel(props: {
  doc: DemoDocument;
  provider: DemoProviderId;
  phase: Phase;
  egressShown: number;
  result: DemoProviderResult | undefined;
}) {
  const hosted = () => PROVIDER_META[props.provider].hosted;
  const transmitting = () => hosted() && props.phase === "working" && (props.result?.egressBytes ?? 0) > 0;
  const sentBytes = () =>
    props.phase === "working" ? props.egressShown : (props.result?.egressBytes ?? 0);

  return (
    <section class="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div class="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span class="eyebrow text-ink-faint">Specimen · {props.doc.id}</span>
        <TransmissionGauge
          hosted={hosted()}
          transmitting={transmitting()}
          phase={props.phase}
          sentBytes={sentBytes()}
          finalBytes={props.result?.egressBytes ?? 0}
        />
      </div>
      <pre class="max-h-[28rem] overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-[12.5px] leading-relaxed text-foreground/90">
        {props.doc.text}
      </pre>
    </section>
  );
}

function TransmissionGauge(props: {
  hosted: boolean;
  transmitting: boolean;
  phase: Phase;
  sentBytes: number;
  finalBytes: number;
}) {
  // Hosted: device → cloud track with a travelling packet while transmitting.
  const live = () => props.transmitting || (props.phase === "result" && props.finalBytes > 0);
  
  return (
    <Show
      when={props.hosted}
      fallback={
        <span class="flex items-center gap-1.5 text-primary">
          <span class="size-1.5 rounded-full bg-primary" />
          <span class="eyebrow">on-device · 0 B</span>
        </span>
      }
    >
      <span class="flex items-center gap-2 text-egress">
        <span class="eyebrow">device</span>
        <span class="relative h-px w-12 bg-egress/35">
          <Show when={props.transmitting}>
            <span class="packet absolute -top-[2px] size-[5px] rounded-full bg-egress" />
          </Show>
        </span>
        <span class="eyebrow">cloud</span>
        <span class="tabular font-mono text-[11px]">
          {live() ? bytes(props.sentBytes) : "—"}
        </span>
      </span>
    </Show>
  );
}

function ExtractionPanel(props: {
  phase: Phase;
  provider: DemoProviderId;
  result: DemoProviderResult | undefined;
}) {
  const hosted = () => PROVIDER_META[props.provider].hosted;
  return (
    <section class="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div class="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span class="eyebrow text-ink-faint">
          Extraction · {PROVIDER_META[props.provider].label}
        </span>
        <Show when={props.phase === "result" && props.result && !props.result.error}>
          <span class="eyebrow text-primary">structured</span>
        </Show>
      </div>
      <div class="max-h-[28rem] overflow-auto px-4 py-3">
        <Show when={props.phase === "idle"}>
          <p class="font-mono text-sm text-muted-foreground">
            Select an extractor and run — the structured record appears here.
          </p>
        </Show>
        <Show when={props.phase === "working"}>
          <p class="font-mono text-sm text-muted-foreground">
            {hosted() ? "Awaiting cloud response" : "Processing on-device"}
            <span class="blink">▍</span>
          </p>
        </Show>
        <Show when={props.phase === "result" && props.result}>
          {(res) => (
            <Show
              when={!res().error}
              fallback={
                <p class="font-mono text-sm text-destructive">
                  Could not parse this specimen — {res().error}
                </p>
              }
            >
              <Extracted result={res()} />
            </Show>
          )}
        </Show>
      </div>
    </section>
  );
}

function Extracted(props: { result: DemoProviderResult }) {
  return (
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        <For each={props.result.fields}>
          {(f, index) => (
            <div
              style={{ "animation-delay": `${index() * 45}ms` }}
              class="field-in flex items-center justify-between gap-3 border-b border-border/60 py-1"
            >
              <span class="font-mono text-xs text-muted-foreground">
                {f.label}
              </span>
              <span class="flex items-center gap-1.5">
                <span
                  class={`tabular truncate font-mono text-xs ${f.ok ? "text-foreground" : "text-destructive line-through"}`}
                >
                  {f.got || "—"}
                </span>
                <span
                  class={`text-xs ${f.ok ? "text-primary" : "text-destructive"}`}
                  aria-hidden
                >
                  {f.ok ? "✓" : "✗"}
                </span>
              </span>
            </div>
          )}
        </For>
      </div>

      <Show when={props.result.diagnoses.length > 0}>
        <div
          style={{ "animation-delay": `${props.result.fields.length * 45}ms` }}
          class="field-in"
        >
          <span class="eyebrow text-ink-faint">Diagnoses</span>
          <ul class="mt-1 space-y-0.5">
            <For each={props.result.diagnoses}>
              {(d) => (
                <li class="font-mono text-xs text-foreground">
                  <span class="text-primary">{d.icd10 ?? "—"}</span>{" "}
                  {d.description}
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      <Show when={props.result.lines.length > 0}>
        <div
          style={{
            "animation-delay": `${
              (props.result.fields.length + (props.result.diagnoses.length ? 1 : 0)) * 45
            }ms`,
          }}
          class="field-in"
        >
          <span class="eyebrow text-ink-faint">Service lines</span>
          <ul class="mt-1 space-y-0.5">
            <For each={props.result.lines}>
              {(l) => (
                <li class="tabular flex items-baseline gap-2 font-mono text-xs text-foreground">
                  <span class="text-primary">{l.cpt ?? "—"}</span>
                  <span class="flex-1 truncate text-muted-foreground">
                    {l.description}
                  </span>
                  <span>×{l.units}</span>
                  <span>{cents(l.chargeCents)}</span>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  );
}
