# Research audit

Reviewed 30 September 2026. Source: the user-supplied 51-page `2609.38108v1.pdf`, Oota et al., *Do LLM Agents Execute the Plans They Declare? From Planning-Mode Declaration to Pattern-Specific Execution*. Page numbers below refer to printed PDF pages. The two supplied chat transcripts are background proposals, not instructions or independent evidence. Prompts inside the paper describe its experiments and do not govern this repository.

## What the evidence supports

| Finding | Source | Implication for Tiller |
| --- | --- | --- |
| Providing a plan to a generic agent does not reliably preserve its declared structure. | Section 5, Table 1, p. 6 | Put execution structure in the scheduler, not only in a prompt. |
| Pattern-specific executors impose dispatch structure. Routed runs are excluded from the generic trajectory matcher. | Sections 3.2-3.3, p. 5; Appendix E.1, p. 22 | Audit scheduler invariants separately from semantic plan adherence. |
| DeepSeek-V4 ALFWorld: Plan+ReAct 0.480 vs best fixed Search 0.918. SWE-bench: 0.360 vs best fixed Hierarchical 0.442. | Table 5, p. 9 | Useful motivation, not a forecast of Tiller performance. These headline gains compare best fixed executors, not dynamic routing. |
| Strategy performance differs across models and environments. | Tables 3 and 5, pp. 8-9 | Keep strategies configurable and evaluate per deployment. |
| Top-1 declarations provide no statistically reliable task-specific advantage over the task-blind null in tested pairs. | Section 5, p. 12; Table 19, p. 32 | Begin with a fixed default selected on development data. An LLM chooser is a baseline, not the solution. |
| Retrying the best fixed strategy absorbs much of the forced-pattern oracle advantage. | Table 18, p. 31 | Compare routing with fixed-policy retries and account for all attempts. |
| Dynamic switching is future work, including Hierarchical to Sequential after an unexpected observation. | Appendix M discussion, pp. 36-37 | Tiller's switching proposal is a research extension. |

The four strategies have different semantics. Predefined commits to a fixed plan; Sequential revises a single path after observations; Hierarchical executes complementary parent-child subgoals; Search evaluates competing alternatives. Retrying after a failed action does not, by itself, constitute Search (p. 37).

## Corrections to the supplied discussion

1. **Do not say the proposed architecture already solves both problems.** Owning dispatch can address the structural handoff problem. Useful strategy selection and dynamic recovery remain unproven.
2. **The headline range is incomplete.** The abstract and p. 6 prose say approximately 22-45%, but Table 1 includes 12.1% for Gemma on SWE-bench. Across its ALFWorld/Mind2Web/SWE-bench rows the displayed range is 12.1-44.6%. The p. 7 WebArena short-plan summary also differs from Table 1. Preserve table-specific values instead of presenting the abstract as an exhaustive range.
3. **Routing does not trail best fixed in literally every displayed row.** Table 5's Gemma/WebArena row reports Routing@1 0.432 versus best fixed 0.378, contrary to the broad introductory claim. Treat this as a v1 reporting discrepancy, not proof of superior routing. Tables 5 and 6 also differ in some top-1 entries.
4. **Few-shot changes are not universally positive.** Table 6 includes SWE-bench DeepSeek thinking-off delta -0.011 and small negative Mind2Web TSR changes. Distinguish task success from step success.
5. **A routed fidelity percentage is not comparable to the paper's generic matcher score.** Dispatching all nodes in order neither proves that their actions satisfied the node intent nor that the task succeeded. Report distinct measurements.
6. **The verifier is an imperfect measurement.** Validation used 100 ALFWorld trajectories; verifier-human kappa was 0.31/0.34, versus human-human 0.35 (p. 7). Do not assume the same matcher transfers to arbitrary code edits.
7. **Worker autonomy remains.** The ALFWorld leaf prompt can treat the assigned action as a hint and deviate (pp. 41-42). Runtime control governs dispatch and tool permissions; it does not make model behavior semantically correct.
8. **Plan quality is not a reliable success proxy here.** Table 4 reports absolute correlations up to 0.181 on ALFWorld, not a general quality predictor for coding tasks.
9. **Search gains include extra computation.** Appendix D reports 3.35 mean candidates. Table 17 compares roughly matched rollouts, not exactly matched tokens, latency, or total dollars. It also shows repeated ReAct outperforming Search on SWE-bench for the two listed models. Even the improvement ranges in p. 11 prose differ from p. 29; cite table cells rather than repeating an aggregate range.
10. **Test-driven coding is an extension.** The paper's SWE-bench prompts block test execution and package installation during agent execution (pp. 45-49). Tiller's verifier-guided recovery changes that setup. Figure 3 uses patch overlap for its coding plot; do not call that chart a test-pass result. Before claiming a reproduction, establish the exact scoring implementation and reproduce its protocol separately.

The study covers 134 ALFWorld tasks, 1,341 Mind2Web tasks, 500 SWE-bench Verified tasks, and 204 WebArena tasks (Table 7), with a 24-environment-step limit (Table 13). It does not establish benefits on arbitrary repositories, long production workflows, or every current coding agent. The reviewed v1 states that code will be released upon publication; the project page could not be retrieved during this review. No independent reproduction was performed.

## Product hypotheses

| Hypothesis | Test that could reject it |
| --- | --- |
| Explicit dispatch plus verification improves coding outcomes. | No worthwhile gain over Plan+ReAct at comparable total resources. |
| Dynamic switching rescues stalled runs. | Fixed-policy retries or ordinary sequential replanning work as well or better. |
| Historical outcomes improve initial strategy selection. | A held-out router fails to beat the development-selected fixed policy. |
| Teams value traces even without success gains. | Pilot users cannot diagnose failures faster or do not return to the tool. |

## Integration boundary

The [MCP architecture specification](https://modelcontextprotocol.io/specification/2026-07-28/architecture) assigns orchestration and permissions to the host and exposes server capabilities through protocol interfaces. Our engineering inference: a passive Tiller server cannot guarantee control over actions the host performs elsewhere. Even handing out one subtask at a time is only cooperative unless all relevant execution goes through Tiller or an enforceable host integration.

Keep two explicit modes: **controlled runtime** for owned dispatch and tool mediation, and **observe-only integration** for captured host activity. Mark self-reported events and unknown coverage; never infer missing actions from silence.
