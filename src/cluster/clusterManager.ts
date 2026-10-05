import * as vscode from 'vscode';
import * as path from 'path';
import type { ContainerEngine } from './engine';
import { createEngine, type EngineSetting } from './engine';

export type ClusterState = 'stopped' | 'starting' | 'running' | 'stopping';
export type DemoId = 'multi-region' | 'table-locality' | 'ha' | 'upgrade' | 'mcp';

/** Rolling upgrade: v25.4 Regular release → v26.2 Regular release. */
export const UPGRADE_SOURCE_VERSION = 'v25.4.17';
export const UPGRADE_TARGET_VERSION = 'v26.2.7';

export interface ClusterInfo {
  demo: DemoId;
  nodes: number;
  expectedNodes: number;
  state: ClusterState;
  version: string;
  engine: string;
  sqlPort: number;
  httpPort: number;
}

const PROJECT = 'blast-cluster';
const MANAGED_LABEL = 'managed-by=cockroach-blast';
const HA_DEMO_LABEL = 'blast-demo=ha';
const MR_DEMO_LABEL = 'blast-demo=multi-region';
const TABLE_LOCALITY_DEMO_LABEL = 'blast-demo=table-locality';
const UPGRADE_DEMO_LABEL = 'blast-demo=upgrade';
const MCP_DEMO_LABEL = 'blast-demo=mcp';
const UPGRADE_SQL_CONTAINER = 'blast-sql';
const HA_SCALE_OUT_NODES = ['blast-node-4', 'blast-node-5', 'blast-node-6'];
const HA_MULTI_REGION_NODES = [
  'blast-node-7',
  'blast-node-8',
  'blast-node-9',
  'blast-node-10',
  'blast-node-11',
  'blast-node-12',
];
const HA_EXTRA_NODES = [...HA_SCALE_OUT_NODES, ...HA_MULTI_REGION_NODES];
const HA_CORE_NODES = ['blast-node-1', 'blast-node-2', 'blast-node-3'];
const NODE_COUNT: Record<DemoId, number> = {
  'multi-region': 6,
  'table-locality': 9,
  ha: 3,
  upgrade: 3,
  mcp: 3,
};

const COMPOSE_FILE: Record<DemoId, string> = {
  'multi-region': 'docker-compose.yml',
  'table-locality': 'docker-compose-table-locality.yml',
  ha: 'docker-compose-ha.yml',
  upgrade: 'docker-compose-upgrade.yml',
  mcp: 'docker-compose-mcp.yml',
};

const DEMO_ORDER: DemoId[] = ['table-locality', 'multi-region', 'ha', 'upgrade', 'mcp'];

export function extractContainerName(address: string): string {
  return address.split(':')[0] ?? address;
}

export class ClusterManager {
  private state: ClusterState = 'stopped';
  private activeDemo: DemoId = 'multi-region';
  private version: string;
  private readonly engine: ContainerEngine;
  private readonly extensionPath: string;
  private readonly onStateChangedEmitter = new vscode.EventEmitter<ClusterInfo>();
  readonly onStateChanged = this.onStateChangedEmitter.event;

  constructor(extensionPath: string, engine?: ContainerEngine) {
    const cfg = vscode.workspace.getConfiguration('cockroachBlast');
    const setting = (cfg.get<string>('containerEngine') ?? 'auto') as EngineSetting;
    this.engine = engine ?? createEngine(setting);
    this.version = cfg.get<string>('cluster.defaultVersion') ?? 'v26.1.5';
    this.extensionPath = extensionPath;
  }

  getEngine(): ContainerEngine {
    return this.engine;
  }

  getDemo(): DemoId {
    return this.activeDemo;
  }

  getInfo(): ClusterInfo {
    const expected = NODE_COUNT[this.activeDemo];
    return {
      demo: this.activeDemo,
      nodes: this.state === 'stopped' ? 0 : expected,
      expectedNodes: expected,
      state: this.state,
      version: this.version,
      engine: this.engine.displayName,
      sqlPort: 26257,
      httpPort: 8080,
    };
  }

