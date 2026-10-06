import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GlobeScene } from '../components/globe/GlobeScene';
import { RegionMarker } from '../components/globe/RegionMarker';
import { ReplicationArc } from '../components/globe/ReplicationArc';
import { HaControlPanel } from '../components/ha/HaControlPanel';
import { McpWorkspace } from '../components/mcp/McpWorkspace';
import { MovrWorkloadPanel } from '../components/movr/MovrWorkloadPanel';
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

type DemoKind = 'multi-region' | 'table-locality' | 'ha' | 'upgrade' | 'mcp';

interface PlaybookStep {
  id: string;
  title: string;
  narration?: string;
  sql: string[];
  focusTable?: string;
  snapshot?: string;
  action?: 'upgrade-node' | 'movr-init' | 'movr-run' | 'mcp-prompt';
  node?: number;
  prompt?: string;
}

interface SuperRegionDef {
  name: string;
  regions: string[];
}

interface Playbook {
  id: string;
  title: string;
  focusTable: string;
  superRegions?: SuperRegionDef[];
  superRegion?: SuperRegionDef;
  upgrade?: { from: string; to: string; region: string };
  steps: PlaybookStep[];
}

function waitingCopy(demo: DemoKind): string {
  if (demo === 'ha') return 'No cluster running — start the 3-node HA cluster to place nodes';
  if (demo === 'mcp') return 'No cluster running — start the 3-node MCP demo cluster';
  if (demo === 'upgrade') return 'No cluster running — start the 3-node us-west cluster to place nodes';
  if (demo === 'table-locality') return 'No cluster running — start the 9-node cluster to place nodes';
  return 'No cluster running — start the 6-node cluster to place nodes';
}

interface RegionZoneCounts {
  replicas: number;
  byZone: Record<string, number>;
}

interface TopologyPayload {
  nodes: NodeInfo[];
  ranges: RangeInfo[];
  byRegion: Record<string, { replicas: number }>;
  byTable?: Record<string, Record<string, RegionZoneCounts>>;
  byTableHome?: Record<string, Record<string, Record<string, RegionZoneCounts>>>;
  tableLocality?: Record<string, string>;
  focusTable: string;
  superRegions?: SuperRegionDef[];
  superRegion?: SuperRegionDef;
}

const GLOBE_TABLES = [
  { id: 'app.customers', label: 'customers' },
  { id: 'app.orders', label: 'orders' },
  { id: 'app.prices', label: 'prices' },
] as const;

const ZONES_BY_REGION: Record<string, string[]> = {
  'us-east': ['us-east-1', 'us-east-2', 'us-east-3'],
  'us-west': ['us-west-1', 'us-west-2', 'us-west-3'],
  'eu-west': ['eu-west-1', 'eu-west-2', 'eu-west-3'],
};

function localityLabel(raw: string | undefined): string {
  if (!raw) return '—';
  if (raw === 'RBR' || /regional by row/i.test(raw)) return 'regional by row';
  if (raw === 'RBT' || /regional by table/i.test(raw)) return 'regional by table';
  if (raw === 'Global' || /global/i.test(raw)) return 'global';
  return raw;
}

function replicaTableForRegion(
  regionId: string,
  byTable?: Record<string, Record<string, RegionZoneCounts>>,
  tableLocality?: Record<string, string>
) {
  const zones = ZONES_BY_REGION[regionId] ?? [];
  const rows: { table: string; type: string; counts: number[] }[] = [];
  for (const tbl of GLOBE_TABLES) {
    rows.push({
      table: tbl.label,
      type: localityLabel(tableLocality?.[tbl.id]),
      counts: zones.map((z) => byTable?.[tbl.id]?.[regionId]?.byZone[z] ?? 0),
    });
  }
  return { zones, rows };
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
  const stats = new Map<number, number>();
  for (const range of ranges) {
    for (const id of range.replicas) {
      stats.set(id, (stats.get(id) ?? 0) + 1);
    }
  }
  const replicas: ReplicaInfo[] = [];
  for (const [id, count] of stats) {
    const m = nodeMap.get(id);
    if (!m) continue;
    replicas.push({
      regionId: m.regionId,
      nodeIndex: m.nodeIndex,
      isVoting: true,
      isLeaseholder: false,
      votingCount: count,
      replicaCount: count,
    });
  }
  return replicas;
}

function failedNodeKeys(nodes: NodeInfo[]): Set<string> {
  const regionCounters = new Map<RegionId, number>();
  const failed = new Set<string>();
  for (const node of nodes) {
    const regionId = mapRegionName(parseLocality(node.locality).region);
    const idx = regionCounters.get(regionId) ?? 0;
    regionCounters.set(regionId, idx + 1);
    if (!node.isLive) failed.add(`${regionId}:${idx}`);
  }
  return failed;
}

