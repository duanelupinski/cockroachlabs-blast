import * as vscode from 'vscode';
import {
  ClusterManager,
  UPGRADE_SOURCE_VERSION,
  UPGRADE_TARGET_VERSION,
  type DemoId,
} from '../cluster/clusterManager';

type ItemKind =
  | 'section'
  | 'status'
  | 'version'
  | 'start'
  | 'destroy'
  | 'mcp-container'
  | 'mcp-create'
  | 'mcp-drop'
  | 'presenter'
  | 'sql';

const playIcon = new vscode.ThemeIcon('play', new vscode.ThemeColor('charts.green'));
const trashIcon = new vscode.ThemeIcon('trash', new vscode.ThemeColor('charts.red'));

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

  async getChildren(element?: BlastTreeItem): Promise<BlastTreeItem[]> {
    if (!element) return this.getRoots();
    if (element.kind === 'section') return this.getDemoItems(element.demo);
    return [];
  }

  private getRoots(): BlastTreeItem[] {
    const info = this.cluster.getInfo();
    const active = info.state !== 'stopped' ? info.demo : null;
    return [
      this.section('High availability and resiliency', 'ha', active === 'ha' || active === null),
      this.section('Zero downtime upgrade', 'upgrade', active === 'upgrade'),
      this.section('Multi-region - table locality', 'table-locality', active === 'table-locality'),
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
      item.tooltip = 'US-East, US-West, and EU-West. Super region US is {us-east, us-west}; EU is {eu-west}.';
    } else if (demo === 'mcp') {
      item.tooltip =
        '3-node Podman cluster with TPCC. The workspace MCP container is blast-mcp-server from .cursor/mcp.json, signed in as mcp_demo.';
    }
    return item;
  }

  private async getDemoItems(demo: DemoId): Promise<BlastTreeItem[]> {
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

    const startLabel = demo === 'table-locality' ? 'Start 9-node cluster' : 'Start 3-node cluster';
    const start = new BlastTreeItem(startLabel, 'start', demo, vscode.TreeItemCollapsibleState.None);
    start.command = { command: 'blast.createCluster', title: 'Start cluster', arguments: [demo] };
    start.iconPath = playIcon;
    items.push(start);

    const destroy = new BlastTreeItem('Destroy cluster', 'destroy', demo, vscode.TreeItemCollapsibleState.None);
    destroy.command = { command: 'blast.destroyCluster', title: 'Destroy cluster', arguments: [demo] };
    destroy.iconPath = trashIcon;
    items.push(destroy);

    if (demo === 'mcp') {
      const running = await this.cluster.mcpContainerRunning();
      const mcpStatus = new BlastTreeItem(
        running ? 'MCP container: running' : 'MCP container: stopped',
        'mcp-container',
        demo,
        vscode.TreeItemCollapsibleState.None
      );
      mcpStatus.iconPath = new vscode.ThemeIcon(running ? 'vm-running' : 'vm');
      mcpStatus.tooltip = 'blast-mcp-server from .cursor/mcp.json';
      items.push(mcpStatus);

      const createMcp = new BlastTreeItem(
        'Create MCP server container',
        'mcp-create',
        demo,
        vscode.TreeItemCollapsibleState.None
      );
      createMcp.command = {
        command: 'blast.createMcpServer',
        title: 'Create MCP server container',
      };
      createMcp.iconPath = new vscode.ThemeIcon('add');
      items.push(createMcp);

      const dropMcp = new BlastTreeItem(
        'Drop MCP server container',
        'mcp-drop',
        demo,
        vscode.TreeItemCollapsibleState.None
      );
      dropMcp.command = { command: 'blast.dropMcpServer', title: 'Drop MCP server container' };
      dropMcp.iconPath = trashIcon;
      items.push(dropMcp);
    }

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
