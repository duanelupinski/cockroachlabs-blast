import * as vscode from 'vscode';
import { getWebviewContent } from './webviewHelper';
import { ConnectionManager } from '../db/connectionManager';
import { ClusterManager, extractContainerName, type DemoId } from '../cluster/clusterManager';
import {
  queryNodes,
  queryNodeBuildTags,
  queryTableRanges,
  replicaCountsByRegion,
  queryDemoTableCounts,
  queryDemoTableLocality,
  queryCustomerHomeCounts,
  type TopologyNode,
} from '../db/topologyQueries';
import { loadPlaybook, type Playbook } from '../playbook/playbookLoader';
import { SqlTerminalManager } from '../terminal/sqlTerminal';
import { MovrWorkload } from '../workload/movrWorkload';
import { WorkloadStatsParser } from '../workload/workloadStats';
import { McpChatSession } from '../mcp/mcpChat';

export class PresenterPanel {
  public static currentPanel: PresenterPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private playbook: Playbook;
  private snapshotBefore: unknown = null;
  private currentFocusTable: string;
  private latestNodes: TopologyNode[] = [];
  private livenessOverrides = new Map<number, boolean>();
  private stepBusy = false;
  private readonly movr: MovrWorkload;
  private readonly workloadStats = new WorkloadStatsParser();
  private readonly mcpChat: McpChatSession;

  static createOrShow(
    context: vscode.ExtensionContext,
    conn: ConnectionManager,
    cluster: ClusterManager,
    sqlTerminal: SqlTerminalManager
  ): PresenterPanel {
    if (PresenterPanel.currentPanel) {
      PresenterPanel.currentPanel.panel.title =
        'CockroachDB BLAST (Brief Live Assessment & Showcase Tool)';
      PresenterPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      PresenterPanel.currentPanel.pushInit();
      return PresenterPanel.currentPanel;
    }
    const panel = vscode.window.createWebviewPanel(
      'blast.presenter',
      'CockroachDB BLAST (Brief Live Assessment & Showcase Tool)',
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
    this.playbook = this.readPlaybook();
    this.currentFocusTable = this.playbook.focusTable;
    this.movr = new MovrWorkload(cluster.getEngine());
    this.mcpChat = new McpChatSession(context, cluster.getEngine(), (message) => {
      this.panel.webview.postMessage(message);
    });
    this.movr.on('log', (line: string) => {
      this.panel.webview.postMessage({ type: 'movrLog', line });
      const sample = this.workloadStats.parse(line);
      if (sample) this.panel.webview.postMessage({ type: 'throughput', ...sample });
    });
    this.movr.on('status', (status: { state: string; message?: string }) => {
      if (status.state === 'ready') {
        void this.afterMovrInit();
        return;
      }
      this.panel.webview.postMessage({ type: 'movrStatus', ...status });
    });
    this.panel.webview.html = getWebviewContent(this.panel.webview, context.extensionUri, 'presenter');
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);
    this.disposables.push(
      this.cluster.onStateChanged((info) => {
        if (info.state === 'running') {
          void this.pushTopology();
          this.pushInit();
          return;
        }
        this.snapshotBefore = null;
        this.livenessOverrides.clear();
        this.panel.webview.postMessage({ type: 'disconnected' });
        this.pushInit();
      })
    );
    this.startPolling();
    void this.cluster.reloadLoadBalancer();
    setTimeout(() => this.pushInit(), 300);
  }

  private demo(): DemoId {
    return this.cluster.getInfo().demo;
  }

  private readPlaybook(): Playbook {
    const demo = this.demo();
    if (demo === 'upgrade') return loadPlaybook(this.context.extensionPath, 'zero-downtime-upgrade.json');
    if (demo === 'table-locality') {
      return loadPlaybook(this.context.extensionPath, 'gdpr-super-region-3region.json');
    }
    if (demo === 'ha') {
      return {
        id: 'ha',
        title: 'High availability',
        cluster: { nodes: 3, insecure: true },
        focusTable: '',
        steps: [],
      };
    }
    if (demo === 'mcp') return loadPlaybook(this.context.extensionPath, 'mcp-server.json');
    return loadPlaybook(this.context.extensionPath);
  }

