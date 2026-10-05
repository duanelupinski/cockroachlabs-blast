import { useEffect, useMemo, useRef, useState } from 'react';
import { onMessage, postMessage } from '../../hooks/useVsCode';

interface Sample {
  opsPerSec: number;
  p99?: number;
}

interface ChatLine {
  id: number;
  kind: 'user' | 'assistant' | 'tool' | 'error';
  text: string;
}

const SUGGESTED =
  'The MovR workload on the rides table got slower after an index was dropped. Which index is missing, and what should I create to restore it?';

export function McpWorkspace({ connected }: { connected: boolean }) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [restoreAt, setRestoreAt] = useState<number | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const samplesRef = useRef<Sample[]>([]);
  const assistantId = useRef<number | null>(null);
  const nextId = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return onMessage((event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'throughputReset') {
        samplesRef.current = [];
        setSamples([]);
        setDropAt(null);
        setRestoreAt(null);
      } else if (msg.type === 'throughput' && typeof msg.opsPerSec === 'number') {
        const sample: Sample = {
          opsPerSec: msg.opsPerSec,
          p99: typeof msg.p99 === 'number' ? msg.p99 : undefined,
        };
        const next = [...samplesRef.current, sample].slice(-180);
        samplesRef.current = next;
        setSamples(next);
      } else if (msg.type === 'indexEvent') {
        const at = Math.max(0, samplesRef.current.length - 1);
        if (msg.kind === 'dropped') setDropAt(at);
        if (msg.kind === 'restored') setRestoreAt(at);
      } else if (msg.type === 'mcpSuggest' && typeof msg.text === 'string') {
        setDraft(msg.text);
      } else if (msg.type === 'mcpKey') {
        setKeySaved(Boolean(msg.saved));
        if (msg.saved) setShowKey(false);
      } else if (msg.type === 'mcpStatus') {
        if (msg.phase === 'running') setRunning(true);
        if (msg.phase === 'error' && typeof msg.error === 'string') {
          setLines((prev) => [...prev, { id: nextId.current++, kind: 'error', text: msg.error }]);
        }
      } else if (msg.type === 'mcpDelta' && typeof msg.text === 'string') {
        const id = assistantId.current;
        setLines((prev) => {
          if (id === null) return prev;
          return prev.map((line) => (line.id === id ? { ...line, text: msg.text } : line));
        });
      } else if (msg.type === 'mcpTool' && typeof msg.name === 'string') {
        const status = typeof msg.status === 'string' && msg.status ? ` · ${msg.status}` : '';
        setLines((prev) => [...prev, { id: nextId.current++, kind: 'tool', text: `${msg.name}${status}` }]);
      } else if (msg.type === 'mcpTurnDone') {
        assistantId.current = null;
        setRunning(false);
      }
    });
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo(0, scroller.current.scrollHeight);
  }, [lines, running]);

  const send = () => {
    const text = draft.trim();
    if (!text || running) return;
    const userId = nextId.current++;
    const replyId = nextId.current++;
    assistantId.current = replyId;
    setLines((prev) => [
      ...prev,
      { id: userId, kind: 'user', text },
      { id: replyId, kind: 'assistant', text: '' },
    ]);
    setDraft('');
    setRunning(true);
    postMessage({ type: 'mcpSend', text });
  };

  const latest = samples[samples.length - 1];

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <section className="h-[42%] min-h-[180px] border-b border-white/10 flex flex-col">
        <div className="px-3 pt-2 flex items-baseline gap-3">
          <div className="text-xs font-semibold">MovR throughput</div>
          <div className="text-[10px] font-mono text-emerald-300/90">
            {latest ? `${latest.opsPerSec.toFixed(1)} ops/sec` : 'waiting for workload'}
          </div>
          {latest?.p99 !== undefined && (
            <div className="text-[10px] font-mono text-amber-200/80">p99 {latest.p99.toFixed(1)} ms</div>
          )}
        </div>
        <ThroughputChart samples={samples} dropAt={dropAt} restoreAt={restoreAt} />
      </section>
      <section className="flex-1 min-h-0 flex flex-col">
        <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
          <div className="text-xs font-semibold">MCP chat</div>
          <div className="ml-auto text-[10px] text-white/40">
            {keySaved ? 'Cursor key saved' : 'Cursor API key required'}
          </div>
          <button
            type="button"
            className="text-[10px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20"
            onClick={() => setShowKey((open) => !open)}
          >
            {keySaved ? 'Change key' : 'Add key'}
          </button>
        </div>
        {showKey && (
          <form
            className="px-3 py-2 border-b border-white/10 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              postMessage({ type: 'mcpSaveKey', key: keyDraft });
              setKeyDraft('');
            }}
          >
            <input
              type="password"
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
              placeholder="Cursor API key"
              className="flex-1 h-7 px-2 text-[11px] rounded bg-black/40 border border-white/10"
            />
            <button type="submit" className="text-[11px] px-2 rounded bg-emerald-600 hover:bg-emerald-500">
              Save
            </button>
            {keySaved && (
              <button
                type="button"
                className="text-[11px] px-2 rounded bg-white/10 hover:bg-white/20"
                onClick={() => postMessage({ type: 'mcpClearKey' })}
              >
                Clear
              </button>
            )}
          </form>
        )}
        <div ref={scroller} className="flex-1 overflow-auto px-3 py-2 space-y-2">
          {lines.length === 0 && (
            <div className="text-[11px] text-white/40">
              Ask the CockroachDB MCP server about the missing MovR index. Replies stream from a local Cursor agent.
            </div>
          )}
          {lines.map((line) => (
            <div
              key={line.id}
              className={
                line.kind === 'user'
                  ? 'text-[12px] whitespace-pre-wrap'
                  : line.kind === 'tool'
                    ? 'text-[10px] font-mono text-sky-300/80'
                    : line.kind === 'error'
                      ? 'text-[11px] text-red-300'
                      : 'text-[12px] whitespace-pre-wrap text-white/85'
              }
            >
              {line.kind === 'tool' ? `MCP · ${line.text}` : line.text || (running ? '…' : '')}
            </div>
          ))}
        </div>
        <div className="border-t border-white/10 p-3 space-y-2">
          <button
            type="button"
            className="text-left text-[10px] text-emerald-200/80 hover:text-emerald-100"
            onClick={() => setDraft(SUGGESTED)}
          >
            Use suggested prompt
          </button>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            rows={3}
            placeholder="Ask about the missing index…"
            className="w-full resize-none text-[12px] rounded bg-black/40 border border-white/10 px-2 py-1.5"
          />
          <button
            type="button"
            disabled={!connected || running || !draft.trim()}
            onClick={send}
            className="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded px-3 py-1"
          >
            {running ? 'Asking…' : 'Send'}
          </button>
        </div>
      </section>
    </div>
  );
}

