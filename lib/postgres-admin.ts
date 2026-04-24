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

export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  default: string | null;
  is_primary_key: boolean;
  foreign_reference: string | null;
  is_indexed: boolean;
  ordinal: number;
}

export async function introspectTable(slug: string, table: string): Promise<ColumnInfo[] | null> {
  const schema = `app_${slug}`;
  const client = adminClient();
  await client.connect();
  try {
    const exists = await client.query(
      `SELECT 1 FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'r'`,
      [schema, table]
    );
    if (exists.rowCount === 0) return null;

    const res = await client.query(
      `SELECT
         c.column_name,
         c.data_type,
         c.udt_name,
         c.is_nullable,
         c.column_default,
         c.ordinal_position,
         EXISTS (
           SELECT 1 FROM information_schema.key_column_usage kcu
           JOIN information_schema.table_constraints tc
             ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema   = kcu.table_schema
           WHERE tc.constraint_type = 'PRIMARY KEY'
             AND kcu.table_schema  = c.table_schema
             AND kcu.table_name    = c.table_name
             AND kcu.column_name   = c.column_name
         ) AS is_pk,
         (
           SELECT ccu.table_schema || '.' || ccu.table_name || '.' || ccu.column_name
           FROM information_schema.key_column_usage kcu
           JOIN information_schema.table_constraints tc
             ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema   = kcu.table_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema    = tc.table_schema
           WHERE tc.constraint_type = 'FOREIGN KEY'
             AND kcu.table_schema  = c.table_schema
             AND kcu.table_name    = c.table_name
             AND kcu.column_name   = c.column_name
           LIMIT 1
         ) AS fk_ref,
         EXISTS (
           SELECT 1 FROM pg_indexes i
           WHERE i.schemaname = c.table_schema
             AND i.tablename  = c.table_name
             AND i.indexdef ~* ('\\(' || c.column_name || '\\)|\\(' || c.column_name || ',|, ' || c.column_name || '\\)|, ' || c.column_name || ',')
         ) AS is_indexed
       FROM information_schema.columns c
       WHERE c.table_schema = $1 AND c.table_name = $2
       ORDER BY c.ordinal_position`,
      [schema, table]
    );
    return res.rows.map((r: {
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
      ordinal_position: number;
      is_pk: boolean;
      fk_ref: string | null;
      is_indexed: boolean;
    }) => ({
      name: r.column_name,
      data_type: r.data_type === 'USER-DEFINED' ? r.udt_name : r.data_type,
      is_nullable: r.is_nullable === 'YES',
      default: r.column_default,
      is_primary_key: r.is_pk,
      foreign_reference: r.fk_ref,
      is_indexed: r.is_indexed,
      ordinal: r.ordinal_position,
    }));
  } finally {
    await client.end();
  }
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
