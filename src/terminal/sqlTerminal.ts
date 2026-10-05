import * as vscode from 'vscode';
import { ClusterManager } from '../cluster/clusterManager';
import type { ContainerEngine } from '../cluster/engine';

const TERMINAL_NAME = 'CockroachDB SQL';
const STEP_FILE = '/tmp/blast-step.sql';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SqlTerminalManager {
  private terminal: vscode.Terminal | undefined;
  private shellReady: Promise<void> = Promise.resolve();

  constructor(
    private clusterManager: ClusterManager,
    private engine: ContainerEngine
  ) {}

  async openSqlShell(inEditor = true): Promise<vscode.Terminal | undefined> {
    const info = this.clusterManager.getInfo();
    if (info.state !== 'running') {
      vscode.window.showWarningMessage('No CockroachDB cluster is running.');
      return undefined;
    }

    if (this.terminal?.exitStatus) {
      this.terminal.dispose();
      this.terminal = undefined;
    }

    if (this.terminal && vscode.window.terminals.includes(this.terminal)) {
      this.terminal.show(true);
      return this.terminal;
    }

    let shell: { container: string; host?: string };
    try {
      shell = await this.clusterManager.sqlShell();
    } catch {
      vscode.window.showWarningMessage(
        'No live CockroachDB node. Wait for the cluster to finish starting, then open SQL again.'
      );
      return undefined;
    }

    if (inEditor) {
      await this.layoutSqlBelowPresenter();
    }

    const sqlArgs = ['cockroach', 'sql', '--insecure', '--set=prompt1=sql> '];
    if (shell.host) sqlArgs.splice(3, 0, `--host=${shell.host}`);
    const terminalArgs = this.engine.execTerminalArgs(shell.container, sqlArgs);

    const location = inEditor
      ? { viewColumn: vscode.ViewColumn.Two, preserveFocus: true }
      : vscode.TerminalLocation.Panel;

    this.terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      iconPath: new vscode.ThemeIcon('database'),
      location,
      isTransient: true,
      ...terminalArgs,
    });
    this.terminal.show(true);
    // cockroach sql prints a banner before the prompt; wait so \i is not eaten.
    this.shellReady = new Promise((resolve) => setTimeout(resolve, 1500));

    const disposable = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === this.terminal) {
        this.terminal = undefined;
        disposable.dispose();
      }
    });

    return this.terminal;
  }

  /** Presenter on top, full-width SQL terminal underneath. */
  private async layoutSqlBelowPresenter(): Promise<void> {
    try {
      await vscode.commands.executeCommand('vscode.setEditorLayout', {
        orientation: 1,
        groups: [{ size: 0.65 }, { size: 0.35 }],
      });
    } catch {
      /* Cursor/VS Code may already have a two-row layout */
    }
  }

  async sendSql(statements: string[]): Promise<void> {
    const term = await this.openSqlShell(true);
    if (!term) return;

    const block =
      statements
        .map((sql) => {
          const text = sql.trim();
          return text.endsWith(';') ? text : `${text};`;
        })
        .join('\n') + '\n';

    const shell = await this.clusterManager.sqlShell();
    try {
      await this.engine.writeContainerFile(shell.container, STEP_FILE, block);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Could not stage playbook SQL: ${err?.message ?? err}`);
      return;
    }

    await this.shellReady;
    // Still use \i: the SHOW RANGES step is one very long line and the line editor
    // can wrap even a full-width pane. Results render in the wide terminal below.
    term.show(true);
    await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
      text: '\u0003',
    });
    await delay(80);
    term.sendText(`\\i ${STEP_FILE}`, true);
  }

  dispose(): void {
    this.terminal?.dispose();
    this.terminal = undefined;
  }
}
