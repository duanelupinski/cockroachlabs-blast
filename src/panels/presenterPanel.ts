import * as vscode from 'vscode';
import { getWebviewContent } from './webviewHelper';
import { ConnectionManager } from '../db/connectionManager';
import { ClusterManager } from '../cluster/clusterManager';
import { queryNodes, queryTableRanges, replicaCountsByRegion } from '../db/topologyQueries';
import { loadPlaybook, type Playbook } from '../playbook/playbookLoader';
import { SqlTerminalManager } from '../terminal/sqlTerminal';

export class PresenterPanel {
  public static currentPanel: PresenterPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private playbook: Playbook;
  private snapshotBefore: unknown = null;

  static createOrShow(
    context: vscode.ExtensionContext,
    conn: ConnectionManager,
    cluster: ClusterManager,
    sqlTerminal: SqlTerminalManager
  ): PresenterPanel {
    if (PresenterPanel.currentPanel) {
      PresenterPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return PresenterPanel.currentPanel;
    }
    const panel = vscode.window.createWebviewPanel(
      'blast.presenter',
      'CockroachDB Blast',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webapp', 'dist')],
      }
    );
    PresenterPanel.currentPanel = new PresenterPanel(panel, context, conn, cluster, sqlTerminal);
    return PresenterPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private context: vscode.ExtensionContext,
    private conn: ConnectionManager,
    private cluster: ClusterManager,
    private sqlTerminal: SqlTerminalManager
  ) {
    this.panel = panel;
    this.playbook = loadPlaybook(context.extensionPath);
    this.panel.webview.html = getWebviewContent(this.panel.webview, context.extensionUri, 'presenter');
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);
    this.startPolling();
    setTimeout(() => this.pushPlaybook(), 300);
  }

  private async onMessage(message: { type: string; [k: string]: unknown }) {
    switch (message.type) {
      case 'ready':
        this.pushPlaybook();
        await this.pushTopology();
        break;
      case 'runStep':
        await this.runStep(Number(message.index));
        break;
      case 'runAll':
        this.runAll();
        break;
      case 'openExternal':
        if (typeof message.url === 'string') {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        break;
      case 'getTopology':
        await this.pushTopology();
        break;
    }
  }

  private async runStep(index: number): Promise<void> {
    const step = this.playbook.steps[index];
    if (!step) return;
    this.sqlTerminal.sendSql(step.sql);
    if (step.snapshot === 'before') {
      void this.captureSnapshot();
    }
    const licenseHint = await this.detectLicenseError(step.sql);
    this.panel.webview.postMessage({ type: 'stepRan', index, error: licenseHint });
    if (licenseHint) {
      vscode.window.showErrorMessage(licenseHint);
    }
  }

  /** Super regions need an enterprise license; surface that if the SQL will fail. */
  private async detectLicenseError(statements: string[]): Promise<string | null> {
    const needsLicense = statements.some((s) => /super\s+region/i.test(s));
    if (!needsLicense) return null;
    const ok = await this.ensureConnected();
    if (!ok) return null;
    try {
      await this.conn.query('SET enable_super_regions = on');
    } catch {
      /* session setting may not exist on all versions */
    }
    for (const raw of statements) {
      if (!/add\s+super\s+region/i.test(raw)) continue;
      try {
        await this.conn.query(raw);
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (/already exists|duplicate/i.test(msg)) return null;
        if (/license|enterprise|unimplemented|not.*enabled/i.test(msg)) {
          return `Super regions need an enterprise license. Set cockroachBlast.enterpriseLicense (and organization) in settings, then restart the cluster. ${msg}`;
        }
        return msg;
      }
    }
    return null;
  }

  private runAll(): void {
    const all = this.playbook.steps.flatMap((s) => s.sql);
    this.sqlTerminal.sendSql(all);
    this.panel.webview.postMessage({ type: 'allRan' });
  }

  private async captureSnapshot(): Promise<void> {
    try {
      const data = await this.fetchTopology();
      this.snapshotBefore = data;
      this.panel.webview.postMessage({ type: 'snapshot', when: 'before', data });
    } catch {
      /* ignore */
    }
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      void this.pushTopology();
    }, 2000);
  }

  private async ensureConnected(): Promise<boolean> {
    if (this.conn.isConnected()) return true;
    if (this.cluster.getInfo().state !== 'running') return false;
    try {
      await this.conn.connectLocal(this.cluster.getInfo().sqlPort);
      return true;
    } catch {
      return false;
    }
  }

  private async fetchTopology() {
    const nodes = await queryNodes(this.conn);
    const ranges = await queryTableRanges(this.conn, this.playbook.focusTable);
    const byRegion = replicaCountsByRegion(nodes, ranges);
    return {
      nodes,
      ranges,
      byRegion,
      focusTable: this.playbook.focusTable,
      superRegion: this.playbook.superRegion,
      clusterConnected: true,
    };
  }

  private async pushTopology(): Promise<void> {
    const ok = await this.ensureConnected();
    if (!ok) {
      this.panel.webview.postMessage({ type: 'disconnected' });
      return;
    }
    try {
      const data = await this.fetchTopology();
      this.panel.webview.postMessage({ type: 'topology', data, snapshotBefore: this.snapshotBefore });
    } catch {
      this.panel.webview.postMessage({ type: 'disconnected' });
    }
  }

  private pushPlaybook(): void {
    this.panel.webview.postMessage({
      type: 'playbook',
      playbook: this.playbook,
      httpPort: this.cluster.getInfo().httpPort,
    });
  }

  dispose(): void {
    PresenterPanel.currentPanel = undefined;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
