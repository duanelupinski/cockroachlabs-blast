import type { EngineId } from './containerEngine';
import { OciEngine } from './ociEngine';

export class PodmanEngine extends OciEngine {
  readonly id: EngineId = 'podman';
  readonly displayName = 'Podman';

  constructor() {
    super('podman');
  }
}
