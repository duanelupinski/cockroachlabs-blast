import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import type { ContainerEngine } from '../cluster/engine';

const SAFE_VALUE = /^[a-zA-Z0-9._\-:\/]+$/;
const INIT_CMD = 'cockroach workload init movr';
const RUN_CMD = 'cockroach workload run movr';
const WORKLOAD_CONTAINER = 'blast-workload';
const PID_FILE = '/tmp/blast-movr.pid';

/** Kill cockroach workload pids inside the sidecar. Skip this shell (its script text matches the pattern). */
const KILL_SCRIPT = `
self=$$
signal_pid() {
  pid="$1"
  sig="$2"
  [ -n "$pid" ] || return 0
  [ "$pid" = "$self" ] && return 0
  kill "-$sig" "$pid" 2>/dev/null || true
}
match_workload() {
  case "$1" in
    *cockroach*workload*run*|*cockroach*workload*init*) return 0 ;;
    *) return 1 ;;
  esac
}
if [ -f ${PID_FILE} ]; then
  signal_pid "$(cat ${PID_FILE})" TERM
fi
for pid_path in /proc/[0-9]*; do
  pid="\${pid_path#/proc/}"
  [ "$pid" = "$self" ] && continue
  cmd=$(tr '\\000' ' ' < "$pid_path/cmdline" 2>/dev/null) || continue
  match_workload "$cmd" || continue
  signal_pid "$pid" TERM
done
sleep 1
if [ -f ${PID_FILE} ]; then
  pid=$(cat ${PID_FILE})
  if [ -n "$pid" ] && [ -d "/proc/$pid" ]; then
    signal_pid "$pid" KILL
  fi
fi
for pid_path in /proc/[0-9]*; do
  pid="\${pid_path#/proc/}"
  [ "$pid" = "$self" ] && continue
  cmd=$(tr '\\000' ' ' < "$pid_path/cmdline" 2>/dev/null) || continue
  match_workload "$cmd" || continue
  signal_pid "$pid" KILL
done
rm -f ${PID_FILE}
`;

export class MovrWorkload extends EventEmitter {
  private process: ChildProcess | null = null;
  private activeContainer: string | null = null;
  private suppressExit = false;

  constructor(private readonly engine: ContainerEngine) {
    super();
  }

  init(containerName: string, connStr: string): void {
    void this.begin(containerName, `${INIT_CMD} ${connStr}`, 'init');
  }

  run(containerName: string, params: Record<string, string>, connStr: string): void {
    for (const [flag, value] of Object.entries(params)) {
      if (!SAFE_VALUE.test(value)) {
        this.emit('status', { state: 'error', message: `Invalid value for ${flag}` });
        return;
      }
    }
    const flags = Object.entries(params)
      .map(([flag, value]) => `${flag}=${value}`)
      .join(' ');
    const flagStr = [flags, '--tolerate-errors'].filter(Boolean).join(' ');
    void this.begin(containerName, `${RUN_CMD} ${flagStr} ${connStr}`, 'run');
  }

  async stop(): Promise<void> {
    this.suppressExit = true;
    const container = this.activeContainer ?? WORKLOAD_CONTAINER;
    try {
      await this.killInContainer(container);
    } catch {
      /* sidecar may already be gone */
    }
    this.killLocalClient();
    this.activeContainer = null;
    this.emit('status', { state: 'stopped' });
    this.emit('log', 'MovR workload stopped.');
  }

  get isRunning(): boolean {
    return this.process !== null;
  }

  dispose(): void {
    this.suppressExit = true;
    const container = this.activeContainer;
    this.killLocalClient();
    this.activeContainer = null;
    if (container) void this.killInContainer(container).catch(() => {});
    this.removeAllListeners();
  }

  private async begin(containerName: string, cmd: string, kind: 'init' | 'run'): Promise<void> {
    this.suppressExit = true;
    try {
      await this.killInContainer(this.activeContainer ?? containerName);
    } catch {
      /* nothing running */
    }
    this.killLocalClient();
    this.suppressExit = false;
    this.activeContainer = containerName;
    this.emit('log', kind === 'init' ? 'Initializing MovR…' : 'Starting MovR…');
    this.spawn(containerName, cmd, kind);
  }

  private spawn(containerName: string, cmd: string, kind: 'init' | 'run'): void {
    const wrapped = `echo $$ > ${PID_FILE}; exec ${cmd}`;
    this.process = this.engine.spawnExec(containerName, ['/bin/sh', '-c', wrapped]);
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
      if (this.process !== proc) return;
      this.process = null;
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

  private async killInContainer(container: string): Promise<void> {
    await this.engine.exec(container, ['/bin/sh', '-c', KILL_SCRIPT], 15_000);
  }

  private killLocalClient(): void {
    const proc = this.process;
    this.process = null;
    if (!proc) return;
    try {
      proc.kill('SIGKILL');
    } catch {
      /* client already exited */
    }
  }
}
