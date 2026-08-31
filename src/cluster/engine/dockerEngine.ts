import type { EngineId } from './containerEngine';
import { OciEngine } from './ociEngine';

export class DockerEngine extends OciEngine {
  readonly id: EngineId = 'docker';
  readonly displayName = 'Docker';

  constructor() {
    super('docker');
  }
}
