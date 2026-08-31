import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
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
  const isVoting = replicas.some((r) => r.isVoting);
  const isNonVoting = replicas.length > 0 && !isVoting;
  const votingCount = replicas.reduce((n, r) => n + (r.votingCount ?? (r.isVoting ? 1 : 0)), 0);

  const badge = isLeaseholder
    ? { text: votingCount > 0 ? `LH ${votingCount}V` : 'LH', color: '#FFD700', bg: 'rgba(255, 215, 0, 0.15)' }
    : isVoting
      ? { text: `${votingCount}V`, color, bg: 'rgba(255, 255, 255, 0.1)' }
      : isNonVoting
        ? { text: 'NV', color: '#9CA3AF', bg: 'rgba(255, 255, 255, 0.05)' }
        : null;

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
        <meshBasicMaterial color={dotColor} transparent opacity={isFailed ? 0.03 : 0.08} />
      </mesh>

      {/* Core */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[size, 12, 12]} />
        <meshBasicMaterial
          color={dotColor}
          transparent
          opacity={isFailed ? 0.15 : isNonVoting ? 0.4 : 0.85}
        />
      </mesh>

      {/* Non-voting ring */}
      {isNonVoting && !isFailed && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[size * 1.4, size * 1.7, 16]} />
          <meshBasicMaterial color={dotColor} transparent opacity={0.25} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Leaseholder ring */}
      {isLeaseholder && !isFailed && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[size * 1.8, size * 2.2, 24]} />
          <meshBasicMaterial color={dotColor} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Voting ring */}
      {isVoting && !isLeaseholder && !isFailed && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[size * 1.3, size * 1.5, 16]} />
          <meshBasicMaterial color={dotColor} transparent opacity={0.3} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Badge label */}
      {badge && !isFailed && showLabels && (
        <Html center distanceFactor={6} style={{ pointerEvents: 'none' }}>
          <div
            className="text-[7px] font-bold px-1 rounded select-none whitespace-nowrap"
            style={{
              color: badge.color,
              backgroundColor: badge.bg,
              border: `1px solid ${badge.color}40`,
              transform: 'translateY(-10px)',
              textShadow: isLeaseholder ? `0 0 4px ${badge.color}` : 'none',
            }}
          >
            {badge.text}
          </div>
        </Html>
      )}

      {/* Failed indicator */}
      {isFailed && (
        <Html center distanceFactor={6} style={{ pointerEvents: 'none' }}>
          <div
            className="text-[9px] font-bold select-none"
            style={{
              color: '#EF4444',
              transform: 'translateY(-10px)',
              textShadow: '0 0 6px rgba(239, 68, 68, 0.8)',
            }}
          >
            ✕
          </div>
        </Html>
      )}
    </group>
  );
}