export function PresenterView() {
  const [tab, setTab] = useState<'globe' | 'console'>('globe');
  const [demo, setDemo] = useState<DemoKind>('multi-region');
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [topology, setTopology] = useState<TopologyPayload | null>(null);
  const [snapshot, setSnapshot] = useState<TopologyPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [httpPort, setHttpPort] = useState(8080);
  const [consoleKey, setConsoleKey] = useState(0);
  const [focused, setFocused] = useState<RegionId | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [stepError, setStepError] = useState<string | null>(null);
  const [stepBusy, setStepBusy] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);
  const didFocusUpgrade = useRef(false);
  const playbookId = useRef<string | null>(null);

  useEffect(() => {
    const cleanup = onMessage((event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'init':
          if (
            msg.demo === 'ha' ||
            msg.demo === 'multi-region' ||
            msg.demo === 'table-locality' ||
            msg.demo === 'upgrade' ||
            msg.demo === 'mcp'
          ) {
            setDemo(msg.demo);
          }
          if (msg.playbook) {
            if (playbookId.current !== msg.playbook.id) {
              playbookId.current = msg.playbook.id;
              setStepIndex(0);
              setStepError(null);
              setStepBusy(false);
              setUpgradeMessage(null);
            }
            setPlaybook(msg.playbook);
          }
          if (msg.httpPort) setHttpPort(msg.httpPort);
          break;
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
          setSnapshot(null);
          break;
        case 'reloadConsole':
          setConsoleKey((k) => k + 1);
          break;
        case 'stepRunning':
          setStepBusy(true);
          setStepError(null);
          if (typeof msg.nodeId === 'number') setUpgradeMessage('Upgrading node…');
          if (typeof msg.index === 'number') setStepIndex(msg.index);
          break;
        case 'upgradeProgress':
          if (typeof msg.message === 'string') setUpgradeMessage(msg.message);
          break;
        case 'stepRan':
          setStepBusy(false);
          setUpgradeMessage(null);
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
  const activeRegions = useMemo(() => {
    const counts = new Map<RegionId, number>();
    for (const n of liveNodes) {
      const id = mapRegionName(parseLocality(n.locality).region);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if (counts.size === 0) return [];
    return REGIONS.filter((r) => counts.has(r.id)).map((r) => ({ ...r, nodes: counts.get(r.id)! }));
  }, [liveNodes]);

  const superRegions =
    playbook?.superRegions ??
    topology?.superRegions ??
    (playbook?.superRegion ? [playbook.superRegion] : [
      { name: 'US', regions: ['us-east'] },
      { name: 'EU', regions: ['eu-west'] },
    ]);
  useEffect(() => {
    if (demo !== 'upgrade') {
      didFocusUpgrade.current = false;
      return;
    }
    if (didFocusUpgrade.current) return;
    if (activeRegions.some((region) => region.id === 'us-west')) {
      didFocusUpgrade.current = true;
      setFocused('us-west');
    }
  }, [demo, activeRegions]);

  const currentStep = playbook?.steps[stepIndex];
  const consoleUrl = `http://127.0.0.1:${httpPort}/?blast=${consoleKey}`;

  const runStep = useCallback((i: number) => {
    postMessage({ type: 'runStep', index: i });
    setStepIndex(i);
  }, []);

  const selectStep = useCallback((i: number) => {
    setStepIndex(i);
    postMessage({ type: 'selectStep', index: i });
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0a0e14] text-gray-200">
      <header className="h-10 flex items-center gap-2 px-3 border-b border-white/10">
        <button
          className={`text-xs px-2 py-1 rounded ${tab === 'globe' ? 'bg-white/10' : 'text-white/50'}`}
          onClick={() => setTab('globe')}
        >
          {demo === 'mcp' ? 'MCP server' : 'Globe'}
        </button>
        <button
          className={`text-xs px-2 py-1 rounded ${tab === 'console' ? 'bg-white/10' : 'text-white/50'}`}
          onClick={() => setTab('console')}
        >
          DB Console
        </button>
        <span className="ml-auto text-[10px] font-mono text-white/40">
          {connected ? 'connected' : 'waiting for cluster'}
          {topology?.focusTable ? ` · ${topology.focusTable}` : ''}
        </span>
      </header>

      {(tab === 'globe' || demo === 'mcp') && (
        <div className={tab === 'globe' ? 'flex-1 flex min-h-0' : 'hidden'}>
          {demo === 'mcp' ? (
            <McpWorkspace connected={connected} />
          ) : (
          <div className="flex-1 relative min-w-0">
            <GlobeScene
              autoRotate={!focused && autoRotate && activeRegions.length > 0}
              focusLat={focused ? REGIONS.find((r) => r.id === focused)?.lat : null}
              focusLng={focused ? REGIONS.find((r) => r.id === focused)?.lng : null}
              onFocusComplete={() => setFocused(null)}
            >
              {activeRegions.length >= 2 &&
                activeRegions.flatMap((region, i) =>
                  activeRegions.slice(i + 1).map((next) => (
                    <ReplicationArc
                      key={`arc-${region.id}-${next.id}`}
                      from={region}
                      to={next}
                      color={region.color}
                      showLatency={false}
                      rebalancing={!!snapshot && liveReplicas.length > 0}
                    />
                  ))
                )}
              {activeRegions.map((region) => (
                <RegionMarker
                  key={region.id}
                  region={region}
                  isFailed={false}
                  isPrimary={region.id === 'us-east'}
                  replicas={liveReplicas.filter((r) => r.regionId === region.id)}
                  failedNodes={failedNodeKeys(liveNodes)}
                  haNodes={demo === 'ha' || demo === 'upgrade' ? liveNodes : undefined}
                  replicaTable={
                    demo === 'ha' || demo === 'upgrade'
                      ? undefined
                      : replicaTableForRegion(
                          region.id,
                          topology?.byTable,
                          topology?.tableLocality
                        )
                  }
                  onClick={() => setFocused(region.id)}
                  showLabels
                  showNodeIcons={demo === 'ha' || demo === 'upgrade'}
                  showDots={demo !== 'ha'}
                />
              ))}
            </GlobeScene>
            {activeRegions.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-[11px] font-mono text-white/50 bg-black/50 border border-white/10 rounded px-3 py-2">
                  {connected ? 'Waiting for live nodes…' : waitingCopy(demo)}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setAutoRotate((prev) => !prev)}
              className="absolute bottom-4 right-4 z-10 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-colors"
              title={autoRotate ? 'Pause rotation' : 'Resume rotation'}
            >
              {autoRotate ? (
                <svg width="12" height="14" viewBox="0 0 12 14" fill="none">
                  <rect x="1" y="1" width="3" height="12" rx="1" fill="white" fillOpacity="0.6" />
                  <rect x="8" y="1" width="3" height="12" rx="1" fill="white" fillOpacity="0.6" />
                </svg>
              ) : (
                <svg width="12" height="14" viewBox="0 0 12 14" fill="none">
                  <path d="M2 1L11 7L2 13V1Z" fill="white" fillOpacity="0.6" />
                </svg>
              )}
            </button>
          </div>
          )}

          {demo === 'ha' ? (
            <HaControlPanel clusterConnected={connected} nodes={liveNodes} />
          ) : (
          <aside className="w-[360px] border-l border-white/10 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-white/10">
              <div className="text-sm font-semibold">{playbook?.title ?? 'Playbook'}</div>
              <div className="text-[10px] text-white/40 mt-1 space-y-0.5">
                {demo === 'mcp' ? (
                  <div>3-node MovR cluster. Drop an index, watch throughput, then ask the MCP server.</div>
                ) : demo === 'upgrade' ? (
                  <>
                    <div>
                      <span className="text-amber-300">us-west</span>
                      {playbook?.upgrade
                        ? ` · ${playbook.upgrade.from} → ${playbook.upgrade.to}`
                        : ''}
                    </div>
                    {liveNodes.map((node) => {
                      const zone = parseLocality(node.locality).zone || `node ${node.nodeId}`;
                      return (
                        <div key={node.nodeId} className={node.isLive ? 'text-white/60' : 'text-red-400'}>
                          {zone} · {node.buildTag ?? '…'} · {node.isLive ? 'live' : 'down'}
                        </div>
                      );
                    })}
                  </>
                ) : (
                  superRegions.map((sr) => (
                    <div key={sr.name}>
                      Super region <span className="text-emerald-400">{sr.name}</span>:{' '}
                      {sr.regions.join(', ')}
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="flex-1 overflow-auto px-3 py-2 space-y-2">
              {playbook?.steps.map((step, i) => (
                <button
                  key={step.id}
                  onClick={() => selectStep(i)}
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
                {upgradeMessage && (
                  <div className="text-[10px] text-amber-200/90">{upgradeMessage}</div>
                )}
                <div className="flex gap-2">
                  <button
                    className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-500 rounded py-1 disabled:opacity-50"
                    disabled={stepBusy}
                    onClick={() => runStep(stepIndex)}
                  >
                    {stepBusy
                      ? 'Working…'
                      : currentStep.action === 'upgrade-node'
                        ? 'Upgrade node'
                        : currentStep.action === 'mcp-prompt'
                          ? 'Show prompt'
                          : 'Run step'}
                  </button>
                  <button
                    className="text-xs bg-white/10 hover:bg-white/20 rounded px-2 py-1 disabled:opacity-50"
                    disabled={stepBusy}
                    onClick={() => setStepIndex(Math.max(0, stepIndex - 1))}
                  >
                    Back
                  </button>
                  <button
                    className="text-xs bg-white/10 hover:bg-white/20 rounded px-2 py-1 disabled:opacity-50"
                    disabled={stepBusy}
                    onClick={() => postMessage({ type: 'runAll' })}
                  >
                    Run all
                  </button>
                </div>
              </div>
            )}
          </aside>
          )}
          {demo === 'upgrade' && (
            <aside className="w-[320px] border-l border-white/10 flex flex-col min-h-0 overflow-auto">
              <div className="px-3 py-3">
                <MovrWorkloadPanel
                  clusterConnected={connected}
                  description="Ride-sharing load against the live cluster. Init once, then run while a node is upgraded."
                />
              </div>
            </aside>
          )}
        </div>
      )}
      {tab === 'console' && (
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