function ThroughputChart({
  samples,
  dropAt,
  restoreAt,
}: {
  samples: Sample[];
  dropAt: number | null;
  restoreAt: number | null;
}) {
  const width = 640;
  const height = 200;
  const pad = { l: 44, r: 44, t: 16, b: 22 };
  const plot = useMemo(() => {
    const innerW = width - pad.l - pad.r;
    const innerH = height - pad.t - pad.b;
    const maxOps = Math.max(1, ...samples.map((sample) => sample.opsPerSec));
    const p99s = samples.map((sample) => sample.p99).filter((value): value is number => value !== undefined);
    const maxP99 = Math.max(1, ...p99s);
    const x = (index: number) =>
      pad.l + (samples.length <= 1 ? innerW / 2 : (index / (samples.length - 1)) * innerW);
    const yOps = (ops: number) => pad.t + (1 - ops / maxOps) * innerH;
    const yP99 = (ms: number) => pad.t + (1 - ms / maxP99) * innerH;
    const opsPath = samples
      .map((sample, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${yOps(sample.opsPerSec).toFixed(1)}`)
      .join(' ');
    let p99Started = false;
    const p99Path = samples
      .map((sample, index) => {
        if (sample.p99 === undefined) return '';
        const command = p99Started ? 'L' : 'M';
        p99Started = true;
        return `${command}${x(index).toFixed(1)},${yP99(sample.p99).toFixed(1)}`;
      })
      .join(' ');
    return { maxOps, maxP99, x, opsPath, p99Path, hasP99: p99s.length > 0 };
  }, [samples]);

  return (
    <div className="flex-1 min-h-0 px-2 pb-2">
      {samples.length === 0 ? (
        <div className="h-full flex items-center justify-center text-[11px] text-white/40">
          Run the MovR workload to plot ops/sec.
        </div>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
          <text x={8} y={14} fill="rgba(255,255,255,0.45)" fontSize="10">
            ops/sec
          </text>
          <text x={width - 36} y={14} fill="rgba(252,211,77,0.8)" fontSize="10">
            p99
          </text>
          <text x={4} y={height - 8} fill="rgba(255,255,255,0.35)" fontSize="10">
            0
          </text>
          <text x={4} y={pad.t + 4} fill="rgba(255,255,255,0.35)" fontSize="10">
            {Math.round(plot.maxOps)}
          </text>
          {plot.hasP99 && (
            <text x={width - 40} y={pad.t + 4} fill="rgba(252,211,77,0.7)" fontSize="10">
              {Math.round(plot.maxP99)}
            </text>
          )}
          <path d={plot.opsPath} fill="none" stroke="#34d399" strokeWidth="2" />
          {plot.hasP99 && (
            <path d={plot.p99Path} fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="4 3" />
          )}
          {dropAt !== null && samples[dropAt] && (
            <ChartMark x={plot.x(dropAt)} label="index dropped" color="#f87171" />
          )}
          {restoreAt !== null && samples[restoreAt] && (
            <ChartMark x={plot.x(restoreAt)} label="index restored" color="#34d399" />
          )}
        </svg>
      )}
    </div>
  );
}

function ChartMark({ x, label, color }: { x: number; label: string; color: string }) {
  return (
    <g>
      <line x1={x} x2={x} y1={16} y2={178} stroke={color} strokeDasharray="3 3" />
      <text x={x + 4} y={32} fill={color} fontSize="10">
        {label}
      </text>
    </g>
  );
}
