# Runtime usage

## Implemented scope

Tiller runs a Sequential loop: propose one bounded action and a revised remaining plan, validate the proposal, persist operation intent, execute through the gateway, record its result and file hashes, then replan. Completion proposals trigger all declared acceptance checks. A failed check returns to the loop; no model completion claim can bypass verification.

The current tool set is read an existing declared file, replace an existing editable file, run a named check, or propose completion. Plans and actions are recorded as immutable event entries. This prototype does not implement parent-child work units, new-file creation, arbitrary agent shell access, automatic source patch promotion, MCP, Search, or strategy switching.

## Setup and offline example

Use Node 24.14+ and npm. Node 24 may print an experimental warning for its built-in SQLite API. SQLite uses WAL mode and full synchronous writes. Run data belong on a local filesystem, not a shared network drive.

```sh
npm ci
npm test
npm run demo
```

The example under `examples/repair/` has a subtraction bug. Its script reads the file, replaces subtraction with addition, and proposes completion. The check process really runs before and after the change. Scripted adapter token usage is zero; its decision count still consumes the model-call budget so control tests follow the same limits.

Use the run ID printed by the command:

```sh
npm run tiller -- inspect RUN_ID
npm run tiller -- trace RUN_ID
npm run tiller -- diff RUN_ID
```

`trace` emits NDJSON events and never reexecutes tools. `inspect` reports the last persisted checkpoint, pending operation, plan, recent observations, usage, deadline, and artifact paths. `diff` compares current workspace files with the captured originals, so external edits after completion can differ from the verified hashes. The saved `changes.patch` is the artifact from successful verification; inspect hashes before treating later workspace contents as verified.

## Live provider

The first network adapter uses OpenAI's Responses endpoint with a JSON decision format, explicit model selection, `store: false`, a per-call output-token limit, and cancellation. Runtime schema validation applies independently of model output. See the [official structured output documentation](https://developers.openai.com/api/docs/guides/structured-outputs) for the distinction between JSON output and schema adherence.

Set `OPENAI_API_KEY` through your shell or secret manager. Set `TILLER_MODEL` or supply `--model` with an ID available to your account that supports Responses JSON mode. There is no silently selected model and no automatic HTTP retry.

```sh
npm run build
npm run tiller -- run examples/repair/task.json --model YOUR_MODEL_ID
```

Credentials are read from the environment, not persisted in task files or run state. Only declared files enter the snapshot, and only content read by the worker, check output, and task context enter model requests. Check output can itself contain source or secrets, so review inputs and commands before live runs. Full local events retain read/write content and bounded check output; automatic secret redaction is not implemented. `.tiller/` is ignored by Git.

The provider was tested with mocked HTTP responses for request shape, usage accounting, errors, refusal, and incomplete output. No live provider run was performed during initial implementation because this workspace had no configured API key. A functioning HTTP adapter is not evidence of model task success.

## Task manifest

Paths in `files` and `editable` are portable, case-sensitive relative paths with `/` separators; case-colliding duplicates are rejected. `repository` is relative to the task file. All editable files must already exist and be included in `files`. Only the listed files are copied, so include every required test/config/source dependency.

```json
{
  "version": 1,
  "goal": "Fix numeric addition without changing the CommonJS export.",
  "repository": "./repo",
  "files": ["add.cjs", "add.test.cjs"],
  "editable": ["add.cjs"],
  "checks": [
    { "id": "addition", "command": "node", "args": ["add.test.cjs"], "timeoutMs": 5000 }
  ],
  "budget": {
    "maxModelCalls": 8,
    "maxToolCalls": 12,
    "maxDurationMs": 180000,
    "maxOutputTokensPerCall": 2048
  }
}
```

Validate without executing:

```sh
npm run tiller -- validate path/to/task.json
```

Validation checks the manifest shape; snapshot creation separately checks file existence, symlinks, hardlinks, and size. At least one acceptance check is required. Files not in `editable` are protected from gateway writes, and protected hashes are checked around operations. No shell interpolation is used: a check runs a fixed executable and argument array. `node` resolves to the current Node executable. On Windows, prefer an executable such as `node` with a script argument rather than shell-only `.cmd` wrappers.

