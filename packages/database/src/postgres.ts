import pg from "pg";
import type { DatabaseConfig, DatabaseConnection } from "./types.js";

export class PostgresConnection implements DatabaseConnection {
  readonly pool: pg.Pool;

  constructor(config: DatabaseConfig) {
    this.pool = new pg.Pool({
      connectionString: config.connectionString,
      max: 5,
      connectionTimeoutMillis: 5_000,
    });
  }

  async ping(): Promise<boolean> {
    const result = await this.pool.query("select 1 as ok");
    return result.rowCount === 1;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createPostgresConnection(config: DatabaseConfig): DatabaseConnection {
  return new PostgresConnection(config);
}
