import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { NodeDot } from './NodeDot';
import { GLOBE_RADIUS, latLngToVector3 } from '../../types/globe';
import type { RegionConfig, ReplicaInfo } from '../../types/globe';

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

interface RegionMarkerProps {
  region: RegionConfig;
  isFailed: boolean;
  isPrimary: boolean;
  replicas: ReplicaInfo[];
  failedNodes: Set<string>;
  highlightedNodes?: Set<string>;
  highlightedLease?: string | null;
  onClick: () => void;
  showLabels?: boolean;
}

export function RegionMarker({
  region,
  isFailed,
  isPrimary,
  replicas,
  failedNodes,
  highlightedNodes,
  highlightedLease,
  onClick,
  showLabels = true,
}: RegionMarkerProps) {
  const centerPos = useMemo(
    () => latLngToVector3(region.lat, region.lng, GLOBE_RADIUS + 0.05),
    [region.lat, region.lng]
  );

  const nodePositions = useMemo(
    () => getNodePositions(region.lat, region.lng, region.nodes, GLOBE_RADIUS + 0.05),
    [region.lat, region.lng, region.nodes]
  );

  const votingCount = replicas.filter((r) => r.isVoting).length;
  const nonVotingCount = replicas.filter((r) => !r.isVoting).length;
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
    () => replicas.map((r) => `${r.isVoting}:${r.isLeaseholder}`).join(','),
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

  const replicasByNode = useMemo(() => {
    const map = new Map<number, ReplicaInfo[]>();
    replicas.forEach((r, i) => {
      const nodeIdx = i % region.nodes;
      const existing = map.get(nodeIdx) ?? [];
      existing.push(r);
      map.set(nodeIdx, existing);
    });
    return map;
  }, [replicas, region.nodes]);

  return (
    <group>
      <RedistributionPulse position={centerPos} color={color} trigger={pulseCount} />
      <RedistributionPulse position={centerPos} color="#FFD700" trigger={lhArrived} />

      <mesh position={centerPos} onClick={onClick}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {isPrimary && !isFailed && (
        <mesh position={centerPos} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.16, 0.19, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}

      {nodePositions.map((pos, i) => {
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
          {replicas.length > 0 && showLabels && (
            <div className="flex items-center justify-center gap-1 mt-0.5">
              {votingCount > 0 && (
                <span className="text-[7px] px-1 rounded bg-white/10 text-white/60">
                  {votingCount}V
                </span>
              )}
              {nonVotingCount > 0 && (
                <span className="text-[7px] px-1 rounded bg-white/5 text-white/40">
                  {nonVotingCount}NV
                </span>
              )}
              {hasLeaseholder && (
                <span
                  className="text-[7px] px-1 rounded font-bold"
                  style={{ backgroundColor: color + '30', color }}
                >
                  LH
                </span>
              )}
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}
