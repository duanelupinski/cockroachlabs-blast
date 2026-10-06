export type RegionId = 'us-east' | 'us-west' | 'eu-west';

export interface RegionConfig {
  id: RegionId;
  label: string;
  city: string;
  lat: number;
  lng: number;
  color: string;
  nodes: number;
}

export interface ReplicaInfo {
  regionId: RegionId;
  nodeIndex: number;
  isVoting: boolean;
  isLeaseholder: boolean;
  votingCount: number;
  replicaCount: number;
}

export interface NodeInfo {
  nodeId: number;
  address: string;
  locality: string;
  isLive: boolean;
  buildTag?: string;
}

export interface RangeInfo {
  rangeId: number;
  leaseHolder: number;
  replicas: number[];
  votingReplicas: number[];
}

export const GLOBE_RADIUS = 2;

export const REGIONS: RegionConfig[] = [
  { id: 'us-east', label: 'US-East', city: 'Virginia', lat: 37.43, lng: -79.1, color: '#60A5FA', nodes: 3 },
  { id: 'us-west', label: 'US-West', city: 'Oregon', lat: 45.52, lng: -122.68, color: '#FBBF24', nodes: 3 },
  { id: 'eu-west', label: 'EU-West', city: 'Ireland', lat: 53.14, lng: -7.6, color: '#34D399', nodes: 3 },
];

export function latLngToVector3(lat: number, lng: number, radius: number = 1): [number, number, number] {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return [x, y, z];
}

export function mapRegionName(crdbRegion: string): RegionId {
  const mapping: Record<string, RegionId> = {
    'us-east': 'us-east',
    'us-east1': 'us-east',
    'us-west': 'us-west',
    'us-west1': 'us-west',
    'eu-west': 'eu-west',
    'eu-west1': 'eu-west',
    'europe-west1': 'eu-west',
  };
  return mapping[crdbRegion] ?? 'us-east';
}

export function parseLocality(locality: string): { region: string; zone: string } {
  const parts: Record<string, string> = {};
  for (const segment of locality.split(',')) {
    const [key, value] = segment.split('=');
    if (key && value) parts[key.trim()] = value.trim();
  }
  return { region: parts['region'] ?? '', zone: parts['zone'] ?? '' };
}
