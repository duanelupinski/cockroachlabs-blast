import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import type { ContainerEngine } from '../cluster/engine';

const SAFE_VALUE = /^[a-zA-Z0-9._\-:\/]+$/;
const INIT_CMD = 'cockroach workload init movr';
const RUN_CMD = 'cockroach workload run movr';

export class MovrWorkload extends EventEmitter {
  private process: ChildProcess | null = null;
  private activeContainer: string | null = null;
  private suppressExit = false;

  constructor(private readonly engine: ContainerEngine) {
    super();
  }

  init(containerName: string, connStr: string): void {
    this.cleanup();
    this.emit('log', 'Initializing MovR…');
    this.spawn(containerName, `${INIT_CMD} ${connStr}`, 'init');
  }

  run(containerName: string, params: Record<string, string>, connStr: string): void {
    this.cleanup();
    for (const [flag, value] of Object.entries(params)) {
      if (!SAFE_VALUE.test(value)) {
        this.emit('status', { state: 'error', message: `Invalid value for ${flag}` });
        return;
      }
    }
    const flags = Object.entries(params)
      .map(([flag, value]) => `${flag}=${value}`)
      .join(' ');
    this.activeContainer = containerName;
    this.emit('log', 'Starting MovR…');
    const flagStr = [flags, '--tolerate-errors'].filter(Boolean).join(' ');
    this.spawn(containerName, `${RUN_CMD} ${flagStr} ${connStr}`, 'run');
  }

  stop(): void {
    this.suppressExit = true;
    this.killInContainer();
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.activeContainer = null;
    this.emit('status', { state: 'stopped' });
    this.emit('log', 'MovR workload stopped.');
  }

  get isRunning(): boolean {
    return this.process !== null;
  }

  dispose(): void {
    this.cleanup();
    this.removeAllListeners();
  }

  private spawn(containerName: string, cmd: string, kind: 'init' | 'run'): void {
    this.process = this.engine.spawnExec(containerName, ['/bin/sh', '-c', cmd]);
    let remainder = '';
    this.process.stdout?.on('data', (data: Buffer) => {
      const text = remainder + data.toString();
      const lines = text.split('\n');
      remainder = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) this.emit('log', line);
      }
    });
    this.process.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        if (line.trim()) this.emit('log', line);
      }
    });
    const proc = this.process;
    proc.on('close', (code) => {
      if (remainder.trim()) this.emit('log', remainder);
      if (this.process === proc) this.process = null;
      if (this.suppressExit) {
        this.suppressExit = false;
        return;
      }
      if (kind === 'init') {
        this.emit('status', {
          state: code === 0 ? 'ready' : 'error',
          message: code === 0 ? undefined : `MovR init exited with code ${code}`,
        });
      } else {
        this.emit('status', { state: 'stopped', message: code === 0 ? undefined : `MovR exited with code ${code}` });
      }
    });
  }

  private killInContainer(): void {
    if (!this.activeContainer) return;
    this.engine.exec(this.activeContainer, ['pkill', '-f', RUN_CMD]).catch(() => {});
  }

  private cleanup(): void {
    if (this.process) {
      this.suppressExit = true;
      this.killInContainer();
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.activeContainer = null;
  }
}
