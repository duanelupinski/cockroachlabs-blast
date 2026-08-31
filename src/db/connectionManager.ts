import { Pool, PoolConfig, QueryResult } from 'pg';

export interface ClusterProfile {
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  sslMode: 'disable';
}

export class ConnectionManager {
  private pool: Pool | null = null;
  private activeProfile: ClusterProfile | null = null;

  async connectLocal(port = 26257): Promise<void> {
    await this.connect({
      name: `localhost:${port}`,
      host: 'localhost',
      port,
      database: 'defaultdb',
      user: 'root',
      sslMode: 'disable',
    });
  }

  async connect(profile: ClusterProfile): Promise<void> {
    this.dispose();
    const config: PoolConfig = {
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.user,
      ssl: false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    };
    this.pool = new Pool(config);
    this.pool.on('connect', (client) => {
      client.query('SET allow_unsafe_internals = true').catch(() => {});
    });
    try {
      const client = await this.pool.connect();
      client.release();
      this.activeProfile = profile;
    } catch (err: any) {
      this.pool = null;
      throw err;
    }
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    if (!this.pool) {
      throw new Error('Not connected. Start the Blast cluster first.');
    }
    return this.pool.query<T>(sql, params);
  }

  isConnected(): boolean {
    return this.pool !== null;
  }

  getActiveProfile(): ClusterProfile | null {
    return this.activeProfile;
  }

  dispose(): void {
    if (this.pool) {
      void this.pool.end();
      this.pool = null;
      this.activeProfile = null;
    }
  }
}
