# Sandbox, Search and experimental routing

Set `execution: {"mode":"docker","image":"node:24-alpine"}` in a task. Install/start a local Linux Docker engine and explicitly run `docker pull node:24-alpine` first. Tiller resolves the installed image to an immutable ID and retains that ID on resume. It does not download images or fall back to local checks. Only Node check commands are supported initially. The engine must use seccomp. Remote Docker contexts are rejected.

Checks run as UID 65534 with no network, read-only root and workspace, dropped capabilities, no-new-privileges, bounded memory/CPU/process counts, and an ephemeral temporary directory. The model cannot control Docker flags. Tiller's file gateway writes declared editable files between checks. Docker is a containment boundary, not a guarantee against kernel or Docker vulnerabilities; use a trusted image and current engine. The sandbox supports these small dependency-free Node tasks, not arbitrary package installation or large repositories. [Docker run reference](https://docs.docker.com/reference/cli/docker/container/run/).

On termination Tiller removes the container, then checks for a create/termination race. Operation IDs map to container names `tiller-<operation-id>`. A host crash can leave a container: inspect the pending intent, stop/remove that exact container, reconcile side effects, and resume. Do not clear intents before cleanup.

## Search

```sh
npm run build
npm run tiller -- run examples/search/task.json --provider ollama --model lfm2.5:8b
# Deterministic control example, once Docker works:
npm run tiller -- run examples/search/task.json --script examples/repair/script.json
```

Search creates 2-3 separate candidate runs from the same entry snapshot. Each candidate uses Sequential execution in its own workspace and sandboxed checks. Their model/tool dispatches and supplied usage count against one parent budget and deadline, including losing candidates. Remaining call/tool capacity is divided over remaining candidates; promotion and final verification have reserved tool capacity. Candidate setup consumes wall time but is not counted as a model/tool dispatch.

Only passing candidates are eligible. Selection prefers fewer changed files, then fewer model calls, then run ID. This is a deterministic visible-check heuristic, not a quality guarantee. The winner is copied only if the parent still matches its entry snapshot; all task checks run again after promotion. No passing candidate means failure with no winner. Losing workspaces and traces remain available. A paused candidate retains its ID; inspect/reconcile it before resuming the parent. Unknown partial promotion is never blindly replayed over accepted user edits: restore the entry snapshot or start a new run.

Use `compare --strategies sequential,search` with a Docker task to compare both under the same execution boundary. Default comparisons still select the original four strategies.

## Switching

Enable `routing: {"enabled":true}` explicitly in a task. Defaults: two identical failing check results, two-operation cooldown, at most two switches. The initial fixed policy tries Hierarchical -> Sequential -> Search. Search requires Docker and enough remaining capacity; unsupported switches are declined. Completed work stays in the workspace. Archived hierarchy state, entry hashes, generations and spent counters appear in `strategy.switched` events. The same budget and absolute deadline apply after handoff.

Switches happen between awaited operations under one writer lock; the old executor releases its lease before Search starts. Candidates cannot recursively switch. There are no asynchronous concurrent workers. This policy does not estimate whether another strategy will succeed and is disabled by default. Repeated identical failures are an experimental signal, not evidence of strategy superiority.

Local deterministic tests exercise scheduling, accounting, handoff and conflicts using real local check processes with an injected backend. They do not prove container isolation. Run `TILLER_DOCKER_TESTS=1 npm test` on a working local Docker installation to enable real isolation probes. Windows PowerShell: `$env:TILLER_DOCKER_TESTS='1'; npm.cmd test`. Actual local Docker isolation probes and the scripted Search fixture passed on 1 October 2026; Linux CI also passed. See [validation results](validation-results.md) for the scope of this evidence.
