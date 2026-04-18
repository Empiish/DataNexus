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

export async function introspectSchema(slug: string): Promise<{ table: string; rows: number }[]> {
  const schema = `app_${slug}`;
  const client = adminClient();
  await client.connect();
  try {
    const tablesRes = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
      [schema]
    );
    const tables = tablesRes.rows.map((r: { table_name: string }) => r.table_name);
    const counts = await Promise.all(
      tables.map(async (t: string) => {
        const res = await client.query(`SELECT COUNT(*) FROM "${schema}"."${t}"`);
        return { table: t, rows: parseInt(res.rows[0].count, 10) };
      })
    );
    return counts;
  } finally {
    await client.end();
  }
}
