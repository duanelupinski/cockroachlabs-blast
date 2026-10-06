import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { NodeDot } from './NodeDot';
import { GLOBE_RADIUS, latLngToVector3, parseLocality } from '../../types/globe';
import type { NodeInfo, RegionConfig, ReplicaInfo } from '../../types/globe';

function getNodePositions(
  lat: number,
  lng: number,
  count: number,
  radius: number
): [number, number, number][] {
  if (count <= 1) return [latLngToVector3(lat, lng, radius)];
  const positions: [number, number, number][] = [];
  const spread = 2.5;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const offsetLat = lat + Math.sin(angle) * spread;
    const offsetLng = lng + (Math.cos(angle) * spread) / Math.cos((lat * Math.PI) / 180);
    positions.push(latLngToVector3(offsetLat, offsetLng, radius));
  }
  return positions;
}

function RedistributionPulse({
  position,
  color,
  trigger,
}: {
  position: [number, number, number];
  color: string;
  trigger: number;
}) {
  const ringRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const startTime = useRef(0);
  const active = useRef(false);

  useEffect(() => {
    if (trigger > 0) {
      startTime.current = performance.now() / 1000;
      active.current = true;
    }
  }, [trigger]);

  useFrame(({ clock }) => {
    if (!active.current || !ringRef.current || !matRef.current) return;
    const elapsed = clock.elapsedTime - startTime.current;
    if (elapsed > 1.2) {
      active.current = false;
      matRef.current.opacity = 0;
      return;
    }
    const t = elapsed / 1.2;
    const scale = 1 + t * 3;
    ringRef.current.scale.setScalar(scale);
    matRef.current.opacity = 0.6 * (1 - t);
  });

  return (
    <mesh ref={ringRef} position={position} rotation={[Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.08, 0.1, 32]} />
      <meshBasicMaterial
        ref={matRef}
        color={color}
        transparent
        opacity={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export interface ReplicaTableRow {
  table: string;
  type: string;
  counts: number[];
}

export interface ReplicaTableData {
  zones: string[];
  rows: ReplicaTableRow[];
}

const CYL_W = 12;
const CYL_H = 13;
const CYL_GAP = 1;
const TRI_W = 62;
const TRI_H = 46;
const HA_ZONES = ['us-east-1', 'us-east-2', 'us-east-3'] as const;
const ZONES_BY_REGION: Record<string, readonly string[]> = {
  'us-east': HA_ZONES,
  'us-west': ['us-west-1', 'us-west-2', 'us-west-3'],
  'eu-west': ['eu-west-1', 'eu-west-2', 'eu-west-3'],
};
const TRI_POINTS = [
  { x: 16, y: 11 },
  { x: 46, y: 11 },
  { x: 31, y: 35 },
] as const;

function NodeCylinderIcon({ color, dimmed }: { color: string; dimmed: boolean }) {
  return (
    <svg width={CYL_W} height={CYL_H} viewBox="0 0 10 11" aria-hidden="true" style={{ opacity: dimmed ? 0.45 : 0.9 }}>
      <ellipse cx="5" cy="2.2" rx="3.6" ry="1.5" fill={color} />
      <rect x="1.4" y="2.2" width="7.2" height="6.2" fill={color} />
      <ellipse cx="5" cy="8.4" rx="3.6" ry="1.5" fill={color} />
      <ellipse cx="5" cy="2.2" rx="3.6" ry="1.5" fill="#fff" fillOpacity="0.22" />
    </svg>
  );
}

function HaNodeCylinders({
  nodes,
  color,
  isFailed,
  regionId,
}: {
  nodes: NodeInfo[];
  color: string;
  isFailed: boolean;
  regionId: string;
}) {
  const zones = ZONES_BY_REGION[regionId] ?? HA_ZONES;
  const byZone = zones.map((zone) =>
    nodes
      .filter((n) => parseLocality(n.locality).zone === zone)
      .sort((a, b) => a.nodeId - b.nodeId)
  );
  const live = byZone.map((group) => !isFailed && group.some((n) => n.isLive));
  const [a, b, c] = TRI_POINTS;
  const edges: [typeof a, typeof b, boolean][] = [
    [a, b, live[0] && live[1]],
    [a, c, live[0] && live[2]],
    [b, c, live[1] && live[2]],
  ];
  const pairHalf = (CYL_W + CYL_GAP) / 2;
  return (
    <div className="relative mx-auto mt-0.5" style={{ width: TRI_W, height: TRI_H }}>
      <svg className="absolute inset-0" width={TRI_W} height={TRI_H} aria-hidden="true">
        {edges.map(([from, to, on], i) =>
          on ? (
            <line
              key={`az-${i}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={color}
              strokeWidth="1"
              strokeOpacity="0.55"
            />
          ) : null
        )}
        {byZone.map((group, i) => {
          const pt = TRI_POINTS[i];
          if (!pt || group.length < 2) return null;
          const azLive = live[i];
          return (
            <line
              key={`pair-${zones[i]}`}
              x1={pt.x - pairHalf}
              y1={pt.y}
              x2={pt.x + pairHalf}
              y2={pt.y}
              stroke={azLive ? color : '#EF4444'}
              strokeWidth="1.5"
              strokeOpacity={azLive ? 0.9 : 0.45}
            />
          );
        })}
      </svg>
      {byZone.map((group, i) => {
        const pt = TRI_POINTS[i];
        if (!pt) return null;
        const pair = group.slice(0, 2);
        if (pair.length === 0) return null;
        const offsets = pair.length === 1 ? [0] : [-pairHalf, pairHalf];
        return (
          <div key={zones[i]}>
            {pair.map((node, j) => (
              <div
                key={node.nodeId}
                className="absolute"
                style={{
                  left: pt.x - CYL_W / 2 + (offsets[j] ?? 0),
                  top: pt.y - CYL_H / 2,
                }}
              >
                <NodeCylinderIcon
                  color={isFailed || !node.isLive ? '#EF4444' : color}
                  dimmed={isFailed || !node.isLive}
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function replicaTablePlacement(regionId: string): { transform: string; transformOrigin: string } {
  if (regionId === 'us-west') {
    return {
      transform: 'translate(calc(-100% - 32px), calc(-100% - 16px)) scale(0.9)',
      transformOrigin: 'bottom right',
    };
  }
  if (regionId === 'us-east') {
    return {
      transform: 'translate(calc(-100% - 28px), 28px) scale(0.9)',
      transformOrigin: 'top right',
    };
  }
  return {
    transform: 'translate(28px, 28px) scale(0.9)',
    transformOrigin: 'top left',
  };
}

function ZoneHeader({ zone }: { zone: string }) {
  const match = zone.match(/^(.*)-(\d+)$/);
  if (!match) return <>{zone}</>;
  return (
    <>
      <span className="block">{match[1]}</span>
      <span className="block">{match[2]}</span>
    </>
  );
}

interface RegionMarkerProps {
  region: RegionConfig;
  isFailed: boolean;
  isPrimary: boolean;
  replicas: ReplicaInfo[];
  failedNodes: Set<string>;
  highlightedNodes?: Set<string>;
  highlightedLease?: string | null;
  replicaTable?: ReplicaTableData;
  haNodes?: NodeInfo[];
  onClick: () => void;
  showLabels?: boolean;
  showNodeIcons?: boolean;
  showDots?: boolean;
}

export function RegionMarker({
  region,
  isFailed,
  isPrimary,
  replicas,
  failedNodes,
  highlightedNodes,
  highlightedLease,
  replicaTable,
  haNodes,
  onClick,
  showLabels = true,
  showNodeIcons = false,
  showDots,
}: RegionMarkerProps) {
  const centerPos = useMemo(
    () => latLngToVector3(region.lat, region.lng, GLOBE_RADIUS + 0.05),
    [region.lat, region.lng]
  );

  const nodePositions = useMemo(
    () => getNodePositions(region.lat, region.lng, region.nodes, GLOBE_RADIUS + 0.05),
    [region.lat, region.lng, region.nodes]
  );

  const replicaCount = replicas.reduce((n, r) => n + (r.replicaCount ?? 1), 0);
  const hasLeaseholder = replicas.some((r) => r.isLeaseholder);

  const color = isFailed ? '#EF4444' : region.color;

  const hadLeaseholder = useRef(hasLeaseholder);
  const [lhArrived, setLhArrived] = useState(0);
  useEffect(() => {
    if (hasLeaseholder && !hadLeaseholder.current) {
      setLhArrived((c) => c + 1);
    }
    hadLeaseholder.current = hasLeaseholder;
  }, [hasLeaseholder]);

  const replicaSignature = useMemo(
    () => replicas.map((r) => `${r.replicaCount}`).join(','),
    [replicas]
  );
  const [pulseCount, setPulseCount] = useState(0);
  const prevSignature = useRef(replicaSignature);
  useEffect(() => {
    if (prevSignature.current !== replicaSignature && prevSignature.current !== '') {
      setPulseCount((c) => c + 1);
    }
    prevSignature.current = replicaSignature;
  }, [replicaSignature]);

  const renderDots = showDots ?? !showNodeIcons;

  const replicasByNode = useMemo(() => {
    const map = new Map<number, ReplicaInfo[]>();
    replicas.forEach((r) => {
      const nodeIdx = r.nodeIndex;
      const existing = map.get(nodeIdx) ?? [];
      existing.push(r);
      map.set(nodeIdx, existing);
    });
    return map;
  }, [replicas]);

  return (
    <group>
      <RedistributionPulse position={centerPos} color={color} trigger={pulseCount} />
      <RedistributionPulse position={centerPos} color="#FFD700" trigger={lhArrived} />

      <mesh position={centerPos} onClick={onClick}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {isPrimary && !isFailed && !showNodeIcons && (
        <mesh position={centerPos} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.16, 0.19, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}

      {renderDots &&
        nodePositions.map((pos, i) => {
          const nodeKey = `${region.id}:${i}`;
          return (
            <NodeDot
              key={i}
              position={pos}
              color={color}
              isFailed={isFailed || failedNodes.has(nodeKey)}
              replicas={replicasByNode.get(i) ?? []}
              nodeIndex={i}
              showLabels={showLabels}
              highlighted={highlightedNodes?.has(nodeKey) ?? false}
              highlightedAsLease={highlightedLease === nodeKey}
            />
          );
        })}

      <Html
        position={[centerPos[0], centerPos[1] + 0.2, centerPos[2]]}
        center
        distanceFactor={6}
        style={{ pointerEvents: 'none' }}
      >
        <div
          className={`whitespace-nowrap text-center select-none ${isFailed ? 'opacity-30' : ''}`}
          style={{ transform: 'scale(0.8)' }}
        >
          <div className="text-[10px] font-bold tracking-wider uppercase" style={{ color }}>
            {region.label}
            {isPrimary && <span className="ml-1 text-[8px] opacity-70">PRIMARY</span>}
          </div>
          <div className="text-[8px] text-white/40 font-mono">
            {region.city} &middot; {region.nodes} {region.nodes === 1 ? 'node' : 'nodes'}
          </div>
          {showNodeIcons && (
            <HaNodeCylinders
              nodes={haNodes ?? []}
              color={color}
              isFailed={isFailed}
              regionId={region.id}
            />
          )}
        </div>
      </Html>

      {replicaTable && (
        <Html
          position={[centerPos[0], centerPos[1] + 0.2, centerPos[2]]}
          distanceFactor={6}
          style={{ pointerEvents: 'none' }}
        >
          <div
            className={`select-none ${isFailed ? 'opacity-30' : ''}`}
            style={replicaTablePlacement(region.id)}
          >
            <div
              className="text-left rounded px-1.5 py-1 border"
              style={{
                borderColor: color + '55',
                backgroundColor: 'rgba(6, 9, 16, 0.9)',
              }}
            >
              <div className="text-[7px] font-bold tracking-wide mb-1" style={{ color }}>
                Replica Count
              </div>
              <table className="text-[7px] font-mono text-white/80 border-collapse">
                <thead>
                  <tr className="text-white/40">
                    <th className="pr-1.5 pb-0.5 text-left font-normal align-bottom">Table</th>
                    <th className="pr-1.5 pb-0.5 text-left font-normal align-bottom">Type</th>
                    {replicaTable.zones.map((z) => (
                      <th key={z} className="px-0.5 pb-0.5 text-right font-normal leading-tight">
                        <ZoneHeader zone={z} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {replicaTable.rows.map((row) => (
                    <tr key={row.table}>
                      <td className="pr-1.5 text-left">{row.table}</td>
                      <td className="pr-1.5 text-left text-white/45">{row.type}</td>
                      {row.counts.map((n, i) => (
                        <td key={replicaTable.zones[i]} className="px-0.5 text-right tabular-nums">
                          {n}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}