  setVersion(tag: string): void {
    this.version = tag;
    this.fire();
  }

  getVersion(): string {
    return this.version;
  }

  getActiveNodeContainerName(nodeId = 1): string {
    return `blast-node-${nodeId}`;
  }

  composePath(demo: DemoId): string {
    return path.join(this.extensionPath, 'deployments', COMPOSE_FILE[demo]);
  }

  private composeEnv(demo: DemoId, upgradeTags?: Record<number, string>): Record<string, string> {
    if (demo !== 'upgrade') return { CRDB_VERSION: this.version };
    const tags = upgradeTags ?? {
      1: UPGRADE_SOURCE_VERSION,
      2: UPGRADE_SOURCE_VERSION,
      3: UPGRADE_SOURCE_VERSION,
    };
    return {
      CRDB_VERSION_1: tags[1] ?? UPGRADE_SOURCE_VERSION,
      CRDB_VERSION_2: tags[2] ?? UPGRADE_SOURCE_VERSION,
      CRDB_VERSION_3: tags[3] ?? UPGRADE_SOURCE_VERSION,
    };
  }

  async refreshFromRuntime(): Promise<void> {
    try {
      const upgradeNodes = (await this.engine.ls({ label: UPGRADE_DEMO_LABEL }, true)).filter((c) =>
        c.name.startsWith('blast-node-')
      );
      const mcpNodes = (await this.engine.ls({ label: MCP_DEMO_LABEL }, true)).filter((c) =>
        c.name.startsWith('blast-node-')
      );
      const haNodes = (await this.engine.ls({ label: HA_DEMO_LABEL }, true)).filter((c) =>
        c.name.startsWith('blast-node-')
      );
      const localityNodes = (await this.engine.ls({ label: TABLE_LOCALITY_DEMO_LABEL }, true)).filter((c) =>
        c.name.startsWith('blast-node-')
      );
      const mrNodes = (await this.engine.ls({ label: MR_DEMO_LABEL }, true)).filter((c) =>
        c.name.startsWith('blast-node-')
      );
      let nodes = haNodes;
      if (upgradeNodes.length > 0) {
        this.activeDemo = 'upgrade';
        nodes = upgradeNodes;
      } else if (mcpNodes.length > 0) {
        this.activeDemo = 'mcp';
        nodes = mcpNodes;
      } else if (haNodes.length > 0) {
        this.activeDemo = 'ha';
      } else if (localityNodes.length > 0) {
        this.activeDemo = 'table-locality';
        nodes = localityNodes;
      } else if (mrNodes.length > 0) {
        this.activeDemo = 'multi-region';
        nodes = mrNodes;
      } else {
        nodes = (await this.engine.ls({ label: MANAGED_LABEL }, true)).filter((c) =>
          c.name.startsWith('blast-node-')
        );
        if (nodes.some((c) => /blast-node-[456]$/.test(c.name))) {
          this.activeDemo = 'multi-region';
        } else if (nodes.length > 0) {
          this.activeDemo = 'ha';
        }
      }
      this.state = nodes.some((c) => /up/i.test(c.status)) ? 'running' : 'stopped';
    } catch {
      this.state = 'stopped';
    }
    this.fire();
  }

