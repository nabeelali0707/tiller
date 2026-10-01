# Tiller

Keep your agent on course.

Tiller is a local execution runtime for AI coding agents: explicit execution strategies, observable tool activity, verified outcomes, and bounded recovery.

**Status: early execution runtime prototype.** Sequential and Hierarchical execution, reactive baselines, a strategy-comparison harness, CLI, SQLite traces, copied workspaces, budget limits, acceptance checks, interruption recovery, scripted/Ollama/OpenAI adapters are implemented. Search, dynamic routing, MCP, and the editor integration remain planned. No agent-performance benchmark results are claimed.

## Try it

Requires Node.js 24.14+ and npm. Git is required for the patch applicability test. On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

```sh
npm ci
npm test
npm run demo
```

The demo records a failing addition check, reads the broken file, applies a scripted repair to a copied workspace, and reruns real checks. It writes `changes.patch` and `changes.json` under `.tiller/runs/<run-id>/`. The source fixture stays unchanged. Scripted decisions demonstrate runtime behavior, not model capability.

```sh
npm run tiller -- inspect <run-id>
npm run tiller -- trace <run-id>
npm run tiller -- diff <run-id>
```

For live use, configure `OPENAI_API_KEY` through your environment and select a compatible model using `--model` or `TILLER_MODEL`:

```sh
npm run build
npm run tiller -- run examples/repair/task.json --model YOUR_MODEL_ID
```

You can also run an already-installed local Ollama model without an API key:

```sh
ollama serve
# In another terminal, after npm run build:
npm run tiller -- run examples/repair/task.json --provider ollama --model lfm2.5:8b
```

Use `ollama list` to choose a model installed on your machine. Tiller does not download models. Its Ollama adapter accepts only loopback IP endpoints and rejects cloud model tags.

For a deterministic Hierarchical example:

```sh
npm run tiller -- run examples/hierarchical/task.json --script examples/hierarchical/script.json
```

The runtime dispatches an investigation leaf, requires actual file-read evidence, then dispatches its dependent repair leaf and checks the result before aggregating the parent. All task checks run again before final success.

Compare the four implemented strategies with deterministic fixtures:

```sh
npm run tiller -- compare examples/repair/task.json --scripts examples/comparison/scripts.json
```

Each condition gets a fresh workspace with the same inputs, checks, and budget caps. The JSON report records outcomes, resource use, latency, and links to run traces. Scripted results validate execution paths; they do not measure model performance.

Run the development suite (addition, input validation, and a repair spanning two source files):

```sh
npm run demo:suite
# Once LFM is installed, run the same suite with model decisions:
npm run tiller -- evaluate examples/evaluation/suite.json --provider ollama --model lfm2.5:8b
```

Suite reports preserve each task's results and partial progress. Budgets apply separately to each run. These fixtures are development examples; a held-out evaluation remains future work.

OpenAI runs send the task and observed file/check content to OpenAI; Ollama runs send it to the configured local server. Do not include secrets in the declared inputs. The adapters have mocked HTTP contract tests; a paid live request has not been tested in this workspace because no API key was configured.

See [runtime usage](docs/runtime-usage.md) for task manifests, limits, cancellation, and recovery.

## Current execution boundary

The prototype executes **trusted local tasks**. File tools enforce explicit read/write lists in a copied workspace, but acceptance commands execute code with local process privileges. This is not a container or security sandbox. Do not use it on hostile repositories or untrusted check commands. API credentials are not forwarded to check processes; logs and artifacts may still contain sensitive source or check output.

Success means the declared checks passed on the recorded files. It does not guarantee a correct solution beyond those checks. Patches are returned for review and are not automatically applied to the source repository.

## The problem

A good-looking plan is not evidence of correct execution. An agent can abandon its declared structure, follow an unsuitable strategy, or complete its planned steps without solving the task.

Tiller records the plan, dispatched operation, observed result, and final verification separately. Its initial scope is small, self-contained repository changes with executable acceptance checks. Whether this improves agent outcomes under a fixed budget still needs evaluation.

## Product direction

- Own the execution loop and dispatch one bounded work unit at a time.
- Record actual tool calls, plan revisions, checks, resource use, and recovery decisions.
- Start with Sequential and Hierarchical executors and explicit verification.
- Add isolated Search candidates, then experimental dynamic switching.
- Learn routing policies only after collecting useful, held-out evaluation evidence.

MCP is a proposed integration surface. An ordinary MCP connection does not give Tiller control over a host agent's other tools. Observe-only integrations must be labeled accordingly.

## Design documents

- [Research audit](docs/research-audit.md): evidence, limitations, and corrections to the supplied research notes.
- [Product plan](docs/product-plan.md): target users, scope, value, and release gates.
- [Runtime architecture](docs/architecture.md): execution contracts, recovery, switching, and integration boundaries.
- [Evaluation plan](docs/evaluation-plan.md): baselines, budget accounting, measurements, and decision criteria.
- [Implementation roadmap](docs/roadmap.md): ordered milestones and acceptance criteria.
- [Runtime usage](docs/runtime-usage.md): implemented commands, task format, and limitations.

## Research foundation

Oota et al., *Do LLM Agents Execute the Plans They Declare? From Planning-Mode Declaration to Pattern-Specific Execution*, arXiv:2609.38108v1, 29 September 2026. The supplied PDF is the source reviewed for this design. [Paper](https://arxiv.org/abs/2609.38108).

Dynamic routing and learned selection are hypotheses to evaluate, not demonstrated Tiller capabilities. Dispatch order does not guarantee action correctness or task success.

## Development workflow

Make a separate commit after each major, coherent change. Include the relevant verification and keep generated traces, credentials, and local research scratch files out of Git. Do not claim a capability is implemented until it has a working path and appropriate checks.
