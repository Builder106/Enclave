# Contributing to Enclave

Enclave is a local-first agentic pipeline for clinical/billing documents:
synthetic superbill generation → extraction → code matching → anomaly
flagging, with a measured comparison between a deterministic rules baseline,
a local Ollama model, and AWS Bedrock.

## Dev setup

```bash
pnpm install
cp .env.example .env       # fill in AWS creds only if you run the bedrock provider
pnpm db:push               # optional — creates the local SQLite db for run storage
```

Day-to-day commands:

```bash
pnpm generate              # generate the synthetic superbill corpus (seeded)
pnpm measure               # run providers over the eval split, write measurements
pnpm test                  # vitest
pnpm typecheck             # tsc --noEmit
pnpm dev                   # Next.js dashboard
```

A local [Ollama](https://ollama.com) install is required for the `local`
provider (`ollama pull qwen2.5:3b-instruct`). The `rules` provider and the
generator need nothing external.

## Guardrails (non-negotiable)

- **Integer cents everywhere.** Money is never a float. No `12.5`, no

  `"$12.50"`in domain values —`1250` cents.

- **Seeded determinism.** Domain logic (generation, rules extraction, code

  matching, anomaly detection, eval scoring) must never read the wall clock
  or use environment randomness. Seeded RNG only. Same seed → byte-identical
  output, forever.

- **`src/lib/contract.ts` is authoritative.** All shared types live there and

  are imported from `@/lib/contract`. If a change needs a new shape, change
  the contract first and conform everything to it — never fork a local copy.

- **`rules`and`local` providers must never make network calls to model

  APIs.** That is the thesis of the project. `rules` touches nothing;
  `local`talks only to the loopback Ollama endpoint. Only`bedrock` may
  leave the machine, and its egress is measured.

- **No real PHI, ever.** Synthetic data only. Do not paste, commit, or test

  against real patient documents — even "anonymized" ones.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `ci:`, `perf:`.
Scope when useful — `feat(agent): retry malformed extraction once`.

## Pull requests

1. Branch from `main`.
2. `pnpm typecheck && pnpm test && pnpm build` must pass locally (CI gates on

   all three).

3. Keep PRs single-purpose; contract changes get their own PR.

## Out of scope (for now)

- Real EHR integrations (FHIR, HL7, payer clearinghouses)
- Real patient data in any form
- Fine-tuning pipelines

PRs in these areas will be closed without review.

## License

By contributing you agree your contributions are licensed under the
[MIT License](LICENSE).
