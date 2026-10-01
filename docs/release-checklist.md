# Release and validation state

Version 0.2.0 is a local prototype package, not a production release or evidence that Tiller improves agent outcomes.

Implemented paths: Sequential, Hierarchical, reactive baselines, opt-in experimental routing, Docker checks, budgeted Search, task suites, independent evaluation checks, authenticated loopback dashboard, scoped stdio MCP, local VS Code timeline extension, doctor, traces, cancellation and explicit recovery. Small existing files and dependency-free Node check tasks remain the supported scope. Arbitrary dependency installation, new-file creation, large repositories and concurrent agents remain future work.

The package includes compiled source, documentation and examples only. `npm pack --pack-destination output` builds it before packing. Local run data, credentials, tests, dependencies and download logs are excluded. Install the resulting archive into a separate prefix to check the `tiller` executable before distributing it. No npm publication or website deployment is performed automatically. Licensing has not been selected; the package is marked UNLICENSED.

Local verification covers schema and gateway boundaries, real acceptance checks, recoverable interruptions, budget accounting, Search winner/no-winner/conflict paths, two-switch handoff, private evaluation failures, dashboard authentication/origin checks, and actual MCP stdio negotiation. Search/routing unit tests inject real local checks to validate coordinator behavior; they are not container-isolation evidence.

Outstanding release gates:

- Expand live LFM validation beyond the initial fixture; record model identity, failures and real outcomes. The exact model is installed.
- Keep running the actual Docker isolation probes on supported environments. Local probes, scripted Docker Search and Linux CI have passed; these are bounded checks rather than a containment audit.
- Collect a frozen, representative external task set with repository-family-disjoint development/held-out partitions; evaluate fixed strategies, fixed retries and dynamic switching under comparable caps.
- Measure failure rates, cost and latency; do not substitute deterministic scripted results for model results.
- Review containment, sensitive-data handling, raw-log retention and dependency updates for the intended deployment environment.
- Pilot the interface with real developers before calling it production-ready.
