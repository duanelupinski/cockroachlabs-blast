import { useEffect, useRef, useState } from 'react';
import { onMessage, postMessage } from '../../hooks/useVsCode';

type MovrState = 'idle' | 'initializing' | 'ready' | 'running' | 'stopped' | 'error';

interface MovrWorkloadPanelProps {
  clusterConnected: boolean;
  description: string;
}

export function MovrWorkloadPanel({ clusterConnected, description }: MovrWorkloadPanelProps) {
  const [duration, setDuration] = useState('5m');
  const [concurrency, setConcurrency] = useState('4');
  const [runStarted, setRunStarted] = useState(false);
  const [movrState, setMovrState] = useState<MovrState>('idle');
  const [movrError, setMovrError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return onMessage((event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'movrStatus') {
        const next = msg.state as MovrState;
        setMovrState(next);
        setMovrError(typeof msg.message === 'string' ? msg.message : null);
        if (next === 'stopped' || next === 'error' || next === 'ready' || next === 'idle') {
          setRunStarted(false);
        }
      } else if (msg.type === 'movrLog' && typeof msg.line === 'string') {
        setLogs((prev) => [...prev.slice(-80), msg.line]);
      }
    });
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [logs]);

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-white/40">MovR workload</div>
      <p className="text-[10px] text-white/45">{description}</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-white/40">
          Duration
          <input
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="mt-0.5 w-full h-6 px-1.5 rounded bg-black/40 border border-white/10 font-mono text-white/80"
          />
        </label>
        <label className="text-[10px] text-white/40">
          Concurrency
          <input
            value={concurrency}
            onChange={(e) => setConcurrency(e.target.value)}
            className="mt-0.5 w-full h-6 px-1.5 rounded bg-black/40 border border-white/10 font-mono text-white/80"
          />
        </label>
      </div>
      <div className="flex gap-1.5">
        <button
          disabled={!clusterConnected || movrState === 'initializing' || movrState === 'running'}
          onClick={() => postMessage({ type: 'movrInit' })}
          className="flex-1 text-[10px] bg-white/10 hover:bg-white/20 disabled:opacity-40 rounded py-1"
        >
          Init
        </button>
        <button
          disabled={!clusterConnected || movrState === 'initializing' || movrState === 'running' || runStarted}
          onClick={() => {
            setRunStarted(true);
            postMessage({ type: 'movrRun', duration, concurrency });
          }}
          className="flex-1 text-[10px] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded py-1"
        >
          Run
        </button>
        <button
          disabled={!clusterConnected || (!runStarted && movrState !== 'running')}
          onClick={() => postMessage({ type: 'movrStop' })}
          className="flex-1 text-[10px] bg-white/10 hover:bg-white/20 disabled:opacity-40 rounded py-1"
        >
          Stop
        </button>
      </div>
      <div className="text-[10px] font-mono text-white/40">
        {movrState === 'idle' && 'Not initialized'}
        {movrState === 'initializing' && 'Initializing…'}
        {movrState === 'ready' && 'Ready to run'}
        {movrState === 'running' && 'Running'}
        {movrState === 'stopped' && 'Stopped'}
        {movrState === 'error' && (movrError || 'Error')}
      </div>
      <div
        ref={logRef}
        className="h-[21rem] overflow-auto rounded bg-black/50 border border-white/10 p-1.5 font-mono text-[9px] text-white/50 whitespace-pre-wrap"
      >
        {logs.length === 0 ? 'Workload output…' : logs.join('\n')}
      </div>
    </div>
  );
}
