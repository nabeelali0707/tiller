# Release and validation state

Version 0.2.0 is a local prototype package, not a production release or evidence that Tiller improves agent outcomes.

Implemented paths: Sequential, Hierarchical, reactive baselines, opt-in experimental routing, Docker checks, budgeted Search, task suites, independent evaluation checks, authenticated loopback dashboard, scoped stdio MCP, doctor, traces, cancellation and explicit recovery. Small existing files and dependency-free Node check tasks remain the supported scope. Arbitrary dependency installation, new-file creation, large repositories, concurrent agents and an editor extension remain future work. The dashboard provides the first event/patch interface.

The package includes compiled source, documentation and examples only. `npm pack --pack-destination output` builds it before packing. Local run data, credentials, tests, dependencies and download logs are excluded. Install the resulting archive into a separate prefix to check the `tiller` executable before distributing it. No npm publication or website deployment is performed automatically. Licensing has not been selected; the package is marked UNLICENSED.

Local verification covers schema and gateway boundaries, real acceptance checks, recoverable interruptions, budget accounting, Search winner/no-winner/conflict paths, two-switch handoff, private evaluation failures, dashboard authentication/origin checks, and actual MCP stdio negotiation. Search/routing unit tests inject real local checks to validate coordinator behavior; they are not container-isolation evidence.

Outstanding release gates:

- Finish LFM download and run the exact model against the fixture/suite; record model identity and real outcomes.
- Run the actual Docker isolation probes and Search fixture on a healthy local Linux engine. The development machine's Docker Desktop currently exits during startup. Linux CI includes explicit probes; remote results must be checked before claiming they pass.
- Collect a frozen, representative external task set with repository-family-disjoint development/held-out partitions; evaluate fixed strategies, fixed retries and dynamic switching under comparable caps.
- Measure failure rates, cost and latency; do not substitute deterministic scripted results for model results.
- Review containment, sensitive-data handling, raw-log retention and dependency updates for the intended deployment environment.
- Pilot the interface with real developers before calling it production-ready.