  async createCluster(demo: DemoId = 'multi-region'): Promise<void> {
    if ((this.state === 'running' || this.state === 'starting') && this.activeDemo === demo) {
      vscode.window.showInformationMessage('A Blast cluster is already running or starting.');
      return;
    }
    if (this.state === 'running' || this.state === 'starting' || this.state === 'stopping') {
      await this.destroyCluster();
    }
    this.activeDemo = demo;
    this.state = 'starting';
    this.fire();
    try {
      if (demo === 'upgrade') {
        // Stores stay on named volumes. A previous run may have finalized onto v26.2,
        // and v25.4 refuses to open those stores. Start always means a fresh v25.4 cluster.
        try {
          await this.engine.composeDown(this.composePath('upgrade'), PROJECT);
        } catch {
          /* no previous upgrade project */
        }
        await this.engine.pull(`cockroachdb/cockroach:${UPGRADE_SOURCE_VERSION}`);
        await this.engine.pull(`cockroachdb/cockroach:${UPGRADE_TARGET_VERSION}`);
      }
      await this.engine.composeUp(this.composePath(demo), PROJECT, this.composeEnv(demo));
      await this.waitUntilSqlReady();
      if (demo === 'mcp') {
        try {
          await this.engine.pull('mcp/cockroachdb');
        } catch (err: any) {
          vscode.window.showWarningMessage(
            `Could not pull mcp/cockroachdb yet. The chat will try again when you send a question. ${err.message}`
          );
        }
      }
      this.state = 'running';
      this.fire();
      const label =
        demo === 'ha'
          ? `3-node HA insecure CockroachDB cluster started (${this.engine.displayName}, ${this.version}).`
          : demo === 'upgrade'
            ? `3-node us-west cluster started on ${UPGRADE_SOURCE_VERSION} (${this.engine.displayName}).`
            : demo === 'table-locality'
              ? `9-node table-locality cluster started (${this.engine.displayName}, ${this.version}).`
              : demo === 'mcp'
                ? `3-node MCP demo cluster started (${this.engine.displayName}, ${this.version}).`
                : `6-node multi-region insecure CockroachDB cluster started (${this.engine.displayName}, ${this.version}).`;
      vscode.window.showInformationMessage(label);
    } catch (err: any) {
      this.state = 'stopped';
      this.fire();
      vscode.window.showErrorMessage(`Failed to start cluster: ${err.message}`);
      throw err;
    }
  }

  async destroyCluster(): Promise<void> {
    if (this.state === 'stopped') {
      vscode.window.showInformationMessage('No cluster is running.');
      return;
    }
    this.state = 'stopping';
    this.fire();
    const demos = [this.activeDemo, ...DEMO_ORDER.filter((demo) => demo !== this.activeDemo)];
    for (const demo of demos) {
      try {
        await this.engine.composeDown(this.composePath(demo), PROJECT);
      } catch (err: any) {
        if (demo === this.activeDemo) {
          vscode.window.showErrorMessage(`Failed to destroy cluster: ${err.message}`);
        }
      }
    }
    this.state = 'stopped';
    this.fire();
  }

  async stopNode(containerName: string): Promise<void> {
    await this.engine.stop(containerName);
    await this.reloadLoadBalancer();
  }

  async startNode(containerName: string): Promise<void> {
    await this.engine.start(containerName);
    await this.waitUntilNodeHealthy(containerName, 25_000);
    await this.reloadLoadBalancer();
  }

  /** Drain one us-west node and recreate it on the v26.2 image, keeping its store. */
  async upgradeNode(nodeNumber: number, onProgress?: (message: string) => void): Promise<void> {
    if (this.activeDemo !== 'upgrade' || this.state !== 'running') {
      throw new Error('Start the 3-node us-west cluster before upgrading a node.');
    }
    if (nodeNumber < 1 || nodeNumber > 3) {
      throw new Error(`Upgrade node ${nodeNumber} is not part of the 3-node cluster.`);
    }
    const name = `blast-node-${nodeNumber}`;
    onProgress?.(`Draining ${name}…`);
    try {
      await this.engine.exec(
        name,
        ['cockroach', 'node', 'drain', '--insecure', '--host=127.0.0.1:26257'],
        60_000
      );
    } catch {
      /* node may already be stopping */
    }
    onProgress?.(`Restarting ${name} on ${UPGRADE_TARGET_VERSION}…`);
    try {
      await this.engine.stop(name, 20);
    } catch {
      /* drain may have already stopped the process */
    }
    const tags = await this.upgradeImageTags();
    tags[nodeNumber] = UPGRADE_TARGET_VERSION;
    onProgress?.(`Pulling cockroachdb/cockroach:${UPGRADE_TARGET_VERSION}…`);
    await this.engine.pull(`cockroachdb/cockroach:${UPGRADE_TARGET_VERSION}`);
    await this.engine.composeUp(this.composePath('upgrade'), PROJECT, this.composeEnv('upgrade', tags), [name]);
    onProgress?.(`Waiting for ${name} to rejoin…`);
    await this.waitUntilNodeHealthy(name, 90_000);
    await this.reloadLoadBalancer();
    onProgress?.(`${name} is live on ${UPGRADE_TARGET_VERSION}.`);
  }

