import * as fs from 'fs';
import * as path from 'path';

export interface SuperRegionDef {
  name: string;
  regions: string[];
}

export interface PlaybookStep {
  id: string;
  title: string;
  narration?: string;
  sql: string[];
  focusTable?: string;
  snapshot?: 'before' | 'after';
  action?: 'upgrade-node' | 'tpcc-load' | 'mcp-user' | 'tpcc-run' | 'note';
  node?: number;
}

export interface UpgradePlaybook {
  from: string;
  to: string;
  region: string;
}

export interface Playbook {
  id: string;
  title: string;
  cluster: { nodes: number; insecure: boolean };
  focusTable: string;
  superRegions?: SuperRegionDef[];
  superRegion?: SuperRegionDef;
  upgrade?: UpgradePlaybook;
  steps: PlaybookStep[];
}

export function loadPlaybook(extensionPath: string, fileName = 'gdpr-super-region-3region.json'): Playbook {
  const file = path.join(extensionPath, 'demos', fileName);
  const raw = fs.readFileSync(file, 'utf-8');
  return JSON.parse(raw) as Playbook;
}

export interface McpClientConfig {
  command: string;
  args: string[];
}

interface CursorMcpFile {
  mcpServers?: { cockroachdb?: { command?: string; args?: string[] } };
  blast?: { command?: string; args?: string[] };
}

/** Workspace `.cursor/mcp.json`, then the copy packaged with the extension. */
export function cursorMcpConfigPath(extensionPath: string, workspacePath?: string): string {
  const candidates = [
    workspacePath ? path.join(workspacePath, '.cursor', 'mcp.json') : '',
    path.join(extensionPath, '.cursor', 'mcp.json'),
    path.join(extensionPath, 'demos', 'mcp.json'),
  ].filter((candidate) => candidate.length > 0);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? path.join(extensionPath, '.cursor', 'mcp.json');
}

function readCursorMcp(file: string): CursorMcpFile {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as CursorMcpFile;
}

function asCommand(server: { command?: string; args?: string[] } | undefined, label: string): McpClientConfig {
  if (!server?.command || !Array.isArray(server.args) || server.args.length === 0) {
    throw new Error(`${label} has no command`);
  }
  return { command: server.command, args: server.args };
}

/** Command Cursor runs to attach to the MCP container. */
export function loadMcpClientConfig(extensionPath: string, workspacePath?: string): McpClientConfig {
  const file = cursorMcpConfigPath(extensionPath, workspacePath);
  return asCommand(readCursorMcp(file).mcpServers?.cockroachdb, file);
}

/** `podman run` that Start 3-node cluster uses to keep the MCP container up. */
export function loadMcpContainerLaunch(extensionPath: string, workspacePath?: string): McpClientConfig {
  const file = cursorMcpConfigPath(extensionPath, workspacePath);
  const launch = asCommand(readCursorMcp(file).blast, `${file} blast`);
  if (launch.args[0] !== 'run') {
    throw new Error(`${file} blast args must start with run`);
  }
  return launch;
}

export function mcpContainerName(args: string[]): string {
  const index = args.indexOf('--name');
  const name = index >= 0 ? args[index + 1] : '';
  if (!name) throw new Error('MCP container launch has no --name');
  return name;
}
