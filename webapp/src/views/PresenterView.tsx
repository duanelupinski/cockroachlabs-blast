import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlobeScene } from '../components/globe/GlobeScene';
import { RegionMarker } from '../components/globe/RegionMarker';
import { ReplicationArc } from '../components/globe/ReplicationArc';
import {
  REGIONS,
  mapRegionName,
  parseLocality,
  type RegionId,
  type ReplicaInfo,
  type NodeInfo,
  type RangeInfo,
} from '../types/globe';
import { onMessage, postMessage } from '../hooks/useVsCode';

interface PlaybookStep {
  id: string;
  title: string;
  narration?: string;
  sql: string[];
  snapshot?: string;
}

interface Playbook {
  id: string;
  title: string;
  focusTable: string;
  superRegion?: { name: string; regions: string[] };
  steps: PlaybookStep[];
}

interface TopologyPayload {
  nodes: NodeInfo[];
  ranges: RangeInfo[];
  byRegion: Record<string, { voting: number; nonVoting: number; leaseholder: number }>;
  focusTable: string;
  superRegion?: { name: string; regions: string[] };
}

function buildReplicas(nodes: NodeInfo[], ranges: RangeInfo[]): ReplicaInfo[] {
  const regionCounters = new Map<RegionId, number>();
  const nodeMap = new Map<number, { regionId: RegionId; nodeIndex: number }>();
  for (const node of nodes) {
    const { region } = parseLocality(node.locality);
    const regionId = mapRegionName(region);
    const idx = regionCounters.get(regionId) ?? 0;
    nodeMap.set(node.nodeId, { regionId, nodeIndex: idx });
    regionCounters.set(regionId, idx + 1);
  }
  const stats = new Map<number, { voting: number; leaseholder: number }>();
  for (const range of ranges) {
    const voting = new Set(range.votingReplicas);
    for (const id of range.replicas) {
      const s = stats.get(id) ?? { voting: 0, leaseholder: 0 };
      if (id === range.leaseHolder) s.leaseholder++;
      if (voting.has(id)) s.voting++;
      stats.set(id, s);
    }
  }
  const replicas: ReplicaInfo[] = [];
  for (const [id, s] of stats) {
    const m = nodeMap.get(id);
    if (!m) continue;
    replicas.push({
      regionId: m.regionId,
      nodeIndex: m.nodeIndex,
      isVoting: s.voting > 0,
      isLeaseholder: s.leaseholder > 0,
      votingCount: s.voting,
    });
  }
  return replicas;
}