  async sqlShell(): Promise<{ container: string; host?: string }> {
    if (this.activeDemo === 'upgrade') {
      const containers = await this.engine.ls({ name: UPGRADE_SQL_CONTAINER }, true);
      const found = containers.find((c) => c.name === UPGRADE_SQL_CONTAINER);
      if (!found) {
        throw new Error('Upgrade SQL sidecar is not running. Start the us-west cluster again.');
      }
      if (!/up/i.test(found.status)) await this.engine.start(UPGRADE_SQL_CONTAINER);
      return { container: UPGRADE_SQL_CONTAINER, host: 'blast-lb:26257' };
    }
    return { container: await this.firstLiveNodeContainer() };
  }

  private async upgradeImageTags(): Promise<Record<number, string>> {
    const tags: Record<number, string> = {
      1: UPGRADE_SOURCE_VERSION,
      2: UPGRADE_SOURCE_VERSION,
      3: UPGRADE_SOURCE_VERSION,
    };
    const containers = await this.engine.ls({ label: UPGRADE_DEMO_LABEL }, true);
    for (const container of containers) {
      const match = /^blast-node-([123])$/.exec(container.name);
      if (!match || !container.image) continue;
      const tag = container.image.slice(container.image.lastIndexOf(':') + 1);
      if (tag.startsWith('v')) tags[Number(match[1])] = tag;
    }
    return tags;
  }

  async addHaAzNodes(): Promise<void> {
    if (this.activeDemo !== 'ha' || this.state !== 'running') {
      throw new Error('Start the 3-node HA cluster before adding nodes.');
    }
    await this.engine.composeUp(
      this.composePath('ha'),
      PROJECT,
      { CRDB_VERSION: this.version, COMPOSE_PROFILES: 'scale-out' },
      HA_SCALE_OUT_NODES,
      ['scale-out']
    );
    const deadline = Date.now() + 90_000;
    for (const name of HA_SCALE_OUT_NODES) {
      const remaining = Math.max(5_000, deadline - Date.now());
      await this.waitUntilNodeHealthy(name, remaining);
    }
    await this.reloadLoadBalancer();
  }

  async addHaMultiRegionNodes(): Promise<void> {
    if (this.activeDemo !== 'ha' || this.state !== 'running') {
      throw new Error('Start the 3-node HA cluster before expanding to multi-region.');
    }
    await this.engine.composeUp(
      this.composePath('ha'),
      PROJECT,
      { CRDB_VERSION: this.version, COMPOSE_PROFILES: 'multi-region' },
      HA_MULTI_REGION_NODES,
      ['multi-region']
    );
    const deadline = Date.now() + 150_000;
    for (const name of HA_MULTI_REGION_NODES) {
      const remaining = Math.max(5_000, deadline - Date.now());
      await this.waitUntilNodeHealthy(name, remaining);
    }
    await this.reloadLoadBalancer();
  }

  async setReplicationFactor(replicas: 3 | 5 | 9): Promise<void> {
    const host = await this.firstLiveCoreHaNode().catch(() => this.firstLiveNodeContainer());
    await this.execSql(host, `ALTER RANGE default CONFIGURE ZONE USING num_replicas = ${replicas}`);
    const dbs = await this.listUserDatabases(host);
    for (const db of dbs) {
      const ident = `"${db.replace(/"/g, '""')}"`;
      try {
        await this.execSql(host, `ALTER DATABASE ${ident} CONFIGURE ZONE USING num_replicas = ${replicas}`);
      } catch {
        /* database may not exist yet */
      }
    }
  }

