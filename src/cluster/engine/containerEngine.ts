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
  spawnExec(containerName: string, command: string[]): ChildProcess;
  writeContainerFile(containerName: string, destPath: string, contents: string): Promise<void>;
  ls(filters?: Record<string, string>, all?: boolean): Promise<ContainerInfo[]>;
  stop(containerName: string, timeoutSeconds?: number): Promise<void>;
  start(containerName: string): Promise<void>;
  rm(containerName: string): Promise<void>;
  inspectFormat(containerName: string, format: string): Promise<string>;
  logs(containerName: string): Promise<string>;
  signal(containerName: string, signal: string): Promise<void>;
  execTerminalArgs(containerName: string, command: string[]): { shellPath: string; shellArgs: string[] };
  composeUp(
    file: string,
    project: string,
    env?: Record<string, string>,
    services?: string[],
    profiles?: string[]
  ): Promise<string>;
  composeDown(file: string, project: string): Promise<string>;
  composeRun(
    file: string,
    project: string,
    service: string,
    env?: Record<string, string>,
    timeoutMs?: number
  ): Promise<string>;
  pull(image: string): Promise<void>;
}
