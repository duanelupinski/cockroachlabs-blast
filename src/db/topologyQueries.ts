import { ConnectionManager } from './connectionManager';

export interface TopologyNode {
  nodeId: number;
  address: string;
  locality: string;
  isLive: boolean;
}

export interface TopologyRange {
  rangeId: number;
  leaseHolder: number;
  replicas: number[];
  votingReplicas: number[];
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
      return r.rows.map((row: any) => {
        const replicas = parseArray(row.replicas ?? row.replica_localities);
        const voting = parseArray(row.voting_replicas ?? row.replicas);
        return {
          rangeId: Number(row.range_id ?? 0),
          leaseHolder: Number(row.lease_holder ?? replicas[0] ?? 0),
          replicas,
          votingReplicas: voting.length ? voting : replicas,
        };
      }).filter((rg) => rg.replicas.length > 0);
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
    }));
  } catch {
    return [];
  }
}

export function replicaCountsByRegion(
  nodes: TopologyNode[],
  ranges: TopologyRange[]
): Record<string, { voting: number; nonVoting: number; leaseholder: number }> {
  const nodeRegion = new Map<number, string>();
  for (const n of nodes) {
    const m = /region=([^,]+)/.exec(n.locality);
    nodeRegion.set(n.nodeId, m?.[1] ?? 'unknown');
  }
  const out: Record<string, { voting: number; nonVoting: number; leaseholder: number }> = {};
  for (const range of ranges) {
    const voting = new Set(range.votingReplicas);
    for (const id of range.replicas) {
      const region = nodeRegion.get(id) ?? 'unknown';
      const slot = out[region] ?? { voting: 0, nonVoting: 0, leaseholder: 0 };
      if (id === range.leaseHolder) slot.leaseholder++;
      if (voting.has(id)) slot.voting++;
      else slot.nonVoting++;
      out[region] = slot;
    }
  }
  return out;
}