  async configureHaRegionSurvival(onProgress?: (message: string) => void): Promise<boolean> {
    const host = await this.firstLiveCoreHaNode();
    onProgress?.('Waiting for cluster regions us-east, us-west, and eu-west…');
    await this.waitForClusterRegions(host, ['us-east', 'us-west', 'eu-west'], 90_000);
    const dbs = await this.listUserDatabases(host);
    if (!dbs.includes('movr')) {
      onProgress?.('MovR is not initialized yet. Init will set PRIMARY REGION and SURVIVE REGION FAILURE.');
      return false;
    }
    const statements = [
      'ALTER DATABASE movr SET PRIMARY REGION "us-east"',
      'ALTER DATABASE movr ADD REGION IF NOT EXISTS "us-west"',
      'ALTER DATABASE movr ADD REGION IF NOT EXISTS "eu-west"',
      'ALTER DATABASE movr SURVIVE REGION FAILURE',
    ];
    for (const sql of statements) {
      onProgress?.(`${sql};`);
      try {
        await this.execSql(host, sql, 120_000);
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (/already has a primary region|already exists|already a region/i.test(msg)) {
          continue;
        }
        throw err;
      }
    }
    try {
      const goal = await this.execSql(host, 'SHOW SURVIVAL GOAL FROM DATABASE movr');
      onProgress?.(goal.trim() || 'movr survival goal updated.');
    } catch {
      /* SHOW is best-effort for the presenter log */
    }
    return true;
  }

