const vscode = require('vscode');
const { resolve } = require('node:path');
const { invoke, eventSummary } = require('./backend.cjs');

function activate(context) {
  const changed = new vscode.EventEmitter(); let folder;
  async function configuration() {
    if (!vscode.workspace.isTrusted) throw new Error('Tiller requires a trusted workspace');
    const folders = vscode.workspace.workspaceFolders || [];
    if (!folder) folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick();
    if (!folder) throw new Error('Select a local workspace');
    if (folder.uri.scheme !== 'file') throw new Error('Tiller currently supports local filesystem workspaces');
    const root = folder.uri.fsPath; const config = vscode.workspace.getConfiguration('tiller', folder.uri);
    return { root, cli: config.get('cliPath') || resolve(root, 'dist/src/cli.js'), node: config.get('nodePath') || 'node', data: config.get('dataDirectory') || '.tiller' };
  }
  async function call(command, id) { const config = await configuration(); return invoke(config.node, config.cli, config.root, config.data, command, id); }
  const provider = {
    onDidChangeTreeData: changed.event,
    getTreeItem(entry) {
      const item = new vscode.TreeItem(entry.label, entry.run ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.description = entry.description; item.tooltip = entry.tooltip || entry.label;
      if (entry.run) { item.contextValue = 'tillerRun'; item.iconPath = new vscode.ThemeIcon(entry.run.status === 'succeeded' ? 'pass' : 'history'); }
      return item;
    },
    async getChildren(entry) {
      try {
        if (!entry) {
          const runs = JSON.parse(await call('list'));
          return runs.map((run) => ({ label: run.goal.slice(0, 90), description: `${run.status} · ${run.strategy}`, tooltip: run.goal, run }));
        }
        const run = entry.run;
        const events = (await call('trace', run.id)).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
        return [{ label: run.acceptance }, { label: `Model calls: ${run.spent.modelCalls}/${run.budget.maxModelCalls}; tools: ${run.spent.toolCalls}/${run.budget.maxToolCalls}` },
          ...events.map((event) => ({ label: eventSummary(event), description: new Date(event.at).toLocaleTimeString() }))];
      } catch (error) { return [{ label: error.message }]; }
    },
  };
  const show = async (entry, command, language) => {
    if (!entry?.run) throw new Error('Select a run in Tiller Runs');
    const content = await call(command, entry.run.id);
    const document = await vscode.workspace.openTextDocument({ content, language }); await vscode.window.showTextDocument(document);
  };
  const guarded = (handler) => async (...args) => { try { await handler(...args); } catch (error) { vscode.window.showErrorMessage(error.message); } };
  context.subscriptions.push(changed, vscode.window.registerTreeDataProvider('tiller.runs', provider),
    vscode.commands.registerCommand('tiller.refresh', () => { folder = undefined; changed.fire(); }),
    vscode.commands.registerCommand('tiller.inspect', guarded((entry) => show(entry, 'inspect', 'json'))),
    vscode.commands.registerCommand('tiller.patch', guarded((entry) => show(entry, 'diff', 'diff'))),
    vscode.commands.registerCommand('tiller.cancel', guarded(async (entry) => { await call('cancel', entry?.run?.id); changed.fire(); })),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { folder = undefined; changed.fire(); }));
}
module.exports = { activate, deactivate() {} };
