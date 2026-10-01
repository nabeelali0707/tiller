# Implementation roadmap

This roadmap follows dependencies rather than promising dates. Commit each completed major change separately. The repository contains runtime, Search/routing, evaluation and interface prototypes; see [release gates](release-checklist.md) for outstanding validation. The architecture below remains the broader target.

## 0. Product and evidence foundation

Delivered: connected repository, research audit, product scope, architecture, and evaluation design. No provider credentials or model executions are needed for this stage.

## 1. Smallest working controlled run

Current implementation: typed contracts, SQLite events, file gateway, scripted/Ollama/OpenAI adapters, Sequential loop, CLI, bounded checks, artifacts, checkpoints, durable queued actions, cancellation and reconciliation. Offline fixtures pass real checks. Default execution uses trusted local processes; actual Docker probes also pass. Scope is limited to explicit small file sets. See validation results for live-model evidence and limits.

Implement typed run/plan/event schemas, a deterministic transition core, SQLite event persistence, a tool gateway, a scripted test adapter, and a local CLI. Add one real provider adapter and a Sequential executor. Support a bounded repository task with read/edit/test tools, explicit acceptance checks, resource reservations, cancellation, inspection, and checkpoints.

Acceptance:

- A real run on a fixture repository produces a reviewable patch and actual check output.
- A false model completion claim cannot turn failing/missing checks into success.
- Repeated failures stop at the run limit; retries and resume preserve spent budget.
- Crash after tool intent but before outcome enters reconciliation rather than blindly replaying writes.
- Trace reconstruction does not execute tools; incomplete telemetry is visible.

Suggested commits: state contracts; durable run core; gateway and adapter; Sequential vertical slice. Each commit includes appropriate focused verification.

## 2. Hierarchical control and baseline harness

Implemented: bounded tree validation, deterministic eligible-leaf dispatch, read/check evidence, parent aggregation, stale-check invalidation, Flat ReAct/Plan+ReAct controls, single-task comparison, and a task-suite harness with three development fixtures. Evidence currently demonstrates runtime correctness, not agent efficacy. Held-out task collection remains future work.

Add bounded tree decomposition, prerequisite validation, leaf dispatch, parent aggregation, and immutable plan revisions. Build Flat ReAct and Plan+ReAct comparison paths sharing model and tools. Run a small harness pilot to validate resource accounting and task manifests.

Acceptance: reject cyclic/oversized plans, block dependent leaves when prerequisites fail, preserve partial progress, and produce comparable raw results. Do not claim efficacy from scheduler fixtures or the development pilot.

## 3. Isolated Search

Implemented: mandatory Docker mode, image pinning, independent candidate workspaces, shared parent call/tool/deadline accounting, losing-candidate costs, visible-check selection, conflict-safe promotion and fresh verification. Unit scheduling tests pass with real local checks behind an injected backend. Actual Docker probes and scripted Search also passed locally, with Linux isolation probes passing in CI.

Add resettable candidate environments, shared budget allocation, visible-check-based selection, patch promotion, and post-promotion checks. Establish the supported sandbox platform and fail clearly when its isolation requirements are unavailable; do not silently substitute plain worktrees.

Acceptance: candidates cannot alter each other's workspaces or trusted checks; both start from the same snapshot; losing candidates consume budget; no winner is claimed when all fail; destination conflicts preserve user work.

## 4. Experimental dynamic switching

Implemented: disabled-by-default identical-check-failure monitor, Hierarchical -> Sequential -> Search policy, two-switch cap, cooldown, archived hierarchy, generation and checkpoint events, shared limits and deadline. Deterministic end-to-end handoff passes. Live efficacy versus fixed retries remains unevaluated.

Implement a progress monitor, same-strategy recovery, switch policy, cooldown/caps, and checkpoint handoff. Add the Hierarchical -> Sequential -> Search demonstration with deterministic fixtures and a separate live evaluation.

Acceptance: late callbacks cannot mutate a new segment; switches do not reset limits; completed work is retained where valid; stale checks are invalidated; unsupported or unaffordable switches are rejected. Test both recovery and failure/stop paths. Compare against fixed retries before enabling by default.

## 5. Integrations and usability

Implemented: authenticated loopback dashboard with observed timeline/patch preview, scoped stdio MCP start/status/cancel/resume/artifact tools, and a local VS Code run/event/patch extension. Real stdio negotiation, interface request-boundary tests and editor CLI integration pass. User pilots and usability measurements remain future work. Best-effort presentation masking does not make raw local run data safe to publish.

Expose the working coordinator through MCP run/status/cancel tools. Add an editor timeline from real events. State which adapters offer control versus observation and test those claims against actual host capabilities. Conduct developer pilots and measure diagnosis time and repeated use.

Acceptance: users can start, inspect, cancel, and review a bounded run; observed/self-reported data cannot be mistaken for enforced execution; credentials and source are not exported accidentally.

## 6. Empirical routing and later composition

Collect task/strategy/outcome matrices offline, freeze repository-disjoint splits, train a simple cost-aware policy, and compare it to the strongest development-selected fixed default. Introduce more complex policies only if the simple one demonstrates useful headroom.

Acceptance: sparse/out-of-distribution cases use an explicit fallback; outcomes of untried strategies remain unknown; policy versions are reproducible; held-out results satisfy the evaluation gate. Hybrid composition can reuse scoped segments. Tree search and multi-agent execution require their own justified experiments.

## First implementation layout

Proposed directories, to be created with working code rather than empty placeholders:

```text
src/core/          state, contracts, transition validation, budgets
src/storage/       events, checkpoints, artifact references
src/tools/         capability gateway and execution boundaries
src/adapters/      provider interfaces and first implementation
src/executors/     Sequential, then Hierarchical and Search
src/policies/      fixed defaults, recovery, switching
src/verification/  acceptance checks and evidence
src/cli/           run, inspect, cancel, resume
tests/             transition, crash, budget, isolation scenarios
eval/              fixtures, manifests, baselines, reports
```

The implementation paths above now exist, including independent private-check evaluation and prototype packaging. Next work: expand live-model validation, collect a frozen external held-out task set, evaluate the fixed switching policy against controls, and pilot the product. Larger repositories and learned routing require those foundations. Scripted fixtures are engineering demonstrations, not efficacy results.
