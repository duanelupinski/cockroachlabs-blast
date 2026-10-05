import * as vscode from 'vscode';
import { ClusterManager, type DemoId } from './cluster/clusterManager';
import { ConnectionManager } from './db/connectionManager';
import { SqlTerminalManager } from './terminal/sqlTerminal';
import { PresenterPanel } from './panels/presenterPanel';
import { ClusterTreeProvider } from './views/clusterTreeProvider';

const CRDB_VERSIONS = [
  { label: 'v26.1', tag: 'v26.1.5' },
  { label: 'v25.4', tag: 'v25.4.11' },
  { label: 'v25.2', tag: 'v25.2.19' },
  { label: 'latest', tag: 'latest' },
];

function asDemo(value: unknown): DemoId {
  if (value === 'ha' || value === 'upgrade' || value === 'table-locality' || value === 'mcp') return value;
  return 'multi-region';
}

function demoName(demo: DemoId): string {
  if (demo === 'ha') return 'HA';
  if (demo === 'upgrade') return 'zero-downtime upgrade';
  if (demo === 'table-locality') return 'multi-region table locality';
  if (demo === 'mcp') return 'MCP server';
  return 'multi-region';
}

function startTitle(demo: DemoId): string {
  if (demo === 'ha') return 'Starting insecure 3-node HA Blast cluster…';
  if (demo === 'upgrade') return 'Starting insecure 3-node us-west cluster on v25.4…';
  if (demo === 'table-locality') return 'Starting insecure 9-node table-locality cluster…';
  if (demo === 'mcp') return 'Starting insecure 3-node MCP demo cluster…';
  return 'Starting insecure 6-node Blast cluster…';
}

function startPrompt(demo: DemoId): string {
  if (demo === 'ha') return 'No cluster is running. Start the local 3-node HA cluster?';
  if (demo === 'upgrade') return 'No cluster is running. Start the local 3-node us-west cluster on v25.4?';
  if (demo === 'table-locality') {
    return 'No cluster is running. Start the local 9-node table-locality cluster?';
  }
  if (demo === 'mcp') return 'No cluster is running. Start the local 3-node MCP demo cluster?';
  return 'No cluster is running. Start the local 6-node insecure cluster?';
}

export function activate(context: vscode.ExtensionContext) {
  const cluster = new ClusterManager(context.extensionPath);
  const conn = new ConnectionManager();
  const sqlTerminal = new SqlTerminalManager(cluster, cluster.getEngine());
  const tree = new ClusterTreeProvider(cluster);

  void cluster.refreshFromRuntime();

  const startCluster = async (demo: DemoId) => {
    const info = cluster.getInfo();
    if ((info.state === 'running' || info.state === 'starting') && info.demo !== demo) {
      const ok = await vscode.window.showWarningMessage(
        `A ${demoName(info.demo)} cluster is running. Destroy it and start the ${demoName(demo)} cluster?`,
        'Switch'
      );
      if (ok !== 'Switch') return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: startTitle(demo) },
      async () => {
        await cluster.createCluster(demo);
        try {
          await conn.connectLocal(26257);
          await cluster.applyDemoSettings(async (sql) => {
            await conn.query(sql);
          });
        } catch {
          /* cluster may still be initializing */
        }
      }
    );
  };

  context.subscriptions.push(
    cluster,
    vscode.window.registerTreeDataProvider('blast.cluster', tree),
    vscode.commands.registerCommand('blast.createCluster', async (demo?: DemoId) => {
      await startCluster(asDemo(demo));
    }),
    vscode.commands.registerCommand('blast.destroyCluster', async (demo?: DemoId) => {
      const info = cluster.getInfo();
      if (demo && info.state !== 'stopped' && info.demo !== demo) {
        vscode.window.showInformationMessage('That demo is not the running cluster.');
        return;
      }
      conn.dispose();
      sqlTerminal.dispose();
      await cluster.destroyCluster();
    }),
    vscode.commands.registerCommand('blast.openPresenter', async (demo?: DemoId) => {
      const wanted = asDemo(demo);
      if (cluster.getInfo().state !== 'running') {
        const start = await vscode.window.showWarningMessage(startPrompt(wanted), 'Start cluster');
        if (start) {
          await startCluster(wanted);
        }
      } else if (demo && cluster.getInfo().demo !== wanted) {
        vscode.window.showWarningMessage(
          `The running cluster is ${demoName(cluster.getInfo().demo)}. Start that demo’s cluster first, or switch from the sidebar.`
        );
      }
      try {
        if (cluster.getInfo().state === 'running' && !conn.isConnected()) {
          await conn.connectLocal(26257);
        }
      } catch {
        vscode.window.showWarningMessage('Cluster SQL is not ready yet. Presenter will retry.');
      }
      PresenterPanel.createOrShow(context, conn, cluster, sqlTerminal);
      if (cluster.getInfo().state === 'running') {
        await sqlTerminal.openSqlShell(true);
      }
    }),
    vscode.commands.registerCommand('blast.openSqlTerminal', async () => {
      await sqlTerminal.openSqlShell(true);
    }),
    vscode.commands.registerCommand('blast.selectVersion', async () => {
      const pick = await vscode.window.showQuickPick(
        CRDB_VERSIONS.map((v) => ({ label: v.label, description: v.tag })),
        { title: 'CockroachDB version' }
      );
      if (pick?.description) {
        cluster.setVersion(pick.description);
        tree.refresh();
      }
    })
  );

  context.subscriptions.push({
    dispose: () => {
      conn.dispose();
      sqlTerminal.dispose();
    },
  });
}

export function deactivate() {}
