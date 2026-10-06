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
  action?: 'upgrade-node' | 'movr-init' | 'movr-run' | 'mcp-prompt';
  node?: number;
  prompt?: string;
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