  private gossipIdForContainer(nodeNumber: number): number {
    const name = `blast-node-${nodeNumber}`;
    const match = this.latestNodes.find((n) => extractContainerName(n.address) === name);
    return match?.nodeId ?? nodeNumber;
  }

  private async onMessage(message: { type: string; [k: string]: unknown }) {
    switch (message.type) {
      case 'ready':
        this.pushInit();
        await this.pushTopology();
        break;
      case 'runStep':
        await this.runStep(Number(message.index));
        break;
      case 'selectStep':
        this.applyFocusTable(Number(message.index));
        await this.pushTopology();
        break;
      case 'runAll':
        await this.runAll();
        break;
      case 'openExternal':
        if (typeof message.url === 'string') {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        break;
      case 'getTopology':
        await this.pushTopology();
        break;
      case 'killNode':
        await this.handleNodeAction(Number(message.nodeId), 'kill');
        break;
      case 'restartNode':
        await this.handleNodeAction(Number(message.nodeId), 'restart');
        break;
      case 'addHaAzNodes':
        await this.handleAddHaAzNodes();
        break;
      case 'addHaMultiRegion':
        await this.handleAddHaMultiRegion();
        break;
      case 'removeHaAzNodes':
        await this.handleRemoveHaAzNodes();
        break;
      case 'movrInit':
        await this.handleMovrInit();
        break;
      case 'movrRun':
        await this.handleMovrRun(
          typeof message.duration === 'string' ? message.duration : '5m',
          typeof message.concurrency === 'string' ? message.concurrency : '4'
        );
        break;
      case 'movrStop':
        this.movr.stop();
        break;
      case 'mcpSaveKey':
        await this.mcpChat.saveKey(typeof message.key === 'string' ? message.key : '');
        break;
      case 'mcpClearKey':
        await this.mcpChat.clearKey();
        break;
      case 'mcpSend':
        await this.mcpChat.send(typeof message.text === 'string' ? message.text : '');
        break;
    }
  }

  private resolveContainerName(nodeId: number): string {
    const node = this.latestNodes.find((n) => n.nodeId === nodeId);
    if (node?.address) {
      const host = extractContainerName(node.address);
      if (host.startsWith('blast-node-')) return host;
    }
    return this.cluster.getActiveNodeContainerName(nodeId);
  }

  private async handleNodeAction(nodeId: number, action: 'kill' | 'restart'): Promise<void> {
    this.panel.webview.postMessage({ type: 'nodeActionStarted', nodeId, action });
    try {
      const name = this.resolveContainerName(nodeId);
      if (action === 'kill') {
        await this.cluster.stopNode(name);
        this.livenessOverrides.set(nodeId, false);
      } else {
        await this.cluster.startNode(name);
        this.livenessOverrides.set(nodeId, true);
      }
    } catch (err: any) {
      this.panel.webview.postMessage({ type: 'error', message: err.message });
    }
    this.panel.webview.postMessage({ type: 'nodeActionComplete', nodeId });
    this.panel.webview.postMessage({ type: 'reloadConsole' });
    try {
      await this.conn.connectLocal(this.cluster.getInfo().sqlPort);
    } catch {
      /* HAProxy may still be rechecking */
    }
    await this.pushTopology();
  }

  private async handleAddHaAzNodes(): Promise<void> {
    this.panel.webview.postMessage({ type: 'addHaAzNodesStarted' });
    try {
      await this.cluster.addHaAzNodes();
    } catch (err: any) {
      this.panel.webview.postMessage({ type: 'error', message: err.message });
      this.panel.webview.postMessage({ type: 'addHaAzNodesComplete' });
      return;
    }
    try {
      await this.cluster.setReplicationFactor(5);
      this.panel.webview.postMessage({ type: 'movrLog', line: 'Set replication factor to 5 for MovR and user databases.' });
    } catch {
      /* zone config applies on the live nodes; topology still updates */
    }
    this.panel.webview.postMessage({ type: 'addHaAzNodesComplete' });
    this.panel.webview.postMessage({ type: 'reloadConsole' });
    try {
      await this.conn.connectLocal(this.cluster.getInfo().sqlPort);
    } catch {
      /* HAProxy may still be rechecking */
    }
    await this.pushTopology();
  }

  private extraHaNodeIds(): number[] {
    return this.latestNodes
      .filter((n) => {
        const host = extractContainerName(n.address);
        return host.startsWith('blast-node-') && !/^blast-node-[123]$/.test(host);
      })
      .map((n) => n.nodeId);
  }

  private async handleAddHaMultiRegion(): Promise<void> {
    this.panel.webview.postMessage({ type: 'addHaAzNodesStarted' });
    try {
      await this.cluster.addHaMultiRegionNodes();
    } catch (err: any) {
      this.panel.webview.postMessage({ type: 'error', message: err.message });
      this.panel.webview.postMessage({ type: 'addHaAzNodesComplete' });
      return;
    }
    try {
      await this.cluster.configureHaRegionSurvival((line) => {
        this.panel.webview.postMessage({ type: 'movrLog', line });
      });
    } catch (err: any) {
      this.panel.webview.postMessage({
        type: 'movrLog',
        line: `Could not set movr region survival: ${err.message}`,
      });
    }
    this.panel.webview.postMessage({ type: 'addHaAzNodesComplete' });
    this.panel.webview.postMessage({ type: 'reloadConsole' });
    try {
      await this.conn.connectLocal(this.cluster.getInfo().sqlPort);
    } catch {
      /* HAProxy may still be rechecking */
    }
    await this.pushTopology();
  }

  private async handleRemoveHaAzNodes(): Promise<void> {
    this.panel.webview.postMessage({ type: 'removeHaAzNodesStarted' });
    const extraIds = this.extraHaNodeIds();
    const progress = (message: string) => {
      this.panel.webview.postMessage({ type: 'haScaleProgress', message });
    };
    try {
      await this.cluster.removeHaAzNodes(extraIds, progress);
      for (const id of extraIds) this.livenessOverrides.delete(id);
    } catch (err: any) {
      this.panel.webview.postMessage({ type: 'error', message: err.message });
      this.panel.webview.postMessage({ type: 'removeHaAzNodesComplete' });
      return;
    }
    this.panel.webview.postMessage({ type: 'removeHaAzNodesComplete' });
    this.panel.webview.postMessage({ type: 'reloadConsole' });
    try {
      await this.conn.connectLocal(this.cluster.getInfo().sqlPort);
    } catch {
      /* HAProxy may still be rechecking */
    }
    await this.pushTopology();
  }

  private async afterMovrInit(): Promise<void> {
    this.panel.webview.postMessage({ type: 'movrStatus', state: 'initializing' });
    try {
      await this.cluster.analyzeMovrTables((line) => {
        this.panel.webview.postMessage({ type: 'movrLog', line });
      });
      await this.applyMovrReplicationIfScaled();
    } catch (err: any) {
      this.panel.webview.postMessage({
        type: 'movrLog',
        line: `ANALYZE skipped: ${err.message}`,
      });
    }
    this.panel.webview.postMessage({ type: 'movrStatus', state: 'ready' });
  }

  private async applyMovrReplicationIfScaled(): Promise<void> {
    if (this.demo() !== 'ha') return;
    try {
      const live = await this.cluster.liveNodeContainers();
      if (live.length >= 9) {
        await this.cluster.configureHaRegionSurvival((line) => {
          this.panel.webview.postMessage({ type: 'movrLog', line });
        });
        return;
      }
      if (live.length >= 6) {
        await this.cluster.setReplicationFactor(5);
        this.panel.webview.postMessage({
          type: 'movrLog',
          line: 'Set replication factor to 5 for MovR and user databases.',
        });
      }
    } catch {
      /* zone config may still be catching up */
    }
  }

  private async handleMovrInit(): Promise<void> {
    try {
      const container = await this.cluster.workloadHostContainer();
      const connStr = `'postgresql://root@blast-lb:26257?sslmode=disable'`;
      this.panel.webview.postMessage({ type: 'movrStatus', state: 'initializing' });
      this.movr.init(container, connStr);
    } catch (err: any) {
      this.panel.webview.postMessage({ type: 'movrStatus', state: 'error', message: err.message });
    }
  }

  private async handleMovrRun(duration: string, concurrency: string): Promise<void> {
    try {
      const container = await this.cluster.workloadHostContainer();
      const connStr = `'postgresql://root@blast-lb:26257?sslmode=disable'`;
      this.panel.webview.postMessage({ type: 'movrStatus', state: 'running' });
      this.movr.run(container, { '--duration': duration, '--concurrency': concurrency }, connStr);
    } catch (err: any) {
      this.panel.webview.postMessage({ type: 'movrStatus', state: 'error', message: err.message });
    }
  }

  private applyFocusTable(index: number): void {
    const step = this.playbook.steps[index];
    if (step?.focusTable) this.currentFocusTable = step.focusTable;
  }

  private async runStep(index: number): Promise<boolean> {
    const step = this.playbook.steps[index];
    if (!step || this.stepBusy) return false;
    this.stepBusy = true;
    this.applyFocusTable(index);
    let error: string | null = null;
    this.panel.webview.postMessage({ type: 'stepRunning', index });
    try {
      if (step.action === 'movr-init') {
        try {
          await this.runMovrInitStep();
        } catch (err: any) {
          error = String(err?.message ?? err);
          vscode.window.showErrorMessage(error);
        }
      } else if (step.action === 'movr-run') {
        this.workloadStats.reset();
        this.panel.webview.postMessage({ type: 'throughputReset' });
        try {
          await this.handleMovrRun('30m', '8');
        } catch (err: any) {
          error = String(err?.message ?? err);
          vscode.window.showErrorMessage(error);
        }
      } else if (step.action === 'mcp-prompt') {
        this.panel.webview.postMessage({ type: 'mcpSuggest', text: step.prompt ?? '' });
      } else if (step.action === 'upgrade-node' && step.node) {
        const nodeId = this.gossipIdForContainer(step.node);
        this.livenessOverrides.set(nodeId, false);
        this.panel.webview.postMessage({ type: 'stepRunning', index, nodeId });
        await this.pushTopology();
        try {
          await this.cluster.upgradeNode(step.node, (message) => {
            this.panel.webview.postMessage({ type: 'upgradeProgress', index, message });
          });
          this.livenessOverrides.set(nodeId, true);
        } catch (err: any) {
          const live = await this.cluster.liveNodeContainers().catch(() => [] as string[]);
          this.livenessOverrides.set(nodeId, live.includes(`blast-node-${step.node}`));
          error = String(err?.message ?? err);
          vscode.window.showErrorMessage(error);
        }
        await this.pushTopology();
      }
      const runSql = !step.action || step.action === 'upgrade-node';
      if (!error && runSql && step.sql.length > 0) {
        try {
          if (this.demo() === 'mcp') {
            await this.execMovrSql(step.sql);
            if (/drop\s+index/i.test(step.sql.join('\n'))) {
              this.panel.webview.postMessage({ type: 'indexEvent', kind: 'dropped' });
            } else if (/create\s+index/i.test(step.sql.join('\n'))) {
              this.panel.webview.postMessage({ type: 'indexEvent', kind: 'restored' });
            }
          }
          await this.sqlTerminal.sendSql(step.sql);
          if (step.snapshot === 'before') {
            void this.captureSnapshot();
          }
          error = await this.detectLicenseError(step.sql);
          if (error) vscode.window.showErrorMessage(error);
        } catch (err: any) {
          error = String(err?.message ?? err);
          vscode.window.showErrorMessage(error);
        }
      }
    } finally {
      this.stepBusy = false;
      this.panel.webview.postMessage({ type: 'stepRan', index, error });
    }
    return !error;
  }

  private async runMovrInitStep(): Promise<void> {
    const done = this.waitForMovrReady();
      try {
        await this.handleMovrInit();
      } catch (err) {
        done.cancel();
        void done.promise.catch(() => {});
        throw err;
      }
    await done.promise;
  }

  private waitForMovrReady(): { promise: Promise<void>; cancel: () => void } {
    let cancel = () => {};
    const promise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('MovR init timed out'));
      }, 180_000);
      const onStatus = (status: { state: string; message?: string }) => {
        if (status.state === 'ready') {
          cleanup();
          resolve();
        } else if (status.state === 'error') {
          cleanup();
          reject(new Error(status.message || 'MovR init failed'));
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.movr.off('status', onStatus);
      };
      cancel = () => {
        cleanup();
        reject(new Error('MovR init cancelled'));
      };
      this.movr.on('status', onStatus);
    });
    return { promise, cancel };
  }

  private async execMovrSql(statements: string[]): Promise<void> {
    const host = await this.cluster.firstLiveNodeContainer();
    const engine = this.cluster.getEngine();
    for (const statement of statements) {
      const sql = statement.trim();
      if (!sql || sql.startsWith('--')) continue;
      await engine.exec(
        host,
        ['cockroach', 'sql', '--insecure', '--database=movr', '-e', sql],
        180_000
      );
    }
  }

  /** Super regions need an enterprise license; surface that if the SQL will fail. */
  private async detectLicenseError(statements: string[]): Promise<string | null> {
    const needsLicense = statements.some((s) => /super\s+region/i.test(s));
    if (!needsLicense) return null;
    const ok = await this.ensureConnected();
    if (!ok) return null;
    const fromPlaybook = [
      ...new Set((this.playbook.superRegions ?? []).flatMap((sr) => sr.regions)),
    ];
    for (const region of fromPlaybook.length > 0 ? fromPlaybook : ['us-east', 'eu-west']) {
      try {
        await this.conn.query(`ALTER DATABASE app ADD REGION IF NOT EXISTS "${region}"`);
      } catch {
        /* step 1 may still be applying; terminal SQL will retry */
      }
    }
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
        if (/already exists|duplicate|does not exist|not found/i.test(msg)) return null;
        if (/license|enterprise|unimplemented|not.*enabled/i.test(msg)) {
          return `Super regions need an enterprise license. Set cockroachBlast.enterpriseLicense (and organization) in settings, then restart the cluster. ${msg}`;
        }
        return null;
      }
    }
    return null;
  }

  private async runAll(): Promise<void> {
    if (this.playbook.steps.some((step) => step.action)) {
      for (let i = 0; i < this.playbook.steps.length; i++) {
        const ok = await this.runStep(i);
        if (!ok) break;
      }
      this.panel.webview.postMessage({ type: 'allRan' });
      return;
    }
    const all = this.playbook.steps.flatMap((s) => s.sql);
    await this.sqlTerminal.sendSql(all);
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
    if (this.cluster.getInfo().state !== 'running') return false;
    if (this.conn.isConnected()) return true;
    try {
      await this.conn.connectLocal(this.cluster.getInfo().sqlPort);
      return true;
    } catch {
      return false;
    }
  }

  private applyLivenessOverrides(nodes: TopologyNode[]): TopologyNode[] {
    if (this.livenessOverrides.size === 0) return nodes;
    return nodes.map((n) => {
      const override = this.livenessOverrides.get(n.nodeId);
      return override === undefined ? n : { ...n, isLive: override };
    });
  }

  private async fetchTopology() {
    let raw = await queryNodes(this.conn);
    if (raw.length === 0) {
      try {
        await this.conn.connectLocal(this.cluster.getInfo().sqlPort);
        raw = await queryNodes(this.conn);
      } catch {
        /* keep empty; fall back to last snapshot below */
      }
    }
    const usedStale = raw.length === 0 && this.latestNodes.length > 0;
    if (usedStale) raw = this.latestNodes;
    for (const node of raw) {
      if (this.livenessOverrides.get(node.nodeId) === true && node.isLive) {
        this.livenessOverrides.delete(node.nodeId);
      }
    }
    let nodes = this.applyLivenessOverrides(raw);
    if (nodes.length > 0 && nodes.every((n) => !n.isLive) && this.latestNodes.some((n) => n.isLive)) {
      nodes = this.applyLivenessOverrides(this.latestNodes);
    }
    if (this.demo() === 'ha') {
      try {
        const names = new Set(await this.cluster.nodeContainerNames(true));
        if (names.size > 0) {
          nodes = nodes.filter((n) => names.has(extractContainerName(n.address)));
        }
      } catch {
        /* keep gossip list if the engine listing fails */
      }
    }
    this.latestNodes = nodes;
    if (this.demo() === 'upgrade') {
      const tags = await queryNodeBuildTags(this.conn);
      nodes = nodes.map((n) => ({ ...n, buildTag: tags[n.nodeId] }));
      this.latestNodes = nodes;
      return {
        nodes,
        ranges: [],
        byRegion: {},
        byTable: {},
        byTableHome: {},
        tableLocality: {},
        focusTable: '',
        clusterConnected: true,
      };
    }
    if (this.demo() === 'ha' || this.demo() === 'mcp') {
      return {
        nodes,
        ranges: [],
        byRegion: {},
        byTable: {},
        byTableHome: {},
        tableLocality: {},
        focusTable: '',
        clusterConnected: true,
      };
    }
    const ranges = await queryTableRanges(this.conn, this.currentFocusTable);
    const byRegion = replicaCountsByRegion(nodes, ranges);
    const byTable = await queryDemoTableCounts(this.conn, nodes);
    const tableLocality = await queryDemoTableLocality(this.conn);
    const byTableHome =
      tableLocality['app.customers'] === 'RBR'
        ? { 'app.customers': await queryCustomerHomeCounts(this.conn, nodes) }
        : {};
    return {
      nodes,
      ranges,
      byRegion,
      byTable,
      byTableHome,
      tableLocality,
      focusTable: this.currentFocusTable,
      superRegions: this.playbook.superRegions,
      superRegion: this.playbook.superRegion,
      clusterConnected: true,
    };
  }

  private async pushTopology(): Promise<void> {
    if (this.cluster.getInfo().state !== 'running') {
      const live = await this.cluster.liveNodeContainers();
      if (live.length === 0) this.panel.webview.postMessage({ type: 'disconnected' });
      return;
    }
    const publish = async () => {
      const data = await this.fetchTopology();
      if (data.nodes.length === 0) return false;
      this.panel.webview.postMessage({ type: 'topology', data, snapshotBefore: this.snapshotBefore });
      return true;
    };
    try {
      if (!this.conn.isConnected()) {
        await this.conn.connectLocal(this.cluster.getInfo().sqlPort);
      }
      if (await publish()) return;
    } catch {
      /* retry below */
    }
    try {
      await this.conn.connectLocal(this.cluster.getInfo().sqlPort);
      if (await publish()) return;
    } catch {
      /* keep last globe if any CRDB node is still up */
    }
    const live = await this.cluster.liveNodeContainers();
    if (live.length === 0) this.panel.webview.postMessage({ type: 'disconnected' });
  }

  private pushInit(): void {
    this.playbook = this.readPlaybook();
    this.currentFocusTable = this.playbook.focusTable || this.currentFocusTable;
    this.panel.webview.postMessage({
      type: 'init',
      demo: this.demo(),
      playbook: this.playbook,
      httpPort: this.cluster.getInfo().httpPort,
    });
    void this.mcpChat.pushKeyStatus();
  }

  dispose(): void {
    PresenterPanel.currentPanel = undefined;
    if (this.pollTimer) clearInterval(this.pollTimer);
    void this.mcpChat.dispose();
    this.movr.dispose();
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
