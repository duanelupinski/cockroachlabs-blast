import { ConnectionManager } from './connectionManager';

export interface TopologyNode {
  nodeId: number;
  address: string;
  locality: string;
  isLive: boolean;
  buildTag?: string;
}

export interface TopologyRange {
  rangeId: number;
  leaseHolder: number;
  replicas: number[];
  votingReplicas: number[];
  startPretty?: string;
}

function parseLiveness(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true';
  return val != null;
}

function parseArray(val: unknown): number[] {
  if (Array.isArray(val)) return val.map(Number);
  if (typeof val === 'string') {
    return val
      .replace(/[{}]/g, '')
      .split(',')
      .filter(Boolean)
      .map(Number);
  }
  return [];
}

export async function queryNodes(conn: ConnectionManager): Promise<TopologyNode[]> {
  const attempts = [
    `SELECT n.node_id, n.address, n.locality, n.is_live
     FROM crdb_internal.gossip_nodes n
     LEFT JOIN crdb_internal.gossip_liveness l ON n.node_id = l.node_id
     WHERE coalesce(l.membership::string, 'active') NOT IN ('decommissioned')
     ORDER BY n.node_id`,
    'SELECT node_id, address, locality, is_live FROM crdb_internal.gossip_nodes ORDER BY node_id',
    'SELECT node_id, address, locality, is_available AS is_live FROM crdb_internal.kv_node_status ORDER BY node_id',
    'SELECT node_id, address, locality, is_live FROM crdb_internal.kv_node_status ORDER BY node_id',
  ];
  for (const sql of attempts) {
    try {
      const r = await conn.query(sql);
      if (r.rows.length > 0) {
        return r.rows.map((row: any) => ({
          nodeId: Number(row.node_id),
          address: row.address || '',
          locality: row.locality || '',
          isLive: parseLiveness(row.is_live),
        }));
      }
    } catch {
      /* next */
    }
  }
  return [];
}

export async function queryNodeBuildTags(conn: ConnectionManager): Promise<Record<number, string>> {
  const attempts = [
    `SELECT node_id, tag AS value FROM crdb_internal.kv_node_status`,
    `SELECT node_id, value FROM crdb_internal.node_build_info WHERE field IN ('Version', 'Tag')`,
  ];
  for (const sql of attempts) {
    try {
      const r = await conn.query(sql);
      const tags: Record<number, string> = {};
      for (const row of r.rows) {
        const tag = String(row.value ?? '').trim();
        if (tag) tags[Number(row.node_id)] = tag;
      }
      if (Object.keys(tags).length > 0) return tags;
    } catch {
      /* next */
    }
  }
  return {};
}

function mapRangeRows(rows: Array<Record<string, unknown>>): TopologyRange[] {
  return rows
    .map((row) => {
      const replicas = parseArray(row.replicas ?? row.replica_localities);
      const voting = parseArray(row.voting_replicas ?? row.replicas);
      return {
        rangeId: Number(row.range_id ?? 0),
        leaseHolder: Number(row.lease_holder ?? replicas[0] ?? 0),
        replicas,
        votingReplicas: voting.length ? voting : replicas,
        startPretty: String(row.start_pretty ?? row.pretty_start_key ?? row.start_key ?? ''),
      };
    })
    .filter((rg) => rg.replicas.length > 0);
}

