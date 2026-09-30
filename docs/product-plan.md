# Tiller product plan

## Product decision

Build a local execution runtime for developers running AI agents on repository bug fixes and small changes with testable acceptance criteria. The first useful outcome is a reviewable patch accompanied by evidence: what ran, what passed, what failed, how much was spent, and why recovery occurred.

This is worth a bounded prototype. The paper motivates the execution problem; it does not validate a market or establish profitable strategy selection. Keep the ambitious routing vision, but make each added capability earn its place through evaluation.

## Initial user and job

The first user maintains a repository with reproducible checks and already spends time rerunning or supervising coding agents. Their job: give an agent a bounded issue, obtain a patch and verification report, and understand failures without rereading an entire conversation.

Start with one supported provider adapter and one repository/task format. Choose the provider during implementation based on available access; preserve the adapter boundary. Avoid a promise of universal agent compatibility.

Proposed workflow:

1. Select repository, issue, allowed tools, acceptance checks, and resource limits.
2. Capture a clean task snapshot and existing test failures.
3. Execute with an explicit strategy; show current subtask and verified evidence.
4. If progress stalls, explain whether Tiller continues, retries, switches, or stops.
5. Present patch, checks, trace, spend, and unresolved requirements for review.

The early CLI now supports `run`, `inspect`, and `resume` through `npm run tiller -- ...` after building. See [runtime usage](runtime-usage.md). The remainder of this document describes the product direction; the full release scope is not implemented yet.

## Problems and responses

| Problem | Proposed mechanism | Limit of the claim |
| --- | --- | --- |
| Declared structure disappears during execution. | Scheduler owns subtask dispatch and mediates tool calls. | Only applies to the controlled run; actions can still be incorrect. |
| A plan becomes obsolete. | Version plans and permit evidence-backed sequential replanning. | Following a revised plan is not proof that the revision is good. |
| Wrong strategy for a task. | Configurable fixed defaults, offline strategy comparison, later empirical router. | Task-specific routing benefit is unknown. |
| Unexpected state invalidates decomposition. | Checkpoint, suspend affected subtree, switch to a sequential repair segment. | Triggering too often can make performance worse. |
| Several plausible fixes remain. | Run bounded alternatives in isolated environments with shared evaluation. | Requires meaningful checks and resettable state. |
| Completion claims lack evidence. | User-defined acceptance checks and immutable test artifacts. | Tests cover only what they test; ambiguous results remain unverified. |
| Retries consume unlimited resources. | Run-wide limits covering planning, execution, candidates, recovery, and checks. | Provider billing may arrive late; reserve capacity before dispatch. |
| Failures are hard to diagnose. | Causal trace linking task, plan version, action, observation, check, and decision. | Coverage depends on the integration and must be displayed. |

## Release scope

**First vertical slice:** local CLI, Sequential executor, a real provider adapter, mediated tools, append-only events, checkpoints, budget limits, acceptance checks, and replayable inspection. Implement Hierarchical next on the same primitives. Use a scripted adapter for deterministic scheduler tests, but do not mistake those tests for agent evaluation.

**Experimental expansion:** isolated Search, bounded dynamic switching, then empirical initial routing. Hybrid means composition of existing strategies, such as a hierarchical leaf running a Search segment. A graph can encode dependencies without becoming a fifth marketing feature.

**Integration expansion:** MCP run/status/cancel interfaces and a read-only editor timeline after the runtime works. Do not begin with a polished dashboard whose underlying results are scripted.

**Defer:** autonomous production deployment, unrestricted external mutations, open-ended multi-agent teams, model training, distributed scheduling, and broad browser automation. These would expand the control and evaluation problem before the core value is known.

## Demonstration

Use a small fixture repository with a genuine failing regression check. A hierarchical run discovers an invalid assumption, records the evidence, and enters sequential diagnosis. If two distinct repair hypotheses remain, it evaluates them from the same checkpoint in Search. It applies the selected patch, runs the required checks again, and returns to the remaining subgoals.

Show failure cases too: neither candidate passes; the budget cannot support Search; a verification step times out; the run crashes during a write. Label deterministic fixtures as demonstrations. Publish independently sampled task results separately.

## Practical scale and value

Start with one active workspace writer and bounded local concurrency. Store metadata in SQLite and large outputs as referenced files. Model calls and candidate environments will probably dominate costs; measure that assumption. Reserve each candidate's share of a common budget, reuse immutable setup artifacts when valid, and trigger expensive diagnosis only after cheap signals fire.

A later team service could coordinate isolated workers and shared trace storage. It would need quotas, retention controls, access boundaries, and provider rate-limit handling. Local traces may contain proprietary source or secrets; redact sensitive fields and make export explicit.

Potential differentiation is verified recovery with reproducible evidence and controlled spend. This is a product hypothesis, not a completed competitive analysis. Interview 5-10 developers, observe their existing recovery workflow, and pilot with at least three repositories before committing to a hosted business. Measure repeat usage, diagnosis time, installation effort, and cost per accepted patch. Hosted retention and team policies are possible paid features, not validated pricing.

## Decision gates

- Continue execution work if held-out evaluation shows useful success or cost benefits, or users consistently gain diagnosis/recovery value.
- Enable Search only when isolation, patch selection, and final verification work reliably.
- Enable dynamic switching by default only after it beats the strongest development-selected fixed/retry alternative under the evaluation protocol.
- Keep learned routing off by default when data are sparse or the deployment differs from training data.
- If dynamic policies add cost without benefit, ship explicit fixed strategies and useful traces. If even those lack user value, revise the product rather than adding more strategies.
