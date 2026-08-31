import type { ChildProcess } from 'child_process';

export type EngineId = 'docker' | 'podman';

export interface ContainerInfo {
  name: string;
  status: string;
  image: string;
  id?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ContainerEngine {
  readonly id: EngineId;
  readonly displayName: string;
  exec(containerName: string, command: string[], timeoutMs?: number): Promise<string>;
  ls(filters?: Record<string, string>, all?: boolean): Promise<ContainerInfo[]>;
  execTerminalArgs(containerName: string, command: string[]): { shellPath: string; shellArgs: string[] };
  composeUp(file: string, project: string, env?: Record<string, string>): Promise<string>;
  composeDown(file: string, project: string): Promise<string>;
}
