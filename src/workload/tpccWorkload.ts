import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import type { ContainerEngine } from '../cluster/engine';

const WORKLOAD_CONTAINER = 'blast-workload';
const PID_FILE = '/tmp/blast-tpcc.pid';
const RUN_CMD =
  "cockroach workload run tpcc --warehouses=1 --duration=30m --concurrency=2 --tolerate-errors 'postgresql://root@blast-lb:26257/tpcc?sslmode=disable'";

const KILL_SCRIPT = `
self=$$
signal_pid() {
  pid="$1"
  sig="$2"
  [ -n "$pid" ] || return 0
  [ "$pid" = "$self" ] && return 0
  kill "-$sig" "$pid" 2>/dev/null || true
}
match_tpcc() {
  case "$1" in
    *cockroach*workload*run*tpcc*) return 0 ;;
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
  match_tpcc "$cmd" || continue
  signal_pid "$pid" TERM
done
sleep 1
for pid_path in /proc/[0-9]*; do
  pid="\${pid_path#/proc/}"
  [ "$pid" = "$self" ] && continue
  cmd=$(tr '\\000' ' ' < "$pid_path/cmdline" 2>/dev/null) || continue
  match_tpcc "$cmd" || continue
  signal_pid "$pid" KILL
done
rm -f ${PID_FILE}
`;

export class TpccWorkload extends EventEmitter {
  private process: ChildProcess | null = null;
  private activeContainer: string | null = null;
  private suppressExit = false;

  constructor(private engine: ContainerEngine) {
    super();
  }

  bind(engine: ContainerEngine): void {
    this.engine = engine;
  }

  run(containerName: string): void {
    void this.begin(containerName);
  }

  async stop(): Promise<void> {
    this.suppressExit = true;
    const container = this.activeContainer ?? WORKLOAD_CONTAINER;
    try {
      await this.engine.exec(container, ['/bin/sh', '-c', KILL_SCRIPT], 15_000);
    } catch {
      /* sidecar may already be gone */
    }
    this.killLocalClient();
    this.activeContainer = null;
    this.emit('status', { state: 'stopped' });
    this.emit('log', 'TPCC workload stopped.');
  }

  dispose(): void {
    this.suppressExit = true;
    const container = this.activeContainer;
    this.killLocalClient();
    this.activeContainer = null;
    if (container) {
      void this.engine.exec(container, ['/bin/sh', '-c', KILL_SCRIPT], 15_000).catch(() => {});
    }
    this.removeAllListeners();
  }

  private async begin(containerName: string): Promise<void> {
    this.suppressExit = true;
    try {
      await this.engine.exec(this.activeContainer ?? containerName, ['/bin/sh', '-c', KILL_SCRIPT], 15_000);
    } catch {
      /* nothing running */
    }
    this.killLocalClient();
    this.suppressExit = false;
    this.activeContainer = containerName;
    this.emit('log', '$ cockroach workload run tpcc --warehouses=1 --duration=30m');
    const wrapped = `echo $$ > ${PID_FILE}; exec ${RUN_CMD}`;
    const proc = this.engine.spawnExec(containerName, ['/bin/sh', '-c', wrapped]);
    this.process = proc;
    let remainder = '';
    proc.stdout?.on('data', (data: Buffer) => {
      const text = remainder + data.toString();
      const lines = text.split('\n');
      remainder = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) this.emit('log', line);
      }
    });
    proc.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        if (line.trim()) this.emit('log', line);
      }
    });
    proc.on('close', (code) => {
      if (remainder.trim()) this.emit('log', remainder);
      if (this.process !== proc) return;
      this.process = null;
      if (this.suppressExit) {
        this.suppressExit = false;
        return;
      }
      this.emit('status', {
        state: 'stopped',
        message: code === 0 ? undefined : `TPCC workload exited with code ${code}`,
      });
    });
    this.emit('status', { state: 'running' });
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
