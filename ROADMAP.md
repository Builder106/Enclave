# Enclave Roadmap

Privacy-first local AI execution and agent orchestration roadmap.

## v1.1 — SolidJS Frontend Architecture

- **SolidJS Migration**: Transitioning interface from legacy rendering to reactive SolidJS architecture per [`docs/specs/solidjs-migration-plan.md`](docs/specs/solidjs-migration-plan.md).
- **Zero-Copy Streaming**: Local WebAssembly and WebSocket streaming for low-latency token generation.

## v1.2 — Local Agent Tool Sandboxing

- **Wasm Sandboxed Execution**: Strict execution boundary for LLM tool invocation and python scratchpad execution.
- **Multimodal Audio/Vision Streaming**: Local voice activity detection (VAD) and image inspection.

## Out of Scope

- Centralized cloud telemetries or conversation logging
- Unsandboxed local shell execution

---
For technical specifications, see [`docs/specs/`](docs/specs/).
