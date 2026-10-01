# Prototype validation — 1 October 2026

These checks establish bounded implementation behavior. They do not establish that Tiller improves agent success rates, general containment, or production readiness.

## Environment and Docker

Development host: Windows with Node.js 24.14.1, Docker Desktop 4.77.0 using its Linux engine, and Ollama 0.30.10. Docker startup was repaired by moving stale local socket runtime directories to recoverable backups; no images or volumes were reset.

The actual Docker probes passed locally: a non-root check could not write the bound workspace or container root, had no external network interface, received no provider secret, and its timed-out container was removed. The explicit Linux Docker CI job and both platform test jobs passed at [commit a7e326b](https://github.com/nabeelali0707/tiller/actions/runs/36831309594).

The scripted Docker Search run `0881faf6-7c44-4a13-9898-26d10ff1a6c3` succeeded. Two isolated candidates used six model decisions and ten tool calls in total, including losing-candidate work and fresh post-promotion verification. The winner was `1dc80f18-30d9-4ad8-b166-240feba343dd`. Scripted decisions consumed no model tokens and measure coordinator behavior only.

## Exact local model

Installed `lfm2.5:8b`, digest `9cf756159fc2f3b9128c6a3f544ec90c5e9b8afdbb4179a57b8aea9de589cfb2`, GGUF lfm2moe 8.5B Q4_K_M. Metadata advertises completion, tools and thinking. The adapter requests an 8192-token context, temperature zero, a structured decision schema and no cloud endpoint.

The first cold request paused without a decision after a transport failure; its reserved call remains charged as unknown usage. A subsequent transport mismatch was found and fixed by using the HTTP client and dispatcher from the same installed Undici version. A real loopback HTTP regression test covers this path. A model-response probe showed a leading `<think>` block even with `think:false`; strict final-JSON parsing after a closed prefix now handles that template. Incomplete prefixes and extra commentary remain rejected, and all generated tokens are charged. A run before that parsing change rejected the response and was cancelled. Live repair outcomes are recorded below when completed; installed capabilities alone are not coding evidence.

Run `7323486d-e7b6-45cf-b0f4-92c60c40d05f` exhausted its ten-minute deadline during its first request. The local server recorded 47 minutes of elapsed request time with only 654 decoded tokens; the host clock advanced sharply between observations. This is an interrupted/slow-run failure, not an accepted repair. The next smoke task allows thirty minutes for CPU inference; this changes the smoke configuration rather than retroactively increasing the failed run's budget.

Liquid AI's [model card](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B) describes explicit reasoning before the final answer. The runtime's `think:false` request does not guarantee that this model template omits reasoning.

## Interfaces and evaluation

Dashboard authentication/origin tests and actual MCP stdio negotiation pass. The dashboard was inspected in the in-app browser, including its narrow layout, observed hierarchy events and patch preview. The local VS Code extension was packaged as a VSIX and installed through VS Code's CLI; its backend invokes the actual CLI in integration tests. An interactive editor/user pilot has not been completed.

Independent evaluation tests demonstrate a repair passing agent-visible checks but failing private checks, with private inputs excluded from model context. The three development fixtures remain synthetic. No frozen external held-out task collection, learned routing policy or efficacy comparison has been completed.

## Package and checks

All 51 tests passed locally with `TILLER_DOCKER_TESTS=1`: no skips or failures. [CI for d5e0301](https://github.com/nabeelali0707/tiller/actions/runs/36839168065) also passed. The npm archive excludes run data, credentials, dependencies, tests and stale build output. A separate-prefix installation of the archive ran the scripted repair successfully (`23035c1f-f867-4dc6-a9b3-7729d5b25364`). The production dependency audit reported no known vulnerabilities at this time. These checks do not replace deployment review.
