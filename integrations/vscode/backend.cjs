const { execFile } = require('node:child_process');
const { resolve } = require('node:path');
function invoke(node, cli, root, data, command, id) {
  if (!['list', 'inspect', 'trace', 'diff', 'cancel'].includes(command)) return Promise.reject(new Error('Unsupported editor operation'));
  if (command !== 'list' && !/^[a-f0-9-]{36}$/.test(id || '')) return Promise.reject(new Error('Select a valid run'));
  const args = [resolve(cli), command, ...(id ? [id] : []), '--data-dir', resolve(root, data)];
  return new Promise((done, reject) => execFile(node, args, { cwd: root, windowsHide: true,
    timeout: 15000, maxBuffer: 8_000_000, shell: false }, (error, output) => {
    if (error) reject(new Error('Tiller CLI failed. Check Node 24.14+, cliPath, selected workspace and data directory.'));
    else done(output);
  }));
}
function eventSummary(event) {
  const result = event.data?.result;
  if (result?.checkId) return `${event.type} · ${result.checkId} · ${result.passed ? 'passed' : 'failed'}`;
  if (result?.path) return `${event.type} · ${result.path}`;
  return event.type;
}
module.exports = { invoke, eventSummary };
