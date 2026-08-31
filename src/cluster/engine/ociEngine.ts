import { execFile } from 'child_process';
import type { ContainerEngine, EngineId, ContainerInfo } from './containerEngine';

export abstract class OciEngine implements ContainerEngine {
  abstract readonly id: EngineId;
  abstract readonly displayName: string;

  constructor(protected readonly binary: string) {}

  async exec(containerName: string, command: string[], timeoutMs = 120_000): Promise<string> {
    return this.execBinary(['exec', containerName, ...command], timeoutMs);
  }

  async ls(filters?: Record<string, string>, all = false): Promise<ContainerInfo[]> {
    const args = ['ps'];
    if (all) args.push('-a');
    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        args.push('--filter', `${k}=${v}`);
      }
    }
    args.push('--format', '{{.Names}}\t{{.Status}}\t{{.Image}}\t{{.ID}}');
    const out = await this.execBinary(args, 8_000);
    return out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, status, image, id] = line.split('\t');
        return { name, status, image, id };
      });
  }

  execTerminalArgs(containerName: string, command: string[]): { shellPath: string; shellArgs: string[] } {
    return {
      shellPath: this.binary,
      shellArgs: ['exec', '-it', containerName, ...command],
    };
  }

  async composeUp(file: string, project: string, env?: Record<string, string>): Promise<string> {
    const composeCmd = await this.detectComposeCommand();
    return this.execCompose(composeCmd, file, project, ['up', '-d'], env);
  }

  async composeDown(file: string, project: string): Promise<string> {
    const composeCmd = await this.detectComposeCommand();
    return this.execCompose(composeCmd, file, project, ['down', '-v', '--remove-orphans']);
  }

  private composeCommand: string[] | null = null;

  private async detectComposeCommand(): Promise<string[]> {
    if (this.composeCommand) return this.composeCommand;
    const candidates: string[][] = [[this.binary, 'compose'], ['docker-compose']];
    for (const cmd of candidates) {
      try {
        if (cmd[0] === this.binary) {
          await this.execBinary(['compose', 'version'], 3_000);
        } else {
          await this.execFileAbs(cmd[0], ['version'], 3_000);
        }
        this.composeCommand = cmd;
        return cmd;
      } catch {
        /* try next */
      }
    }
    throw new Error(`Compose not found for ${this.displayName}. Install Docker Compose or Podman Compose.`);
  }

  private execCompose(
    composeCmd: string[],
    file: string,
    project: string,
    args: string[],
    env?: Record<string, string>
  ): Promise<string> {
    const binary = composeCmd[0];
    const baseArgs = composeCmd.slice(1);
    const fullArgs = [...baseArgs, '-f', file, '-p', project, ...args];
    return this.execFileAbs(binary, fullArgs, 180_000, env);
  }

  protected execBinary(args: string[], timeoutMs: number): Promise<string> {
    return this.execFileAbs(this.binary, args, timeoutMs);
  }

  private execFileAbs(
    binary: string,
    args: string[],
    timeoutMs: number,
    extraEnv?: Record<string, string>
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        binary,
        args,
        { timeout: timeoutMs, env: extraEnv ? { ...process.env, ...extraEnv } : process.env },
        (error, stdout, stderr) => {
          if (error) reject(new Error(stderr || error.message));
          else resolve((stdout || '').trim());
        }
      );
    });
  }
}
