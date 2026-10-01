# Reproducible evaluation

Development fixtures test execution paths. They are deliberately public, synthetic, and have known-answer scripts. They are not a representative benchmark or a held-out study. No live LFM result has been collected yet.

Suite cases can optionally declare `partition` (`development` by default or `held-out`) and an `oracle`:

```json
{
  "id": "external-task-001",
  "partition": "held-out",
  "task": "tasks/001/task.json",
  "oracle": {
    "repository": "private-checks/001",
    "files": ["private.test.cjs"],
    "checks": [{"id":"private","command":"node","args":["private.test.cjs"],"timeoutMs":15000}]
  }
}
```

Oracle paths resolve relative to the suite file. Oracle files must not overlap declared agent inputs. Their hashes are captured at preflight; changed oracle inputs interrupt evaluation. Checks run after the comparison in separate copied workspaces and do not enter model context, observations or feedback. For Docker tasks they run in the same sandbox boundary. Trusted-local evaluation remains trusted local code. Evaluation checks cannot change declared inputs.

Reports retain agent-visible acceptance separately from `evaluations[].passed`. A run can pass visible checks and fail private checks. Evaluation tool calls, elapsed time, image identity and file hashes are reported separately from agent-run budgets. The original run status is not rewritten. The harness does not train a router or automatically reuse evaluation results for subsequent attempts.

The harness rejects the same repository directory appearing in both partitions. A `held-out` label is an operator declaration, not proof of novelty, repository independence, licensing, or absence from model training. Collect external tasks, freeze manifest/data revisions, check repository-family overlap, and reserve a split before tuning the policy. Do not relabel the development examples as held-out evidence. The stronger evidence gates in [evaluation plan](evaluation-plan.md) still apply.

Use identical model versions, tools and execution mode across conditions. Include fixed retries as a control for switching, count all candidates and planning costs, report failed/interrupted runs and unknown usage, and compare acceptance under matched budget caps. Do not infer significance from a few examples or claim equal realized compute from equal configured caps.