Checks must not change declared files; such changes stop the run for reconciliation. Undeclared generated artifacts may be produced by checks but are not part of the managed snapshot, patch, or integrity guarantee. The prototype caps each managed file at 64 KB, a snapshot at 4 MB, and captured output per check at 16 KB. Large repositories and dependency installation are outside this first slice.

## Budgets and outcomes

Hard runtime limits cover dispatched model requests, gateway operations (including baseline and final checks), and one absolute deadline. The runtime reserves final-verification tool capacity before ordinary tools. Every attempted request or tool action consumes its reservation even if it fails. Resume preserves these counters and the original deadline; downtime counts against duration.

Reported token usage is accumulated when the provider supplies valid usage. Interrupted/failed requests remain explicitly unknown. The per-call output cap is sent to the provider; there is no hard total-input-token or dollar budget in this version. A disconnected request may still incur provider charges. Do not interpret recorded usage as a complete bill.

CLI run/resume exits with 0 for verified success, 2 for a non-success run outcome, and 1 for a command/configuration error. Runtime statuses include ready, running, verifying, paused, succeeded, failed, cancelled, and budget-exhausted. Operational faults usually pause for inspection; budget limits terminate the run. Passing the declared tests is a limited acceptance contract, not a claim of general correctness or hidden-test performance.

## Pause, cancellation, and crash recovery

Ctrl+C/SIGTERM requests a pause. From another terminal, request cancellation with:

```sh
npm run tiller -- cancel RUN_ID
```

An active worker polls cancellation and aborts its pending provider request or check process. When no worker is active, cancellation remains a recorded request until a resume processes it. Cancelling does not undo side effects. Child termination is best effort, particularly for intentionally detached subprocesses; this is another reason to use trusted checks only.

Resume with the same adapter identity:

```sh
npm run tiller -- resume RUN_ID --script examples/repair/script.json
npm run tiller -- resume RUN_ID --model YOUR_MODEL_ID
```

Use one of those commands, matching the original run. A script's content hash is part of its identity. Changing it is rejected.

Each external operation has a persisted intent before dispatch and a recorded outcome afterward. A crash in between leaves an unresolved operation. Tiller does not blindly replay a write or check whose side effects may already have happened.

1. Inspect the trace, pending operation, workspace patch, and any external side effects.
2. If the worker crashed, inspect the owner process. `unlock RUN_ID --confirm-owner-stopped` removes a stale lock only when the recorded PID is no longer alive. A surviving or reused PID requires manual investigation.
3. Once the actual workspace state is understood and external effects reconciled, run `reconcile RUN_ID --accept-workspace`.
4. Resume using the original adapter. Tiller retains spent budgets and the deadline, records the operator acknowledgment, and requires fresh acceptance verification before success.

Reconciliation accepts the current editable file state; it does not declare an unknown operation successful. Protected-file modifications must first be restored. Operators must ensure no other process is still editing the workspace before acknowledging reconciliation. Terminal runs cannot be resumed; a new run is a separate budget and task attempt.

Use the same `--data-dir` on all commands if overriding the default `.tiller` directory. The source repository is never automatically changed. Review and apply the returned patch yourself when ready.

## Trust boundary

File allowlists, path validation, and separate snapshots protect normal workflow boundaries. They do not contain arbitrary repository code. Acceptance checks run with the user's local OS privileges and may have network or filesystem side effects. The environment forwarded to checks excludes provider keys and arbitrary environment variables, but filesystem credentials remain accessible to local code. Do not run hostile tasks here. A security sandbox is a later prerequisite for untrusted code and parallel Search.

## Verification so far

Local Windows verification covers the complete offline CLI flow, applicable patch output, real failing/passing checks, false completion, retries, persisted traces, limits, cancellation, malformed provider output, protected-file integrity, and simulated interrupted-write reconciliation. CI is configured for Windows and Linux, but remote CI has not been run as part of this local change. None of these tests establish performance gains over another agent architecture.
