# Tiller

Keep your agent on course.

Tiller is a proposed execution runtime for AI coding agents: explicit execution strategies, observable tool activity, verified outcomes, and bounded recovery.

**Status: research and product design. No runtime, CLI, MCP server, or benchmark results are implemented yet.**

## The problem

A good-looking plan is not evidence of correct execution. An agent can abandon its declared structure, follow an unsuitable strategy, or complete its planned steps without solving the task.

Tiller will make these failures distinguishable and test whether controlling execution improves outcomes under a fixed budget. Its initial scope is repository bug fixes and small changes with executable acceptance checks.

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

## Research foundation

Oota et al., *Do LLM Agents Execute the Plans They Declare? From Planning-Mode Declaration to Pattern-Specific Execution*, arXiv:2609.38108v1, 29 September 2026. The supplied PDF is the source reviewed for this design. [Paper](https://arxiv.org/abs/2609.38108).

Dynamic routing and learned selection are hypotheses to evaluate, not demonstrated Tiller capabilities. Dispatch order does not guarantee action correctness or task success.

## Development workflow

Make a separate commit after each major, coherent change. Include the relevant verification and keep generated traces, credentials, and local research scratch files out of Git. Do not claim a capability is implemented until it has a working path and appropriate checks.
