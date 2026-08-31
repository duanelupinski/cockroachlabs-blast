import { useRef, useMemo, useState, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as topojson from 'topojson-client';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import landTopo from 'world-atlas/land-110m.json';
import { GLOBE_RADIUS, latLngToVector3 } from '../../types/globe';
import * as THREE from 'three';

function extractCoastlines(radius: number): [number, number, number][][] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topo = landTopo as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geojson: any = topojson.feature(topo, topo.objects.land);

  const lines: [number, number, number][][] = [];

  const processRing = (ring: number[][]) => {
    if (ring.length < 2) return;
    const pts: [number, number, number][] = ring.map(([lng, lat]) =>
      latLngToVector3(lat, lng, radius)
    );
    lines.push(pts);
  };

  const processGeometry = (geom: {
    type: string;
    coordinates: number[][][][] | number[][][];
  }) => {
    if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates as number[][][]) {
        processRing(ring);
      }
    } else if (geom.type === 'MultiPolygon') {
      for (const polygon of geom.coordinates as number[][][][]) {
        for (const ring of polygon) {
          processRing(ring);
        }
      }
    }
  };

  if (geojson.features) {
    for (const feat of geojson.features) {
      processGeometry(feat.geometry);
    }
  } else if (geojson.geometry) {
    processGeometry(geojson.geometry);
  }

  return lines;
}

function GraticuleGrid() {
  const lines = useMemo(() => {
    const result: [number, number, number][][] = [];

    for (let lat = -60; lat <= 60; lat += 30) {
      const ring: [number, number, number][] = [];
      for (let lng = 0; lng <= 360; lng += 4) {
        ring.push(latLngToVector3(lat, lng - 180, GLOBE_RADIUS));
      }
      result.push(ring);
    }

    const equator: [number, number, number][] = [];
    for (let lng = 0; lng <= 360; lng += 2) {
      equator.push(latLngToVector3(0, lng - 180, GLOBE_RADIUS));
    }
    result.push(equator);

    for (let lng = 0; lng < 360; lng += 30) {
      const meridian: [number, number, number][] = [];
      for (let lat = -90; lat <= 90; lat += 4) {
        meridian.push(latLngToVector3(lat, lng - 180, GLOBE_RADIUS));
      }
      result.push(meridian);
    }

    return result;
  }, []);

  return (
    <group>
      {lines.map((pts, i) => (
        <Line
          key={`grid-${i}`}
          points={pts}
          color="#1E3A5F"
          lineWidth={0.4}
          opacity={0.08}
          transparent
        />
      ))}
    </group>
  );
}

function Coastlines() {
  const coastlines = useMemo(() => extractCoastlines(GLOBE_RADIUS + 0.002), []);

  return (
    <group>
      {coastlines.map((pts, i) => (
        <Line
          key={`coast-${i}`}
          points={pts}
          color="#3B82F6"
          lineWidth={1}
          opacity={0.35}
          transparent
        />
      ))}
    </group>
  );
}

function RotatingGroup({
  children,
  paused,
}: {
  children: ReactNode;
  paused: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (groupRef.current && !paused) {
      groupRef.current.rotation.y += 0.001;
    }
  });

  return (
    <group ref={groupRef}>
      <GraticuleGrid />
      <Coastlines />
      {children}
    </group>
  );
}

/** Smoothly animates the camera to look at a target position on the globe */
function CameraController({
  targetPosition,
  onArrived,
}: {
  targetPosition: THREE.Vector3 | null;
  onArrived?: () => void;
}) {
  const arrivedRef = useRef(false);

  useFrame(({ camera }) => {
    if (!targetPosition) {
      arrivedRef.current = false;
      return;
    }

    // Position camera at a distance from the globe, facing the target point
    const cameraDistance = camera.position.length() || 5;
    const goalPos = targetPosition.clone().normalize().multiplyScalar(cameraDistance);

    // Lerp camera position
    camera.position.lerp(goalPos, 0.04);
    camera.lookAt(0, 0, 0);

    // Check if arrived
    if (!arrivedRef.current && camera.position.distanceTo(goalPos) < 0.05) {
      arrivedRef.current = true;
      onArrived?.();
    }
  });

  return null;
}

interface GlobeSceneProps {
  children: ReactNode;
  focusLat?: number | null;
  focusLng?: number | null;
  autoRotate?: boolean;
  onFocusComplete?: () => void;
  onReady?: () => void;
  onError?: (err: string) => void;
}

export function GlobeScene({
  children,
  focusLat,
  focusLng,
  autoRotate = true,
  onFocusComplete,
  onReady,
  onError,
}: GlobeSceneProps) {
  const [webglSupported] = useState(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return !!gl;
    } catch {
      return false;
    }
  });

  const isFocusing = focusLat != null && focusLng != null;
  const targetPosition = useMemo(() => {
    if (focusLat == null || focusLng == null) return null;
    const [x, y, z] = latLngToVector3(focusLat, focusLng, GLOBE_RADIUS);
    return new THREE.Vector3(x, y, z);
  }, [focusLat, focusLng]);

  if (!webglSupported) {
    onError?.('WebGL is not available in this environment');
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-sm font-mono mb-2">WebGL not available</div>
          <div className="text-white/30 text-xs">3D globe requires WebGL support</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <Canvas
        camera={{ position: [0, 1.5, 5], fov: 45 }}
        style={{ background: 'transparent' }}
        gl={{ failIfMajorPerformanceCaveat: false, antialias: true }}
        onCreated={() => onReady?.()}
      >
        <ambientLight intensity={0.3} />
        <pointLight position={[10, 10, 10]} intensity={0.5} />

        <CameraController
          targetPosition={targetPosition}
          onArrived={onFocusComplete}
        />

        <RotatingGroup paused={isFocusing || !autoRotate}>{children}</RotatingGroup>

        <OrbitControls
          enablePan={false}
          enableZoom={true}
          minDistance={3}
          maxDistance={8}
          autoRotate={false}
          makeDefault
        />
      </Canvas>
    </div>
  );
}
