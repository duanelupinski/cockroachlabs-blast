import * as vscode from 'vscode';
import {
  ClusterManager,
  UPGRADE_SOURCE_VERSION,
  UPGRADE_TARGET_VERSION,
  type DemoId,
} from '../cluster/clusterManager';

type ItemKind = 'section' | 'status' | 'version' | 'start' | 'destroy' | 'presenter' | 'sql';

class BlastTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly kind: ItemKind,
    public readonly demo: DemoId,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.id = `${demo}:${kind}:${label}`;
    this.contextValue = kind;
  }
}

export class ClusterTreeProvider implements vscode.TreeDataProvider<BlastTreeItem> {
  private readonly onDidChange = new vscode.EventEmitter<BlastTreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChange.event;

  constructor(private cluster: ClusterManager) {
    cluster.onStateChanged(() => this.onDidChange.fire(undefined));
  }

  refresh(): void {
    this.onDidChange.fire(undefined);
  }

  getTreeItem(element: BlastTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BlastTreeItem): BlastTreeItem[] {
    if (!element) return this.getRoots();
    if (element.kind === 'section') return this.getDemoItems(element.demo);
    return [];
  }

  private getRoots(): BlastTreeItem[] {
    const info = this.cluster.getInfo();
    const active = info.state !== 'stopped' ? info.demo : null;
    return [
      this.section(
        'Multi-region - table locality',
        'table-locality',
        active === 'table-locality' || active === null
      ),
      this.section('Multi-region', 'multi-region', active === 'multi-region'),
      this.section('High availability and resiliency', 'ha', active === 'ha'),
      this.section('Zero downtime upgrade', 'upgrade', active === 'upgrade'),
      this.section('MCP server', 'mcp', active === 'mcp'),
    ];
  }

  private section(label: string, demo: DemoId, expanded: boolean): BlastTreeItem {
    const item = new BlastTreeItem(
      label,
      'section',
      demo,
      expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
    );
    const icon =
      demo === 'ha' ? 'shield' : demo === 'upgrade' ? 'cloud-upload' : demo === 'mcp' ? 'comment-discussion' : 'globe';
    item.iconPath = new vscode.ThemeIcon(icon);
    if (demo === 'table-locality') {
      item.tooltip = 'US-East, US-West, and EU-West. The previous two-region demo is still listed as Multi-region.';
    } else if (demo === 'multi-region') {
      item.tooltip = 'Previous version: US-East and EU-West only. Start this cluster to revert.';
    } else if (demo === 'mcp') {
      item.tooltip = '3-node MovR cluster with the CockroachDB MCP server and a throughput chart.';
    }
    return item;
  }

  private getDemoItems(demo: DemoId): BlastTreeItem[] {
    const info = this.cluster.getInfo();
    const isActive = info.state !== 'stopped' && info.demo === demo;
    const items: BlastTreeItem[] = [];

    const statusLabel = isActive
      ? `Status: ${info.state} (${info.engine})`
      : info.state !== 'stopped'
        ? 'Status: stopped (other demo running)'
        : `Status: ${info.state} (${info.engine})`;
    const status = new BlastTreeItem(statusLabel, 'status', demo, vscode.TreeItemCollapsibleState.None);
    status.iconPath = new vscode.ThemeIcon(isActive && info.state === 'running' ? 'pass' : 'circle-slash');
    items.push(status);

    const version = new BlastTreeItem(
      demo === 'upgrade'
        ? `${UPGRADE_SOURCE_VERSION} → ${UPGRADE_TARGET_VERSION}`
        : `Version: ${info.version}`,
      'version',
      demo,
      vscode.TreeItemCollapsibleState.None
    );
    if (demo !== 'upgrade') {
      version.command = { command: 'blast.selectVersion', title: 'Select Version' };
    }
    version.tooltip =
      demo === 'upgrade' ? 'Rolling upgrade from CockroachDB v25.4 to v26.2' : 'Select CockroachDB version';
    version.iconPath = new vscode.ThemeIcon('versions');
    items.push(version);

    const startLabel =
      demo === 'table-locality'
        ? 'Start 9-node cluster'
        : demo === 'multi-region'
          ? 'Start 6-node cluster'
          : 'Start 3-node cluster';
    const start = new BlastTreeItem(startLabel, 'start', demo, vscode.TreeItemCollapsibleState.None);
    start.command = { command: 'blast.createCluster', title: 'Start cluster', arguments: [demo] };
    start.iconPath = new vscode.ThemeIcon('play');
    items.push(start);

    const destroy = new BlastTreeItem('Destroy cluster', 'destroy', demo, vscode.TreeItemCollapsibleState.None);
    destroy.command = { command: 'blast.destroyCluster', title: 'Destroy cluster', arguments: [demo] };
    destroy.iconPath = new vscode.ThemeIcon('trash');
    items.push(destroy);

    const presenter = new BlastTreeItem('Open Presenter', 'presenter', demo, vscode.TreeItemCollapsibleState.None);
    presenter.command = { command: 'blast.openPresenter', title: 'Open Presenter', arguments: [demo] };
    presenter.iconPath = new vscode.ThemeIcon('globe');
    items.push(presenter);

    const sql = new BlastTreeItem('Open cockroach sql', 'sql', demo, vscode.TreeItemCollapsibleState.None);
    sql.command = { command: 'blast.openSqlTerminal', title: 'Open SQL Terminal' };
    sql.iconPath = new vscode.ThemeIcon('terminal');
    items.push(sql);

    return items;
  }
}