export async function queryTableRanges(
  conn: ConnectionManager,
  tableRef: string
): Promise<TopologyRange[]> {
  const [db, table] = tableRef.includes('.') ? tableRef.split('.') : ['app', tableRef];
  const attempts = [
    `SHOW RANGES FROM TABLE ${db}.public.${table} WITH DETAILS`,
    `SHOW RANGES FROM TABLE ${db}.${table} WITH DETAILS`,
    `SHOW RANGES FROM TABLE ${db}.${table}`,
  ];
  for (const sql of attempts) {
    try {
      const r = await conn.query(sql);
      if (r.rows.length === 0) continue;
      return mapRangeRows(r.rows as Array<Record<string, unknown>>);
    } catch {
      /* next */
    }
  }

  try {
    const tables = await conn.query(
      `SELECT table_id::text AS table_id, database_name || '.' || name AS table_name
       FROM crdb_internal.tables
       WHERE database_name || '.' || name = $1 OR name = $2`,
      [tableRef, table]
    );
    const tableId = tables.rows[0]?.table_id as string | undefined;
    if (!tableId) return [];
    const r = await conn.query(
      `SELECT range_id, lease_holder, replicas, voting_replicas, start_pretty
       FROM crdb_internal.ranges
       WHERE start_pretty LIKE $1
       LIMIT 200`,
      [`%/Table/${tableId}/%`]
    );
    return r.rows.map((row: any) => ({
      rangeId: Number(row.range_id),
      leaseHolder: Number(row.lease_holder),
      replicas: parseArray(row.replicas),
      votingReplicas: parseArray(row.voting_replicas),
      startPretty: String(row.start_pretty ?? ''),
    }));
  } catch {
    return [];
  }
}

export const DEMO_TABLES = ['app.prices', 'app.orders', 'app.customers'] as const;

export interface RegionZoneCounts {
  replicas: number;
  byZone: Record<string, number>;
}

export type TableReplicaCounts = Record<string, Record<string, RegionZoneCounts>>;

function parseLocalityParts(locality: string): { region: string; zone: string } {
  const region = /region=([^,]+)/.exec(locality)?.[1] ?? 'unknown';
  const zone = /zone=([^,]+)/.exec(locality)?.[1] ?? 'unknown';
  return { region, zone };
}

export function replicaCountsByRegion(
  nodes: TopologyNode[],
  ranges: TopologyRange[]
): Record<string, { replicas: number }> {
  const detailed = replicaCountsByRegionAndZone(nodes, ranges);
  const out: Record<string, { replicas: number }> = {};
  for (const [region, slot] of Object.entries(detailed)) {
    out[region] = { replicas: slot.replicas };
  }
  return out;
}

export function replicaCountsByRegionAndZone(
  nodes: TopologyNode[],
  ranges: TopologyRange[]
): Record<string, RegionZoneCounts> {
  const nodeLoc = new Map<number, { region: string; zone: string }>();
  for (const n of nodes) {
    nodeLoc.set(n.nodeId, parseLocalityParts(n.locality));
  }
  const out: Record<string, RegionZoneCounts> = {};
  for (const range of ranges) {
    for (const id of range.replicas) {
      const loc = nodeLoc.get(id) ?? { region: 'unknown', zone: 'unknown' };
      const slot = out[loc.region] ?? { replicas: 0, byZone: {} };
      slot.replicas++;
      slot.byZone[loc.zone] = (slot.byZone[loc.zone] ?? 0) + 1;
      out[loc.region] = slot;
    }
  }
  return out;
}

export async function queryDemoTableCounts(
  conn: ConnectionManager,
  nodes: TopologyNode[]
): Promise<TableReplicaCounts> {
  const byTable: TableReplicaCounts = {};
  for (const table of DEMO_TABLES) {
    const ranges = await queryTableRanges(conn, table);
    byTable[table] = replicaCountsByRegionAndZone(nodes, ranges);
  }
  return byTable;
}

function shortLocality(raw: string): string {
  const u = raw.toUpperCase();
  if (u.includes('REGIONAL BY ROW')) return 'regional by row';
  if (u.includes('REGIONAL BY TABLE')) return 'regional by table';
  if (u.includes('GLOBAL')) return 'global';
  return '—';
}

export async function queryDemoTableLocality(
  conn: ConnectionManager
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const attempts = [
    'SELECT table_name, locality FROM [SHOW TABLES FROM app]',
    `SELECT name AS table_name, locality FROM crdb_internal.tables WHERE database_name = 'app'`,
  ];
  for (const sql of attempts) {
    try {
      const r = await conn.query(sql);
      for (const row of r.rows as Array<Record<string, unknown>>) {
        const name = String(row.table_name ?? row.name ?? '');
        if (!name) continue;
        out[`app.${name}`] = shortLocality(String(row.locality ?? ''));
      }
      if (Object.keys(out).length > 0) return out;
    } catch {
      /* next */
    }
  }
  return out;
}
