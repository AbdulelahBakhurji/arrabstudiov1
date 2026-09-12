import type { Pool } from "pg";
import { MIGRATIONS } from "./migrations.js";

export async function applyMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  for (const migration of MIGRATIONS) {
    const existing = await pool.query<{ id: string }>(
      "select id from schema_migrations where id = $1",
      [migration.id],
    );
    if ((existing.rowCount ?? 0) > 0) {
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(migration.sql);
      await client.query("insert into schema_migrations (id) values ($1)", [migration.id]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
