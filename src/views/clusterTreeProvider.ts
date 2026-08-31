import * as vscode from 'vscode';
import { ClusterManager } from '../cluster/clusterManager';

export class ClusterTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChange.event;

  constructor(private cluster: ClusterManager) {
    cluster.onStateChanged(() => this.onDidChange.fire());
  }

  refresh(): void {
    this.onDidChange.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const info = this.cluster.getInfo();
    const items: vscode.TreeItem[] = [];

    const status = new vscode.TreeItem(
      `Status: ${info.state} (${info.engine})`,
      vscode.TreeItemCollapsibleState.None
    );
    status.iconPath = new vscode.ThemeIcon(info.state === 'running' ? 'pass' : 'circle-slash');
    items.push(status);

    const version = new vscode.TreeItem(`Version: ${info.version}`, vscode.TreeItemCollapsibleState.None);
    version.command = { command: 'blast.selectVersion', title: 'Select Version' };
    version.iconPath = new vscode.ThemeIcon('versions');
    items.push(version);

    const start = new vscode.TreeItem('Start 9-node cluster', vscode.TreeItemCollapsibleState.None);
    start.command = { command: 'blast.createCluster', title: 'Start cluster' };
    start.iconPath = new vscode.ThemeIcon('play');
    items.push(start);

    const destroy = new vscode.TreeItem('Destroy cluster', vscode.TreeItemCollapsibleState.None);
    destroy.command = { command: 'blast.destroyCluster', title: 'Destroy cluster' };
    destroy.iconPath = new vscode.ThemeIcon('trash');
    items.push(destroy);

    const presenter = new vscode.TreeItem('Open Presenter', vscode.TreeItemCollapsibleState.None);
    presenter.command = { command: 'blast.openPresenter', title: 'Open Presenter' };
    presenter.iconPath = new vscode.ThemeIcon('globe');
    items.push(presenter);

    const sql = new vscode.TreeItem('Open cockroach sql', vscode.TreeItemCollapsibleState.None);
    sql.command = { command: 'blast.openSqlTerminal', title: 'Open SQL Terminal' };
    sql.iconPath = new vscode.ThemeIcon('terminal');
    items.push(sql);

    return items;
  }
}
