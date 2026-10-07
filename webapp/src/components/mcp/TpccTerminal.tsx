import { useEffect, useRef, useState } from 'react';
import { onMessage } from '../../hooks/useVsCode';

export function TpccTerminal({ connected }: { connected: boolean }) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState('idle');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return onMessage((event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'tpccLog' && typeof msg.line === 'string') {
        setLines((prev) => [...prev.slice(-200), msg.line]);
      } else if (msg.type === 'tpccStatus' && typeof msg.state === 'string') {
        setStatus(msg.state);
        if (typeof msg.message === 'string' && msg.message) {
          setLines((prev) => [...prev.slice(-200), msg.message]);
        }
      }
    });
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [lines, status]);

  const prompt = connected ? 'root@tpcc$' : 'waiting for cluster$';

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-black">
      <div className="h-8 flex items-center px-3 border-b border-white/10 text-[10px] font-mono text-white/40">
        TPCC workload · {status}
      </div>
      <div ref={logRef} className="flex-1 overflow-auto p-3 font-mono text-[12px] leading-5 text-emerald-200/90">
        {lines.length === 0 ? (
          <div className="text-white/40">
            {prompt} <span className="text-white/25">cockroach workload run tpcc</span>
          </div>
        ) : (
          lines.map((line, i) => <div key={`${i}-${line.slice(0, 24)}`}>{line}</div>)
        )}
      </div>
    </div>
  );
}
