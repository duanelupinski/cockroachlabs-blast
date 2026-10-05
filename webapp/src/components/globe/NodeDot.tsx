import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ReplicaInfo } from '../../types/globe';

interface NodeDotProps {
  position: [number, number, number];
  color: string;
  isFailed: boolean;
  replicas: ReplicaInfo[];
  nodeIndex: number;
  showLabels?: boolean;
  highlighted?: boolean;
  highlightedAsLease?: boolean;
}

export function NodeDot({
  position,
  color,
  isFailed,
  replicas,
  nodeIndex,
  showLabels = true,
  highlighted = false,
  highlightedAsLease = false,
}: NodeDotProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const highlightMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const highlightStartRef = useRef<number>(0);

  const isLeaseholder = replicas.some((r) => r.isLeaseholder);
  const replicaCount = replicas.reduce((n, r) => n + (r.replicaCount ?? r.votingCount ?? 1), 0);

  useEffect(() => {
    if (highlighted) {
      highlightStartRef.current = 0;
    }
  }, [highlighted]);

  useFrame(({ clock }) => {
    if (meshRef.current && isLeaseholder && !isFailed) {
      const scale = 1 + Math.sin(clock.elapsedTime * 3 + nodeIndex) * 0.2;
      meshRef.current.scale.setScalar(scale);
    }

    if (highlighted && highlightMatRef.current) {
      if (highlightStartRef.current === 0) {
        highlightStartRef.current = clock.elapsedTime;
      }
      const elapsed = clock.elapsedTime - highlightStartRef.current;
      const DURATION = 4;
      const FADE_START = 2;
      if (elapsed < FADE_START) {
        highlightMatRef.current.opacity = 0.5 + Math.sin(elapsed * 5) * 0.2;
      } else if (elapsed < DURATION) {
        const fadeT = (elapsed - FADE_START) / (DURATION - FADE_START);
        highlightMatRef.current.opacity = 0.5 * (1 - fadeT);
      } else {
        highlightMatRef.current.opacity = 0;
      }
    }
  });

  const dotColor = isFailed ? '#EF4444' : color;
  const size = isLeaseholder ? 0.04 : 0.03;
  const highlightColor = highlightedAsLease ? '#FFD700' : '#60A5FA';

  return (
    <group position={position}>
      {/* Highlight glow ring — temporary, from "View in Globe" */}
      {highlighted && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[size * 2.8, size * 3.6, 32]} />
          <meshBasicMaterial
            ref={highlightMatRef}
            color={highlightColor}
            transparent
            opacity={0}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Glow */}
      <mesh>
        <sphereGeometry args={[size * 2, 12, 12]} />
        <meshBasicMaterial color={dotColor} transparent opacity={0.08} />
      </mesh>

      {/* Core */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[size, 12, 12]} />
        <meshBasicMaterial
          color={dotColor}
          transparent
          opacity={isFailed ? 0.85 : replicaCount > 0 ? 0.85 : 0.35}
        />
      </mesh>

      {replicaCount > 0 && !isFailed && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[size * 1.3, size * 1.5, 16]} />
          <meshBasicMaterial color={dotColor} transparent opacity={0.3} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
