import { Client } from 'pg';

function adminClient() {
  return new Client({ connectionString: process.env.DATABASE_URL });
}

export async function provisionAppSchema(slug: string, password: string) {
  const schema = `app_${slug}`;
  const user = `app_${slug}`;
  const client = adminClient();
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.query(`CREATE USER "${user}" WITH PASSWORD '${password.replace(/'/g, "''")}'`);
    await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${user}"`);
    await client.query(`GRANT CREATE ON SCHEMA "${schema}" TO "${user}"`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT ALL ON TABLES TO "${user}"`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT ALL ON SEQUENCES TO "${user}"`);
  } finally {
    await client.end();
  }
  return { schema, user };
}

export async function dropAppSchema(slug: string) {
  const schema = `app_${slug}`;
  const user = `app_${slug}`;
  const client = adminClient();
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.query(`DROP USER IF EXISTS "${user}"`);
  } finally {
    await client.end();
  }
}

export interface TableStats {
  table: string;
  rows: number;
  size_bytes: number;
  last_activity: string | null;
  inserts: number;
  updates: number;
  deletes: number;
}

export async function introspectSchema(slug: string): Promise<TableStats[]> {
  const schema = `app_${slug}`;
  const client = adminClient();
  await client.connect();
  try {
    const res = await client.query(
      `SELECT
         c.relname AS table_name,
         COALESCE(s.n_live_tup, 0)::bigint AS rows,
         pg_total_relation_size(c.oid)::bigint AS size_bytes,
         GREATEST(s.last_autovacuum, s.last_vacuum, s.last_autoanalyze, s.last_analyze) AS last_activity,
         COALESCE(s.n_tup_ins, 0)::bigint AS inserts,
         COALESCE(s.n_tup_upd, 0)::bigint AS updates,
         COALESCE(s.n_tup_del, 0)::bigint AS deletes
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE n.nspname = $1 AND c.relkind = 'r'
       ORDER BY c.relname`,
      [schema]
    );
    return res.rows.map((r: {
      table_name: string;
      rows: string | number;
      size_bytes: string | number;
      last_activity: Date | null;
      inserts: string | number;
      updates: string | number;
      deletes: string | number;
    }) => ({
      table: r.table_name,
      rows: Number(r.rows),
      size_bytes: Number(r.size_bytes),
      last_activity: r.last_activity ? new Date(r.last_activity).toISOString() : null,
      inserts: Number(r.inserts),
      updates: Number(r.updates),
      deletes: Number(r.deletes),
    }));
  } finally {
    await client.end();
  }
}