  async analyzeMovrTables(onProgress?: (message: string) => void): Promise<void> {
    const host = await this.firstLiveCoreHaNode().catch(() => this.firstLiveNodeContainer());
    const tables = await this.listMovrTables(host);
    if (tables.length === 0) {
      onProgress?.('No MovR tables found to ANALYZE.');
      return;
    }
    onProgress?.(`ANALYZE ${tables.length} MovR table${tables.length === 1 ? '' : 's'}…`);
    for (const table of tables) {
      const ident = table.replace(/"/g, '""');
      const sql = `ANALYZE movr."${ident}"`;
      onProgress?.(`${sql};`);
      await this.execSql(host, sql, 60_000);
    }
  }

  private async listMovrTables(host: string): Promise<string[]> {
    const fallback = [
      'users',
      'vehicles',
      'rides',
      'vehicle_location_histories',
      'promo_codes',
      'user_promo_codes',
    ];
    try {
      const out = await this.execSql(
        host,
        `SELECT table_name
         FROM movr.information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`
      );
      const names = out
        .split('\n')
        .map((line) => line.trim().replace(/^"|"$/g, ''))
        .filter((name) => name && name !== 'table_name');
      return names.length > 0 ? names : fallback;
    } catch {
      return fallback;
    }
  }

  async clearHaRegionSurvival(onProgress?: (message: string) => void): Promise<void> {
    const host = await this.firstLiveCoreHaNode().catch(() => this.firstLiveNodeContainer());
    const dbs = await this.listUserDatabases(host);
    if (!dbs.includes('movr')) return;
    onProgress?.('Reverting movr to zone failure survival…');
    const statements = [
      'ALTER DATABASE movr SURVIVE ZONE FAILURE',
      'ALTER DATABASE movr DROP REGION "us-west"',
      'ALTER DATABASE movr DROP REGION "eu-west"',
      'ALTER DATABASE movr DROP REGION "us-east"',
    ];
    for (const sql of statements) {
      onProgress?.(`${sql};`);
      try {
        await this.execSql(host, sql, 120_000);
      } catch {
        /* region or survival goal may already be gone */
      }
    }
  }

  private async waitForClusterRegions(
    host: string,
    required: string[],
    timeoutMs: number
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < deadline) {
      try {
        const out = await this.execSql(host, 'SELECT region FROM [SHOW REGIONS FROM CLUSTER]');
        last = out;
        const seen = new Set(
          out
            .split('\n')
            .map((line) => line.trim().replace(/^"|"$/g, ''))
            .filter((name) => name && name !== 'region')
        );
        if (required.every((region) => seen.has(region))) return;
      } catch (err: any) {
        last = String(err?.message ?? err);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Cluster regions ${required.join(', ')} not ready: ${last}`);
  }

  async removeHaAzNodes(extraNodeIds: number[], onProgress?: (message: string) => void): Promise<void> {
    if (this.activeDemo !== 'ha' || this.state !== 'running') {
      throw new Error('Start the HA cluster before scaling down.');
    }
    const host = await this.firstLiveCoreHaNode();
    onProgress?.('Starting extra nodes so they can drain…');
    await this.startExtraHaNodes();
    try {
      await this.clearHaRegionSurvival(onProgress);
      onProgress?.('Setting replication factor to 3…');
      await this.setReplicationFactor(3);
      await this.waitForUserReplicaCount(host, 3, 90_000);
    } catch {
      /* still decommission extra nodes so the button is not a no-op */
    }
    onProgress?.('Decommissioning extra nodes…');
    try {
      let ids = [...new Set(extraNodeIds)].filter((id) => Number.isFinite(id) && id > 0);
      if (ids.length === 0) {
        ids = await this.queryScaleOutNodeIds(host);
      }
      await this.decommissionNodes(host, ids, onProgress);
      await this.drainExtraHaNodes();
    } finally {
      onProgress?.('Removing extra nodes…');
      await this.destroyScaleOutContainers();
      await this.reloadLoadBalancer();
    }
  }

  private async startExtraHaNodes(): Promise<void> {
    for (const name of HA_EXTRA_NODES) {
      try {
        await this.engine.start(name);
      } catch {
        /* container may already be running or absent */
      }
    }
  }

  private async drainExtraHaNodes(): Promise<void> {
    for (const name of HA_EXTRA_NODES) {
      try {
        await this.engine.exec(
          name,
          ['cockroach', 'node', 'drain', '--insecure', '--host=127.0.0.1:26257'],
          45_000
        );
      } catch {
        /* node may already be down */
      }
    }
  }

  private async decommissionNodes(
    host: string,
    ids: number[],
    onProgress?: (message: string) => void
  ): Promise<void> {
    if (ids.length === 0) return;
    const attempts: Array<{ port: number; skip: boolean; timeoutMs: number }> = [
      { port: 26357, skip: false, timeoutMs: 120_000 },
      { port: 26257, skip: false, timeoutMs: 120_000 },
      { port: 26357, skip: true, timeoutMs: 90_000 },
      { port: 26257, skip: true, timeoutMs: 90_000 },
    ];
    for (const attempt of attempts) {
      try {
        await this.engine.exec(
          host,
          [
            'cockroach',
            'node',
            'decommission',
            ...ids.map(String),
            '--insecure',
            `--host=127.0.0.1:${attempt.port}`,
            '--wait=all',
            ...(attempt.skip ? ['--checks=skip'] : []),
          ],
          attempt.timeoutMs
        );
        break;
      } catch {
        /* try SQL port / skip checks */
      }
    }
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const remaining = await this.activeMembershipIds(host, ids);
      if (remaining.length === 0) {
        onProgress?.('Extra nodes decommissioned.');
        return;
      }
      onProgress?.(
        `Waiting for decommission (${remaining.length} node${remaining.length === 1 ? '' : 's'} left)…`
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  private async activeMembershipIds(host: string, ids: number[]): Promise<number[]> {
    if (ids.length === 0) return [];
    try {
      const list = ids.join(',');
      const out = await this.execSql(
        host,
        `SELECT node_id, membership::string FROM crdb_internal.gossip_liveness WHERE node_id IN (${list})`
      );
      const membership = new Map<number, string>();
      for (const line of out.split('\n')) {
        const [idRaw, rawMembership] = line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
        if (!idRaw || idRaw === 'node_id') continue;
        const id = Number(idRaw);
        if (!ids.includes(id)) continue;
        membership.set(id, (rawMembership ?? '').toLowerCase());
      }
      return ids.filter((id) => {
        const status = membership.get(id);
        if (status === undefined) return false;
        return status !== 'decommissioned';
      });
    } catch {
      return ids;
    }
  }

  private async destroyScaleOutContainers(): Promise<void> {
    for (const name of HA_EXTRA_NODES) {
      try {
        await this.engine.rm(name);
      } catch {
        try {
          await this.engine.stop(name, 3);
          await this.engine.rm(name);
        } catch {
          /* already gone */
        }
      }
    }
  }

  private async execSql(host: string, sql: string, timeoutMs = 20_000): Promise<string> {
    return this.engine.exec(
      host,
      ['cockroach', 'sql', '--insecure', '--host=127.0.0.1:26257', '--format=csv', '-e', sql],
      timeoutMs
    );
  }

  private async listUserDatabases(host: string): Promise<string[]> {
    try {
      const out = await this.execSql(
        host,
        "SELECT name FROM crdb_internal.databases WHERE name NOT IN ('system', 'postgres')"
      );
      return out
        .split('\n')
        .map((line) => line.trim().replace(/^"|"$/g, ''))
        .filter((name) => name && name !== 'name' && name !== 'system' && name !== 'postgres');
    } catch {
      return ['movr', 'defaultdb'];
    }
  }

  private async waitForUserReplicaCount(host: string, maxReplicas: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const out = await this.execSql(
          host,
          `SELECT coalesce(max(array_length(replicas, 1)), 0)
           FROM crdb_internal.ranges_no_leases
           WHERE coalesce(database_name, '') NOT IN ('system', '')`
        );
        const nums = out
          .split('\n')
          .map((line) => Number(line.trim()))
          .filter((n) => Number.isFinite(n));
        const last = nums[nums.length - 1] ?? 0;
        if (last <= maxReplicas) return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  async nodeContainerNames(all = true): Promise<string[]> {
    const containers = await this.engine.ls({ label: MANAGED_LABEL }, all);
    return containers.filter((c) => c.name.startsWith('blast-node-')).map((c) => c.name);
  }

  private async firstLiveCoreHaNode(): Promise<string> {
    const live = await this.liveNodeContainers();
    const core = live.find((name) => HA_CORE_NODES.includes(name));
    if (!core) {
      throw new Error('Keep at least one of n1–n3 running to scale back to three nodes.');
    }
    return core;
  }

  private async queryScaleOutNodeIds(host: string): Promise<number[]> {
    try {
      const out = await this.execSql(
        host,
        "SELECT node_id FROM crdb_internal.gossip_nodes WHERE split_part(address, ':', 1) IN ('blast-node-4','blast-node-5','blast-node-6','blast-node-7','blast-node-8','blast-node-9','blast-node-10','blast-node-11','blast-node-12')"
      );
      return out
        .split('\n')
        .map((line) => Number(line.trim()))
        .filter((id) => Number.isFinite(id) && id > 0);
    } catch {
      return [];
    }
  }

  async reloadLoadBalancer(): Promise<void> {
    try {
      await this.engine.signal('blast-lb', 'HUP');
    } catch {
      /* lb may still be starting */
    }
  }

  async liveNodeContainers(): Promise<string[]> {
    const containers = await this.engine.ls({ label: MANAGED_LABEL });
    return containers
      .filter((c) => c.name.startsWith('blast-node-') && /up/i.test(c.status))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => c.name);
  }

  async firstLiveNodeContainer(): Promise<string> {
    const live = await this.liveNodeContainers();
    if (live.length === 0) {
      throw new Error('No live CockroachDB node container.');
    }
    return live[0];
  }

  /** Host MovR in blast-workload so killing any CRDB node does not stop docker exec. */
  async workloadHostContainer(): Promise<string> {
    const name = 'blast-workload';
    const containers = await this.engine.ls({ label: MANAGED_LABEL }, true);
    const found = containers.find((c) => c.name === name);
    if (found && /up/i.test(found.status)) return name;
    if (found) {
      await this.engine.start(name);
      return name;
    }
    const demo =
      this.activeDemo === 'upgrade' || this.activeDemo === 'mcp' || this.activeDemo === 'ha'
        ? this.activeDemo
        : 'ha';
    const env =
      demo === 'upgrade' ? this.composeEnv('upgrade') : { CRDB_VERSION: this.version };
    await this.engine.composeUp(this.composePath(demo), PROJECT, env, ['blast-workload']);
    return name;
  }

  async isNodeRunning(nodeId = 1): Promise<boolean> {
    try {
      const name = this.getActiveNodeContainerName(nodeId);
      const containers = await this.engine.ls({ name });
      return containers.some((c) => c.name === name);
    } catch {
      return false;
    }
  }

  private async waitUntilNodeHealthy(containerName: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = 'health check failed';
    while (Date.now() < deadline) {
      try {
        await this.engine.exec(containerName, ['curl', '-sf', 'http://localhost:8080/health'], 3_000);
        return;
      } catch (err: any) {
        lastError = String(err?.message ?? err);
        try {
          await this.engine.exec(
            containerName,
            ['cockroach', 'sql', '--insecure', '-e', 'SELECT 1'],
            8_000
          );
          return;
        } catch (sqlErr: any) {
          lastError = String(sqlErr?.message ?? sqlErr);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new Error(`${containerName} did not become healthy: ${lastError}`);
  }

  async waitUntilSqlReady(timeoutMs = 90_000): Promise<void> {
    const name = this.getActiveNodeContainerName(1);
    const started = Date.now();
    let lastError = 'SQL not ready';
    while (Date.now() - started < timeoutMs) {
      try {
        await this.engine.exec(name, ['cockroach', 'sql', '--insecure', '-e', 'SELECT 1;'], 8_000);
        return;
      } catch (err: any) {
        lastError = String(err?.message ?? err);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    throw new Error(`Cluster containers started, but SQL is not ready: ${lastError}`);
  }

  async applyDemoSettings(execSql: (sql: string) => Promise<void>): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('cockroachBlast');
    const license = (cfg.get<string>('enterpriseLicense') ?? '').trim();
    const org = (cfg.get<string>('cluster.organization') ?? '').trim();
    try {
      await execSql(`SET CLUSTER SETTING kv.allocator.load_based_rebalancing = 'leases and replicas'`);
    } catch {
      /* ignore */
    }
    try {
      await execSql(`SET CLUSTER SETTING kv.snapshot_rebalance.max_rate = '128MiB'`);
    } catch {
      /* ignore */
    }
    if (this.activeDemo === 'ha') {
      try {
        await execSql(`SET CLUSTER SETTING server.time_until_store_dead = '1m15s'`);
      } catch {
        /* ignore */
      }
    }
    if (org) {
      try {
        await execSql(`SET CLUSTER SETTING cluster.organization = '${org.replace(/'/g, "''")}'`);
      } catch {
        /* ignore */
      }
    }
    if (license) {
      try {
        await execSql(`SET CLUSTER SETTING enterprise.license = '${license.replace(/'/g, "''")}'`);
      } catch (err: any) {
        vscode.window.showWarningMessage(`Could not apply enterprise license: ${err.message}`);
      }
    }
  }

  private fire(): void {
    this.onStateChangedEmitter.fire(this.getInfo());
  }

  dispose(): void {
    this.onStateChangedEmitter.dispose();
  }
}
