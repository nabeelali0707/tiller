# Implementation roadmap

This roadmap follows dependencies rather than promising dates. Commit each completed major change separately. The repository now contains Sequential and Hierarchical prototypes; see [runtime usage](runtime-usage.md). The architecture below remains the broader target.

## 0. Product and evidence foundation

Delivered: connected repository, research audit, product scope, architecture, and evaluation design. No provider credentials or model executions are needed for this stage.

## 1. Smallest working controlled run

Current implementation: typed task/decision contracts, SQLite state and events, file gateway, scripted and OpenAI Responses adapters, Sequential loop, CLI, bounded checks, patch artifacts, checkpoints, cancellation, and explicit reconciliation. The offline fixture passes real checks. Live-provider quality and billing are unverified without credentials. Execution currently uses trusted local processes rather than a security sandbox, and scope is limited to an explicit small file set. Full hierarchical work-unit modeling and sandboxing are future work.

Implement typed run/plan/event schemas, a deterministic transition core, SQLite event persistence, a tool gateway, a scripted test adapter, and a local CLI. Add one real provider adapter and a Sequential executor. Support a bounded repository task with read/edit/test tools, explicit acceptance checks, resource reservations, cancellation, inspection, and checkpoints.

Acceptance:

- A real run on a fixture repository produces a reviewable patch and actual check output.
- A false model completion claim cannot turn failing/missing checks into success.
- Repeated failures stop at the run limit; retries and resume preserve spent budget.
- Crash after tool intent but before outcome enters reconciliation rather than blindly replaying writes.
- Trace reconstruction does not execute tools; incomplete telemetry is visible.

Suggested commits: state contracts; durable run core; gateway and adapter; Sequential vertical slice. Each commit includes appropriate focused verification.

## 2. Hierarchical control and baseline harness

Implemented: bounded tree validation, deterministic eligible-leaf dispatch, read/check evidence, parent aggregation, stale-check invalidation, and an offline fixture. Flat ReAct/Plan+ReAct controls and a comparative harness are still in progress. Evidence currently demonstrates runtime correctness, not agent efficacy.

Add bounded tree decomposition, prerequisite validation, leaf dispatch, parent aggregation, and immutable plan revisions. Build Flat ReAct and Plan+ReAct comparison paths sharing model and tools. Run a small harness pilot to validate resource accounting and task manifests.

Acceptance: reject cyclic/oversized plans, block dependent leaves when prerequisites fail, preserve partial progress, and produce comparable raw results. Do not claim efficacy from scheduler fixtures or the development pilot.

## 3. Isolated Search

Add resettable candidate environments, shared budget allocation, visible-check-based selection, patch promotion, and post-promotion checks. Establish the supported sandbox platform and fail clearly when its isolation requirements are unavailable; do not silently substitute plain worktrees.

Acceptance: candidates cannot alter each other's workspaces or trusted checks; both start from the same snapshot; losing candidates consume budget; no winner is claimed when all fail; destination conflicts preserve user work.

## 4. Experimental dynamic switching

Implement a progress monitor, same-strategy recovery, switch policy, cooldown/caps, and checkpoint handoff. Add the Hierarchical -> Sequential -> Search demonstration with deterministic fixtures and a separate live evaluation.

Acceptance: late callbacks cannot mutate a new segment; switches do not reset limits; completed work is retained where valid; stale checks are invalidated; unsupported or unaffordable switches are rejected. Test both recovery and failure/stop paths. Compare against fixed retries before enabling by default.

## 5. Integrations and usability

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

Next engineering work: validate the live adapter with user-configured credentials on the fixture, establish the sandbox boundary for larger/untrusted tasks, and add milestone 2's Hierarchical executor and comparable baselines. The scripted fixture is an engineering demonstration, not an efficacy result.
