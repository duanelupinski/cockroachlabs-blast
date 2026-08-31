import * as vscode from 'vscode';
import * as path from 'path';
import type { ContainerEngine } from './engine';
import { createEngine, type EngineSetting } from './engine';

export type ClusterState = 'stopped' | 'starting' | 'running' | 'stopping';

export interface ClusterInfo {
  nodes: number;
  state: ClusterState;
  version: string;
  engine: string;
  sqlPort: number;
  httpPort: number;
}

const PROJECT = 'blast-cluster';
const MANAGED_LABEL = 'managed-by=cockroach-blast';

export class ClusterManager {
  private state: ClusterState = 'stopped';
  private version: string;
  private readonly engine: ContainerEngine;
  private readonly composeFile: string;
  private readonly onStateChangedEmitter = new vscode.EventEmitter<ClusterInfo>();
  readonly onStateChanged = this.onStateChangedEmitter.event;

  constructor(extensionPath: string, engine?: ContainerEngine) {
    const cfg = vscode.workspace.getConfiguration('cockroachBlast');
    const setting = (cfg.get<string>('containerEngine') ?? 'auto') as EngineSetting;
    this.engine = engine ?? createEngine(setting);
    this.version = cfg.get<string>('cluster.defaultVersion') ?? 'v26.1.5';
    this.composeFile = path.join(extensionPath, 'deployments', 'docker-compose.yml');
  }

  getEngine(): ContainerEngine {
    return this.engine;
  }

  getInfo(): ClusterInfo {
    return {
      nodes: this.state === 'stopped' ? 0 : 9,
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

  async refreshFromRuntime(): Promise<void> {
    try {
      const containers = await this.engine.ls({ label: MANAGED_LABEL });
      const nodes = containers.filter((c) => c.name.startsWith('blast-node-'));
      this.state = nodes.length >= 3 ? 'running' : 'stopped';
    } catch {
      this.state = 'stopped';
    }
    this.fire();
  }

  async createCluster(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') {
      vscode.window.showInformationMessage('A Blast cluster is already running or starting.');
      return;
    }
    this.state = 'starting';
    this.fire();
    try {
      await this.engine.composeUp(this.composeFile, PROJECT, { CRDB_VERSION: this.version });
      this.state = 'running';
      this.fire();
      vscode.window.showInformationMessage(
        `9-node insecure CockroachDB cluster started (${this.engine.displayName}, ${this.version}).`
      );
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
    try {
      await this.engine.composeDown(this.composeFile, PROJECT);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to destroy cluster: ${err.message}`);
    }
    this.state = 'stopped';
    this.fire();
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
