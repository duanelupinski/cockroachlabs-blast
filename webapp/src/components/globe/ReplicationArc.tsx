import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { GLOBE_RADIUS, latLngToVector3, LATENCIES } from '../../types/globe';
import type { RegionConfig } from '../../types/globe';

function DataPacket({
  curvePath,
  color,
  speed,
  offset,
}: {
  curvePath: THREE.QuadraticBezierCurve3;
  color: string;
  speed: number;
  offset: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = (clock.elapsedTime * speed + offset) % 1;
    const pos = curvePath.getPoint(t);
    if (meshRef.current) {
      meshRef.current.position.copy(pos);
    }
    if (glowRef.current) {
      glowRef.current.position.copy(pos);
      const pulse = 1 + Math.sin(clock.elapsedTime * 8) * 0.3;
      glowRef.current.scale.setScalar(pulse);
    }
  });

  return (
    <group>
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} />
      </mesh>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.018, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

function RebalancingPulse({
  curvePath,
  color,
  offset,
}: {
  curvePath: THREE.QuadraticBezierCurve3;
  color: string;
  offset: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = (clock.elapsedTime * 0.3 + offset) % 1;
    const pos = curvePath.getPoint(t);
    if (meshRef.current) {
      meshRef.current.position.copy(pos);
      const pulse = 0.8 + Math.sin(clock.elapsedTime * 6) * 0.2;
      meshRef.current.scale.setScalar(pulse);
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.025, 8, 8]} />
      <meshBasicMaterial color={color} transparent opacity={0.8} />
    </mesh>
  );
}

interface ReplicationArcProps {
  from: RegionConfig;
  to: RegionConfig;
  color: string;
  showLatency: boolean;
  rebalancing: boolean;
}

export function ReplicationArc({ from, to, color, showLatency, rebalancing }: ReplicationArcProps) {
  const { curvePoints, curvePath } = useMemo(() => {
    const start = new THREE.Vector3(
      ...latLngToVector3(from.lat, from.lng, GLOBE_RADIUS + 0.05)
    );
    const end = new THREE.Vector3(
      ...latLngToVector3(to.lat, to.lng, GLOBE_RADIUS + 0.05)
    );

    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const midLen = mid.length();
    const arcHeight = start.distanceTo(end) * 0.4;
    mid.multiplyScalar((GLOBE_RADIUS + 0.05 + arcHeight) / midLen);

    const path = new THREE.QuadraticBezierCurve3(start, mid, end);
    const pts = path
      .getPoints(50)
      .map((p) => [p.x, p.y, p.z] as [number, number, number]);
    return { curvePoints: pts, curvePath: path };
  }, [from, to]);

  const latencyKey = `${from.id}:${to.id}`;
  const latency = LATENCIES[latencyKey] ?? 0;

  const midPoint = useMemo(() => {
    const midIdx = Math.floor(curvePoints.length / 2);
    return curvePoints[midIdx];
  }, [curvePoints]);

  const packetSpeed = latency > 100 ? 0.15 : latency > 50 ? 0.25 : 0.35;

  const arcColor = rebalancing ? '#fb923c' : color;
  const arcOpacity = rebalancing ? 0.6 : 0.3;
  const arcWidth = rebalancing ? 2 : 1.5;

  return (
    <group>
      <Line points={curvePoints} color={arcColor} lineWidth={arcWidth} opacity={arcOpacity} transparent />

      {/* Normal data packets */}
      <DataPacket curvePath={curvePath} color={color} speed={packetSpeed} offset={0} />
      <DataPacket curvePath={curvePath} color={color} speed={packetSpeed} offset={0.5} />

      {/* Rebalancing pulse dots — only during rebalancing */}
      {rebalancing && (
        <>
          <RebalancingPulse curvePath={curvePath} color="#fb923c" offset={0} />
          <RebalancingPulse curvePath={curvePath} color="#fb923c" offset={0.25} />
          <RebalancingPulse curvePath={curvePath} color="#fb923c" offset={0.5} />
          <RebalancingPulse curvePath={curvePath} color="#fb923c" offset={0.75} />
        </>
      )}

      {showLatency && midPoint && (
        <Html position={midPoint} center distanceFactor={6} style={{ pointerEvents: 'none' }}>
          <div
            className="text-[8px] font-mono px-1.5 py-0.5 rounded-full border whitespace-nowrap"
            style={{
              color,
              borderColor: color + '40',
              backgroundColor: 'rgba(6, 9, 16, 0.8)',
            }}
          >
            {latency}ms
          </div>
        </Html>
      )}
    </group>
  );
}
