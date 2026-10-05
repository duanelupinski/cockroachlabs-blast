import { useEffect, useRef, useState } from 'react';
import { parseLocality } from '../../types/globe';
import type { NodeInfo } from '../../types/globe';
import { postMessage, onMessage } from '../../hooks/useVsCode';
import { MovrWorkloadPanel } from '../movr/MovrWorkloadPanel';

interface HaControlPanelProps {
  clusterConnected: boolean;
  nodes: NodeInfo[];
}

const HA_ZONES = ['us-east-1', 'us-east-2', 'us-east-3'] as const;

function isEastOnlyThreeNode(nodes: NodeInfo[]): boolean {
  if (nodes.length === 0) return false;
  const regions = new Set(nodes.map((n) => parseLocality(n.locality).region));
  if (regions.size !== 1 || !regions.has('us-east')) return false;
  const byZone = new Map<string, number>();
  for (const n of nodes) {
    const zone = parseLocality(n.locality).zone;
    byZone.set(zone, (byZone.get(zone) ?? 0) + 1);
  }
  return HA_ZONES.every((z) => (byZone.get(z) ?? 0) === 1);
}

function canAddAzNodes(nodes: NodeInfo[]): boolean {
  return isEastOnlyThreeNode(nodes);
}

function canExpandMultiRegion(nodes: NodeInfo[]): boolean {
  return isEastOnlyThreeNode(nodes);
}

function canScaleDown(nodes: NodeInfo[]): boolean {
  return nodes.length > 3;
}

