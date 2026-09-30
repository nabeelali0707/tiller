# Evaluation plan

Status: proposed protocol. No results have been collected.

## Questions

1. Does runtime-controlled execution improve verified task success or reduce cost compared with a generic agent?
2. Does dynamic switching improve over ordinary replanning and fixed-strategy retries?
3. Can an empirical router select better initial strategies on unfamiliar repositories?
4. Do traces reduce a developer's time to diagnose and recover a failed run?

Evaluate engineering correctness separately from model effectiveness. A scheduler test proves transition behavior, not that Tiller solves coding tasks better.

## Task design

Start with 20-30 reproducible tasks for harness debugging. Use repository snapshots with known failing behavior, fixed dependencies, executable acceptance checks, and regression checks. Include invalidated assumptions, multiple plausible repairs, unavailable dependencies, impossible goals, and flaky infrastructure. Identify flaky checks before comparing policies.

Freeze a disjoint evaluation set after the pilot. Split by repository and task family where possible, with a later time-based validation set for learned routing. Choose sample size from pilot variance and a prespecified minimum useful effect; a tiny pilot cannot establish a five-percentage-point gain. Use at least three independently sampled runs per task/condition initially and cluster statistical analysis by task or repository, not by treating repeated runs as independent tasks.

Keep hidden evaluation tests and reference solutions outside planner, router, and candidate selector inputs. Visible checks may guide recovery; hidden checks score the final selected artifact. Preserve test commands, environment version, task manifest, model ID/configuration, policy version, and seed where supported. Seeds do not ensure deterministic remote model responses.

## Baselines

| Condition | Purpose |
| --- | --- |
| Flat ReAct | Generic no-explicit-plan baseline. |
| Plan+ReAct | Same model/tools with an initial plan passed as context. |
| Fixed Sequential | Tests whether ordinary replanning is sufficient. |
| Fixed Hierarchical | Tests structured decomposition without switching. |
| Fixed Search | Measures candidate exploration and selection. |
| Best development-selected fixed policy with retries | Main alternative to routing; pick the policy on development data only. |
| Static LLM routing | Tests model-declared strategy selection without switching. |
| Heuristic dynamic routing | Tests bounded monitor-triggered switching. |
| Learned initial routing | Later condition, after outcome data exist. |

Add Predefined for a fuller paper-oriented study. The principal product experiment can initially use Sequential and Hierarchical. Do not select the "best fixed" baseline using the held-out outcomes and then describe it as a deployable policy; hindsight best is a separate diagnostic.

## Fair resource accounting

Use the same model, tools, initial snapshots, verification access, and limits across paired conditions. Count planning, decomposition, execution, monitoring, replanning, candidates, retries, candidate selection, and verification. Apply a common total token/call envelope and report actual spend, tool time, and latency; use cost-success curves when strategies spend different amounts.

Run a separate attempt-matched experiment for Search and retries. Three attempts do not necessarily consume equal tokens or money. Report sequential and parallel latency separately; parallel execution reduces wall time without making computation free. Count failed and abandoned candidates.

Retry selection must use the same visible evidence available to Tiller. Report selected-output success as the deployable result. Report oracle pass@k separately as the fraction with any hidden-test-passing candidate; it is not the success rate of a selector that cannot see hidden labels.

The original paper's test-blocked coding protocol is a separate reproduction target. Tiller's test-guided task suite evaluates a product extension; it must not be presented as an exact reproduction.

## Measurements

| Metric | Definition |
| --- | --- |
| Verified task success | Selected final artifact passes required hidden acceptance and regression checks. |
| Run outcome | Passed, failed, unverified, cancelled, or budget-exhausted; never a percentage for one run. |
| Success rate | Successful tasks/attempts with the denominator and aggregation method stated. |
| Cost per success | Total measured cost of all evaluated attempts divided by successful selected outputs; undefined when none succeed. |
| Latency | Median and p95 end-to-end time including environment setup and verification. |
| Recovery | Final success among runs that encountered a preregistered failure trigger; interpret alongside paired policy results. |
| Dispatch conformance | Violations of executor ordering, prerequisites, or active-segment boundaries. |
| Semantic adherence | Check-backed completion of plan units; heuristic/judged units labeled separately. |
| Coverage | Observable operations and missing telemetry, with denominator only when independently measurable. |
| Switching | Number, trigger, estimated/actual overhead, resumed work, stale-check invalidations. |
| Human utility | Time to correctly diagnose/recover comparable failures, plus reviewer acceptance. |

Retain original plan versions so deletion of unfinished units cannot inflate adherence. Do not aggregate Search candidate completion with ordered-step adherence as though they measure the same thing. Treat verifier judgments with uncertainty and audit a sample of failure labels with humans.

## Ablations and interpretation

Hold the base executor constant while removing monitoring, recovery, or switching. Compare a same-strategy repair against a strategy change after the same trigger. Randomize eligible switching decisions in isolated experiments where appropriate, rather than interpreting rescued runs alone as causal evidence. Compare learned routing against fixed and frequency-matched policies; log selection probabilities if collecting exploratory data for later learning.

Only the chosen strategy's outcome is observed in ordinary production logs. Do not label untried strategies as failures. Collect counterfactual strategy comparisons in controlled offline tasks, and use conservative fallbacks for new model versions or repository types.

Report paired success differences with 95% confidence intervals using a task/repository-clustered bootstrap. Publish denominators, timeouts, cancellations, infrastructure exclusions decided in advance, and all tested policy variants. Do not tune thresholds on the held-out results. Include regressions and inconclusive outcomes.

## Proposed release thresholds

Before confirmatory runs, freeze one primary criterion. A starting proposal is at least +5 percentage points of verified success at comparable total spend, or at least 20% lower cost with success no more than 2 percentage points worse. These are product targets, not paper results; check interval bounds for superiority/non-inferiority and collect enough tasks to resolve them.

Dynamic routing must satisfy the chosen criterion against the strongest development-selected fixed/retry baseline, not only Flat ReAct. Runtime correctness additionally requires no unhandled dispatch/budget/isolation violations in the acceptance suite. If routing is inconclusive, keep it experimental. User-visible diagnostic value can justify a simpler product through a separately measured pilot.

## Result artifact

Publish a manifest, reproducible commands, raw redacted event traces, selected patches, visible/hidden check outcomes with access controls, complete usage accounting, and a report including confidence intervals. Until those artifacts exist, demos and diagrams must carry no invented success, fidelity, or confidence scores.
