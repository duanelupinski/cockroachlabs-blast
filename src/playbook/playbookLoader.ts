import * as fs from 'fs';
import * as path from 'path';

export interface PlaybookStep {
  id: string;
  title: string;
  narration?: string;
  sql: string[];
  snapshot?: 'before' | 'after';
}

export interface Playbook {
  id: string;
  title: string;
  cluster: { nodes: number; insecure: boolean };
  focusTable: string;
  superRegion?: { name: string; regions: string[] };
  steps: PlaybookStep[];
}

export function loadPlaybook(extensionPath: string, fileName = 'gdpr-super-region.json'): Playbook {
  const file = path.join(extensionPath, 'demos', fileName);
  const raw = fs.readFileSync(file, 'utf-8');
  return JSON.parse(raw) as Playbook;
}