export function HaControlPanel({ clusterConnected, nodes }: HaControlPanelProps) {
  const [pending, setPending] = useState<Map<number, 'kill' | 'restart'>>(new Map());
  const [addingNodes, setAddingNodes] = useState(false);
  const [removingNodes, setRemovingNodes] = useState(false);
  const [scaleMessage, setScaleMessage] = useState<string | null>(null);
  const prevLive = useRef<Map<number, boolean>>(new Map());

  useEffect(() => {
    const prev = prevLive.current;
    const changed = new Set<number>();
    for (const node of nodes) {
      if (prev.get(node.nodeId) !== node.isLive) changed.add(node.nodeId);
    }
    if (changed.size > 0) {
      setPending((p) => {
        const next = new Map(p);
        for (const id of changed) next.delete(id);
        return next;
      });
    }
    prevLive.current = new Map(nodes.map((n) => [n.nodeId, n.isLive]));
  }, [nodes]);

  useEffect(() => {
    if (!canAddAzNodes(nodes) && !canExpandMultiRegion(nodes)) setAddingNodes(false);
  }, [nodes]);

  useEffect(() => {
    return onMessage((event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'nodeActionComplete') {
        setPending((p) => {
          if (!p.has(msg.nodeId)) return p;
          const next = new Map(p);
          next.delete(msg.nodeId);
          return next;
        });
      } else if (msg.type === 'addHaAzNodesComplete') {
        setAddingNodes(false);
      } else if (msg.type === 'removeHaAzNodesComplete') {
        setRemovingNodes(false);
        setScaleMessage(null);
      } else if (msg.type === 'haScaleProgress' && typeof msg.message === 'string') {
        setScaleMessage(msg.message);
      } else if (msg.type === 'error') {
        setAddingNodes(false);
        setRemovingNodes(false);
        setScaleMessage(null);
      }
    });
  }, []);

  const liveCount = nodes.filter((n) => n.isLive).length;
  const sorted = [...nodes].sort((a, b) => a.nodeId - b.nodeId);
  const showAddAzNodes = clusterConnected && canAddAzNodes(nodes) && !removingNodes;
  const showExpandMultiRegion = clusterConnected && canExpandMultiRegion(nodes) && !removingNodes;
  const showRemoveAzNodes = clusterConnected && canScaleDown(nodes);
  const regionIds = [...new Set(nodes.map((n) => parseLocality(n.locality).region).filter(Boolean))];
  const isMultiRegion = regionIds.length > 1;
  const twoPerAz = clusterConnected && !isMultiRegion && nodes.length >= 6;

  return (
    <aside className="w-[360px] border-l border-white/10 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-white/10">
        <div className="text-sm font-semibold">High availability</div>
        <div className="text-[10px] text-white/40 mt-1">
          {isMultiRegion
            ? 'US-East, US-West, and EU-West. Kill any node and the cluster stays up.'
            : twoPerAz
              ? 'Two nodes per AZ. Kill any node and the cluster stays up.'
              : 'One region, three AZs. Kill a node and the cluster stays up.'}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 py-3 space-y-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2">
            {isMultiRegion ? 'Regions' : 'Region'}
          </div>
          {(isMultiRegion
            ? ['us-east', 'us-west', 'eu-west']
                .map((id) => ({
                  id,
                  live: nodes.filter((n) => parseLocality(n.locality).region === id && n.isLive).length,
                  total: nodes.filter((n) => parseLocality(n.locality).region === id).length,
                }))
                .filter((r) => r.total > 0)
            : [
                {
                  id: 'us-east',
                  live: liveCount,
                  total: nodes.length || 3,
                },
              ]
          ).map((row) => (
            <div
              key={row.id}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-[10px] border mb-0.5 ${
                row.live === 0
                  ? 'bg-red-600/10 border-red-500/20 text-red-400'
                  : 'bg-white/5 border-white/10 text-white/70'
              }`}
            >
              <div className={`w-2 h-2 rounded-full ${row.live === 0 ? 'bg-red-400' : 'bg-sky-400'}`} />
              <span className="flex-1">
                {row.id === 'us-east' ? 'US-East' : row.id === 'us-west' ? 'US-West' : 'EU-West'}
              </span>
              <span className="font-mono text-white/40">
                {row.live}/{row.total}
              </span>
              {row.live === 0 && <span className="text-red-400 text-[8px]">DOWN</span>}
            </div>
          ))}
        </div>

        {clusterConnected && sorted.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2">Nodes</div>
            <div className="flex flex-col gap-0.5">
              {sorted.map((node) => {
                const zone = parseLocality(node.locality).zone || 'unknown';
                return (
                  <div
                    key={node.nodeId}
                    className="flex items-center gap-2 px-2 py-1 text-[10px] rounded hover:bg-white/5"
                  >
                    <div className={`w-1.5 h-1.5 rounded-full ${node.isLive ? 'bg-green-400' : 'bg-red-400'}`} />
                    <span className="font-mono text-white/50">n{node.nodeId}</span>
                    <span className="text-white/30 flex-1">
                      {isMultiRegion
                        ? `${parseLocality(node.locality).region}/${zone}`
                        : zone}
                    </span>
                    {!node.isLive && !pending.has(node.nodeId) && (
                      <span className="text-red-400 text-[8px]">DEAD</span>
                    )}
                    {pending.has(node.nodeId) ? (
                      <span
                        className={`px-1 py-0.5 rounded border text-[8px] animate-pulse ${
                          pending.get(node.nodeId) === 'kill'
                            ? 'border-red-500/30 text-red-400 bg-red-500/10'
                            : 'border-green-500/30 text-green-400 bg-green-500/10'
                        }`}
                      >
                        {pending.get(node.nodeId) === 'kill' ? 'Killing...' : 'Starting...'}
                      </span>
                    ) : node.isLive ? (
                      <button
                        onClick={() => {
                          setPending((p) => new Map(p).set(node.nodeId, 'kill'));
                          postMessage({ type: 'killNode', nodeId: node.nodeId });
                        }}
                        className="px-1 py-0.5 rounded border border-red-500/20 text-red-400/60 text-[8px] hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/10 cursor-pointer"
                      >
                        Kill
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setPending((p) => new Map(p).set(node.nodeId, 'restart'));
                          postMessage({ type: 'restartNode', nodeId: node.nodeId });
                        }}
                        className="px-1 py-0.5 rounded border border-green-500/20 text-green-400/60 text-[8px] hover:text-green-400 hover:border-green-500/40 hover:bg-green-500/10 cursor-pointer"
                      >
                        Start
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {showAddAzNodes && (
          <button
            disabled={addingNodes}
            onClick={() => {
              setAddingNodes(true);
              postMessage({ type: 'addHaAzNodes' });
            }}
            className="w-full text-[10px] bg-sky-600/80 hover:bg-sky-500 disabled:opacity-40 rounded py-1.5"
          >
            {addingNodes ? 'Adding nodes…' : 'Add a node in each AZ'}
          </button>
        )}

        {showExpandMultiRegion && (
          <button
            disabled={addingNodes}
            onClick={() => {
              setAddingNodes(true);
              postMessage({ type: 'addHaMultiRegion' });
            }}
            className="w-full text-[10px] bg-amber-600/80 hover:bg-amber-500 disabled:opacity-40 rounded py-1.5"
          >
            {addingNodes ? 'Expanding…' : 'Expand to multi-region (9 nodes)'}
          </button>
        )}

        {showRemoveAzNodes && (
          <div className="space-y-1">
            <button
              disabled={removingNodes}
              onClick={() => {
                setRemovingNodes(true);
                setScaleMessage('Setting replication factor to 3…');
                postMessage({ type: 'removeHaAzNodes' });
              }}
              className="w-full text-[10px] bg-white/10 hover:bg-white/20 disabled:opacity-40 rounded py-1.5"
            >
              {removingNodes ? 'Scaling down…' : 'Scale down to 3 nodes'}
            </button>
            {removingNodes && scaleMessage && (
              <div className="text-[10px] font-mono text-sky-300/80">{scaleMessage}</div>
            )}
          </div>
        )}

        <div className="border-t border-white/10 pt-3">
          <MovrWorkloadPanel
            clusterConnected={clusterConnected}
            description="Ride-sharing load against the live cluster. Init once, then run while you kill a node."
          />
        </div>
      </div>
    </aside>
  );
}
