import { execFileSync } from 'child_process';
import type { EngineId, ContainerEngine } from './containerEngine';
import { DockerEngine } from './dockerEngine';
import { PodmanEngine } from './podmanEngine';

const DETECTION_ORDER: { id: EngineId; binary: string }[] = [
  { id: 'docker', binary: 'docker' },
  { id: 'podman', binary: 'podman' },
];

export function isBinaryAvailable(binary: string): boolean {
  try {
    execFileSync(binary, ['--version'], { timeout: 3000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function detectEngine(): EngineId {
  for (const { id, binary } of DETECTION_ORDER) {
    if (isBinaryAvailable(binary)) return id;
  }
  return 'docker';
}

export type EngineSetting = 'auto' | 'docker' | 'podman';

export function createEngine(setting: EngineSetting = 'auto'): ContainerEngine {
  const id = setting === 'auto' ? detectEngine() : setting;
  return id === 'podman' ? new PodmanEngine() : new DockerEngine();
}
