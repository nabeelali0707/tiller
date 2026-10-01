# Tiller Execution Timeline

A local VS Code view of Tiller's persisted runs and observed events. Expanding a run shows resource use and its timeline. Context commands inspect checkpoints, preview the patch, and request cancellation. It does not start agents, apply patches, or govern other editor tools.

Build Tiller with Node.js 24.14+: `npm ci` and `npm run build`. Package this extension with the official `@vscode/vsce` tool, then use VS Code's **Extensions: Install from VSIX** command. No Marketplace publication is performed.

In a trusted local workspace, set **Tiller: Cli Path** to the absolute built `dist/src/cli.js` path if Tiller is not in that workspace. Set **Tiller: Node Path** if Node 24.14+ is not on PATH. Set **Tiller: Data Directory** to the run directory (default `.tiller`). Select a workspace folder when prompted, then use **Tiller: Refresh Runs**.

The view invokes bounded CLI read/cancel commands with argument arrays and no shell. Workspace Trust is required; virtual workspaces are unsupported. Inspect and patch documents contain raw local run data and may contain sensitive source or output. They are not automatically exported. Completion means declared checks passed, not general correctness. The extension currently has backend integration tests and packaging verification; a full interactive editor pilot remains a release gate.
