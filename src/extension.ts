import * as vscode from 'vscode';
import { ClusterManager } from './cluster/clusterManager';
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

export function activate(context: vscode.ExtensionContext) {
  const cluster = new ClusterManager(context.extensionPath);
  const conn = new ConnectionManager();
  const sqlTerminal = new SqlTerminalManager(cluster, cluster.getEngine());
  const tree = new ClusterTreeProvider(cluster);

  void cluster.refreshFromRuntime();

  context.subscriptions.push(
    cluster,
    vscode.window.registerTreeDataProvider('blast.cluster', tree),
    vscode.commands.registerCommand('blast.createCluster', async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Starting insecure 9-node Blast cluster…' },
        async () => {
          await cluster.createCluster();
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
    }),
    vscode.commands.registerCommand('blast.destroyCluster', async () => {
      conn.dispose();
      await cluster.destroyCluster();
    }),
    vscode.commands.registerCommand('blast.openPresenter', async () => {
      if (cluster.getInfo().state !== 'running') {
        const start = await vscode.window.showWarningMessage(
          'No cluster is running. Start the local 9-node insecure cluster?',
          'Start cluster'
        );
        if (start) {
          await vscode.commands.executeCommand('blast.createCluster');
        }
      }
      try {
        if (!conn.isConnected()) {
          await conn.connectLocal(26257);
        }
      } catch {
        vscode.window.showWarningMessage('Cluster SQL is not ready yet. Presenter will retry.');
      }
      PresenterPanel.createOrShow(context, conn, cluster, sqlTerminal);
      sqlTerminal.openSqlShell(true);
    }),
    vscode.commands.registerCommand('blast.openSqlTerminal', () => {
      sqlTerminal.openSqlShell(true);
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
