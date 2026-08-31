import * as vscode from 'vscode';
import { ClusterManager } from '../cluster/clusterManager';
import type { ContainerEngine } from '../cluster/engine';

const TERMINAL_NAME = 'CockroachDB SQL';

export class SqlTerminalManager {
  private terminal: vscode.Terminal | undefined;

  constructor(
    private clusterManager: ClusterManager,
    private engine: ContainerEngine
  ) {}

  openSqlShell(inEditor = true): vscode.Terminal | undefined {
    const info = this.clusterManager.getInfo();
    if (info.state !== 'running') {
      vscode.window.showWarningMessage('No CockroachDB cluster is running.');
      return undefined;
    }

    if (this.terminal && vscode.window.terminals.includes(this.terminal)) {
      this.terminal.show();
      return this.terminal;
    }

    const containerName = this.clusterManager.getActiveNodeContainerName(1);
    const terminalArgs = this.engine.execTerminalArgs(containerName, [
      'cockroach',
      'sql',
      '--insecure',
    ]);

    const location = inEditor
      ? { viewColumn: vscode.ViewColumn.Beside }
      : vscode.TerminalLocation.Panel;

    this.terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      iconPath: new vscode.ThemeIcon('database'),
      location,
      ...terminalArgs,
    });
    this.terminal.show();

    const disposable = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === this.terminal) {
        this.terminal = undefined;
        disposable.dispose();
      }
    });

    return this.terminal;
  }

  sendSql(statements: string[]): void {
    const term = this.openSqlShell(true);
    if (!term) return;
    for (const sql of statements) {
      const text = sql.trim().endsWith(';') ? sql.trim() : `${sql.trim()};`;
      term.sendText(text, true);
    }
  }

  dispose(): void {
    this.terminal?.dispose();
    this.terminal = undefined;
  }
}
