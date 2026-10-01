# Local interfaces

Build once with `npm run build`. `npm run tiller -- doctor --model lfm2.5:8b` reports local model availability and Docker prerequisites without generating model output. Availability is not a live coding or isolation test. To install prerequisites explicitly: `ollama pull lfm2.5:8b`, start a local Linux Docker engine, then `docker pull node:24-alpine`.

## Dashboard

Run `npm run tiller -- dashboard`. Open the printed URL, including its fragment token, in a browser. The server listens only on 127.0.0.1; a random per-launch token authorizes API requests. Correct Host and Origin headers are required. The token is removed from the address bar after loading and is not sent in a URL query. Restarting the server invalidates the token. Do not share the printed URL.

Select a run to see its plan, resource usage, observed timeline and verified patch preview. Refresh reloads the persisted state. Request cancellation records the same durable cancellation flag used by the CLI. Use the CLI or MCP to start runs. Whole-file read/write content is omitted from the default timeline. Sensitive values are masked in presentation and patch previews; the original patch under the run directory remains the artifact to review and apply. Masked previews may not be applicable patches.

The dashboard is a local interface, not a public hosted service. It has no accounts or remote collaboration. Closing it does not terminate an independently running CLI worker.

## MCP

Tiller uses the official MCP TypeScript SDK over stdio. Configure an MCP client to run the built CLI:

```json
{
  "mcpServers": {
    "tiller": {
      "command": "node",
      "args": ["D:/tiller/dist/src/cli.js", "mcp", "--workspace", "D:/tiller", "--data-dir", "D:/tiller/.tiller", "--model", "lfm2.5:8b"]
    }
  }
}
```

Adjust absolute paths and executable location for your machine/client. Tools: `list_runs`, `start_run`, `get_run`, `get_timeline`, `cancel_run`, `resume_run`, `get_artifact`. Start/resume use the configured local Ollama model and Docker tasks inside the configured workspace. Only one run started by this server can be active at a time. The server does not expose reconciliation: inspect unknown side effects and use the explicit CLI command. Disconnect/shutdown requests a pause of its active worker; interruptions can still require reconciliation.

The workspace is an operator-configured capability boundary. Only declared files are copied. Task manifests and container images should be trusted. The agent cannot choose remote endpoints, mount flags, provider credentials, or arbitrary shell tools. Tiller owns the tools in its delegated run; it cannot intercept or govern unrelated tools used by the host agent. [Official SDK](https://github.com/modelcontextprotocol/typescript-sdk).

## Sensitive data

Best-effort masking covers common provider-token patterns, bearer tokens, credential assignments and signed URL parameters in dashboard/MCP views. It is not a complete secret scanner. Raw SQLite events, snapshots, scripts, patches and local reports can contain source or secrets. They remain local and ignored by Git. Do not put secrets in task inputs. Limit access to `.tiller`, review artifacts before sharing, and delete local run data only after stopping workers and preserving needed artifacts. API credentials are not passed to check containers or local check processes.
