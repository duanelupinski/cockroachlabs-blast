export interface WorkloadSample {
  elapsedSec: number;
  opsPerSec: number;
  p99?: number;
}

const COLUMN = /(elapsed|errors|ops\(total\)|ops\/sec\([^)]+\)|avg\(ms\)|p50\(ms\)|p95\(ms\)|p99\(ms\)|pMax\(ms\))/g;

export class WorkloadStatsParser {
  private opsIndex = -1;
  private p99Index = -1;

  reset(): void {
    this.opsIndex = -1;
    this.p99Index = -1;
  }

  parse(line: string): WorkloadSample | null {
    const text = line.replace(/\u001b\[[0-9;]*m/g, '').trim();
    if (!text) return null;
    if (text.includes('ops/sec') && text.includes('elapsed')) {
      const names = [...text.matchAll(COLUMN)].map((match) => match[1]);
      const inst = names.findIndex((name) => name.includes('ops/sec') && name.includes('inst'));
      const any = names.findIndex((name) => name.includes('ops/sec'));
      this.opsIndex = inst >= 0 ? inst : any;
      this.p99Index = names.findIndex((name) => name.includes('p99'));
      return null;
    }
    const tokens = text.split(/\s+/);
    if (this.opsIndex < 0 || !/^\d+(\.\d+)?s$/.test(tokens[0] ?? '')) return null;
    const ops = Number(tokens[this.opsIndex]);
    const elapsedSec = Number.parseFloat(tokens[0]);
    if (!Number.isFinite(ops) || !Number.isFinite(elapsedSec)) return null;
    const p99 = this.p99Index >= 0 ? Number(tokens[this.p99Index]) : undefined;
    return {
      elapsedSec,
      opsPerSec: ops,
      p99: p99 !== undefined && Number.isFinite(p99) ? p99 : undefined,
    };
  }
}