export function PresenterView() {
  const [tab, setTab] = useState<'globe' | 'console'>('globe');
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [topology, setTopology] = useState<TopologyPayload | null>(null);
  const [snapshot, setSnapshot] = useState<TopologyPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [httpPort, setHttpPort] = useState(8080);
  const [consoleKey, setConsoleKey] = useState(0);
  const [focused, setFocused] = useState<RegionId | null>(null);
  const [showGhost, setShowGhost] = useState(true);
  const [globePaused, setGlobePaused] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  useEffect(() => {
    const cleanup = onMessage((event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'playbook':
          setPlaybook(msg.playbook);
          if (msg.httpPort) setHttpPort(msg.httpPort);
          break;
        case 'topology':
          setTopology(msg.data);
          setConnected(true);
          if (msg.snapshotBefore) setSnapshot(msg.snapshotBefore);
          break;
        case 'snapshot':
          if (msg.when === 'before') setSnapshot(msg.data);
          break;
        case 'disconnected':
          setConnected(false);
          setTopology(null);
          break;
        case 'stepRan':
          setStepIndex(msg.index);
          setStepError(typeof msg.error === 'string' ? msg.error : null);
          break;
      }
    });
    postMessage({ type: 'ready' });
    return cleanup;
  }, []);

  const liveNodes = topology?.nodes ?? [];
  const liveReplicas = useMemo(
    () => (topology ? buildReplicas(topology.nodes, topology.ranges) : []),
    [topology]
  );
  const ghostReplicas = useMemo(
    () => (snapshot ? buildReplicas(snapshot.nodes, snapshot.ranges) : []),
    [snapshot]
  );

  const activeRegions = useMemo(() => {
    const counts = new Map<RegionId, number>();
    for (const n of liveNodes) {
      const id = mapRegionName(parseLocality(n.locality).region);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if (counts.size === 0) return REGIONS;
    return REGIONS.filter((r) => counts.has(r.id)).map((r) => ({ ...r, nodes: counts.get(r.id)! }));
  }, [liveNodes]);

  const euRegions = playbook?.superRegion?.regions ?? ['eu-west', 'eu-central'];
  const currentStep = playbook?.steps[stepIndex];
  const consoleUrl = `http://localhost:${httpPort}`;

  const runStep = useCallback((i: number) => {
    postMessage({ type: 'runStep', index: i });
    setStepIndex(i);
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0a0e14] text-gray-200">
      <header className="h-10 flex items-center gap-2 px-3 border-b border-white/10">
        <button
          className={`text-xs px-2 py-1 rounded ${tab === 'globe' ? 'bg-white/10' : 'text-white/50'}`}
          onClick={() => setTab('globe')}
        >
          Globe
        </button>
        <button
          className={`text-xs px-2 py-1 rounded ${tab === 'console' ? 'bg-white/10' : 'text-white/50'}`}
          onClick={() => setTab('console')}
        >
          DB Console
        </button>
        {tab === 'globe' && (
          <button
            className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20"
            onClick={() => setGlobePaused((p) => !p)}
          >
            {globePaused ? 'Resume globe' : 'Pause globe'}
          </button>
        )}
        <span className="ml-auto text-[10px] font-mono text-white/40">
          {connected ? 'connected' : 'waiting for cluster'}
          {topology?.focusTable ? ` · ${topology.focusTable}` : ''}
        </span>
      </header>

      {tab === 'globe' ? (
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 relative min-w-0">
            <GlobeScene
              autoRotate={!focused && !globePaused}
              focusLat={focused ? REGIONS.find((r) => r.id === focused)?.lat : null}
              focusLng={focused ? REGIONS.find((r) => r.id === focused)?.lng : null}
              onFocusComplete={() => setFocused(null)}
            >
              {activeRegions.map((region, i) => {
                const next = activeRegions[(i + 1) % activeRegions.length];
                if (i >= activeRegions.length - 1 && activeRegions.length < 2) return null;
                if (region.id === next.id) return null;
                return (
                  <ReplicationArc
                    key={`arc-${region.id}-${next.id}`}
                    from={region}
                    to={next}
                    color={region.color}
                    showLatency
                    rebalancing={!!snapshot && liveReplicas.length > 0}
                  />
                );
              })}
              {activeRegions.map((region) => (
                <RegionMarker
                  key={region.id}
                  region={region}
                  isFailed={false}
                  isPrimary={region.id === 'us-east'}
                  replicas={liveReplicas.filter((r) => r.regionId === region.id)}
                  failedNodes={new Set()}
                  onClick={() => setFocused(region.id)}
                  showLabels
                />
              ))}
            </GlobeScene>
            {showGhost && snapshot && (
              <div className="absolute bottom-2 left-2 text-[10px] font-mono text-white/40 bg-black/40 px-2 py-1 rounded">
                Ghost: before super region · live pins update every 2s
              </div>
            )}
          </div>

          <aside className="w-[360px] border-l border-white/10 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-white/10">
              <div className="text-sm font-semibold">{playbook?.title ?? 'Playbook'}</div>
              <div className="text-[10px] text-white/40 mt-1">
                Super region <span className="text-emerald-400">{playbook?.superRegion?.name}</span>:{' '}
                {euRegions.join(', ')}
              </div>
            </div>
            <div className="flex-1 overflow-auto px-3 py-2 space-y-2">
              {playbook?.steps.map((step, i) => (
                <button
                  key={step.id}
                  onClick={() => setStepIndex(i)}
                  className={`w-full text-left rounded border px-2 py-2 ${
                    i === stepIndex ? 'border-emerald-400/60 bg-emerald-400/10' : 'border-white/10'
                  }`}
                >
                  <div className="text-xs font-medium">
                    {i + 1}. {step.title}
                  </div>
                  {step.narration && <div className="text-[10px] text-white/50 mt-1">{step.narration}</div>}
                </button>
              ))}
            </div>
            {stepError && (
              <div className="mx-3 mb-2 text-[11px] text-red-300 bg-red-950/50 border border-red-500/40 rounded p-2">
                {stepError}
              </div>
            )}
            {currentStep && (
              <div className="border-t border-white/10 p-3 space-y-2">
                <pre className="text-[10px] font-mono text-emerald-200/80 bg-black/40 p-2 rounded max-h-32 overflow-auto whitespace-pre-wrap">
                  {currentStep.sql.join('\n')}
                </pre>
                <div className="flex gap-2">
                  <button
                    className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-500 rounded py-1"
                    onClick={() => runStep(stepIndex)}
                  >
                    Run step
                  </button>
                  <button
                    className="text-xs bg-white/10 hover:bg-white/20 rounded px-2 py-1"
                    onClick={() => setStepIndex(Math.max(0, stepIndex - 1))}
                  >
                    Back
                  </button>
                  <button
                    className="text-xs bg-white/10 hover:bg-white/20 rounded px-2 py-1"
                    onClick={() => postMessage({ type: 'runAll' })}
                  >
                    Run all
                  </button>
                </div>
              </div>
            )}
            <div className="border-t border-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">Replicas by region</div>
              {REGIONS.map((r) => {
                const c = topology?.byRegion[r.id];
                const ghost = snapshot?.byRegion[r.id];
                const inEu = euRegions.includes(r.id);
                return (
                  <div key={r.id} className="flex items-center justify-between text-[11px] py-0.5">
                    <span style={{ color: r.color }}>
                      {r.label}
                      {inEu ? ' · EU' : ''}
                    </span>
                    <span className="font-mono text-white/70">
                      {c ? `${c.voting}V ${c.leaseholder}LH` : '—'}
                      {showGhost && ghost ? (
                        <span className="text-white/30"> (was {ghost.voting}V)</span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
              <label className="flex items-center gap-2 mt-2 text-[10px] text-white/50">
                <input type="checkbox" checked={showGhost} onChange={(e) => setShowGhost(e.target.checked)} />
                Show before snapshot counts
              </label>
            </div>
          </aside>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="h-8 flex items-center gap-2 px-2 border-b border-white/10 bg-[#0d1117]">
            <input
              readOnly
              value={consoleUrl}
              className="flex-1 h-6 text-[11px] font-mono px-2 rounded bg-[#161b22] border border-white/10"
            />
            <button className="text-[11px] px-2 py-0.5 bg-white/10 rounded" onClick={() => setConsoleKey((k) => k + 1)}>
              Reload
            </button>
            <button
              className="text-[11px] px-2 py-0.5 bg-white/10 rounded"
              onClick={() => postMessage({ type: 'openExternal', url: consoleUrl })}
            >
              Open External
            </button>
          </div>
          <iframe
            key={consoleKey}
            title="DB Console"
            src={consoleUrl}
            className="flex-1 w-full border-0 bg-[#0d1117]"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        </div>
      )}
    </div>
  );
}
