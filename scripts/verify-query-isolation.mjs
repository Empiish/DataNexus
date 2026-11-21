#!/usr/bin/env node
// End-to-end check of the /api/v1/query tenant isolation (DN-1) against a REAL
// Postgres over TCP: creates two throwaway app roles, sets up the query role
// with lib/query-roles.ts, logs in AS that role with the derived password (the
// same connection settings as app/api/v1/query/route.ts), and runs the escape
// attempts from the 2026-11-21 security review.
//
// NEVER point this at the DataNexus database. Use a throwaway cluster, e.g.:
//   docker run --rm -d --name dn-verify -e POSTGRES_PASSWORD=verify \
//     -p 127.0.0.1:55432:5432 pgvector/pgvector:pg16
//   VERIFY_THROWAWAY=yes VERIFY_ADMIN_URL=postgres://postgres:verify@127.0.0.1:55432/postgres \
//     node scripts/verify-query-isolation.mjs
//   docker rm -f dn-verify
//
// Needs Node >= 22.18 (or 22.6+ with --experimental-strip-types) to load the .ts module.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { Client } = createRequire(join(root, 'package.json'))('pg');
const qr = await import(pathToFileURL(join(root, 'lib', 'query-roles.ts')).href);

const ADMIN_URL = process.env.VERIFY_ADMIN_URL;
if (process.env.VERIFY_THROWAWAY !== 'yes' || !ADMIN_URL) {
  console.error('Refusing: set VERIFY_THROWAWAY=yes and VERIFY_ADMIN_URL (superuser URL of a THROWAWAY Postgres).');
  process.exit(2);
}
const SECRET = 'verify-only-secret-'.padEnd(48, 'v');
const A = 'app_vq_a', B = 'app_vq_b', LIMIT = 3, TIMEOUT_MS = 1500;
process.env.DATANEXUS_QUERY_CONNECTION_LIMIT = String(LIMIT);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS ${name}`); } else { fail++; console.log(`FAIL ${name} ${extra}`); }
};

const admin = new Client({ connectionString: ADMIN_URL });
await admin.connect();
const adminExec = (text, values) => admin.query(text, values);

// Guard: this must not be a DataNexus cluster.
const guard = (await admin.query(`
  SELECT (SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'app\\_%' AND nspname NOT IN ($1, $2))::int AS app_schemas,
         (SELECT count(*) FROM pg_class WHERE relname = 'ConnectionKey')::int AS dn_tables,
         (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su`, [A, B])).rows[0];
if (guard.app_schemas > 0 || guard.dn_tables > 0) {
  console.error('Refusing: this database has app_* schemas or a ConnectionKey table. Use a throwaway cluster.');
  process.exit(2);
}
if (!guard.su) { console.error('VERIFY_ADMIN_URL must be a superuser (like DataNexus DATABASE_URL today).'); process.exit(2); }
const adminUser = (await admin.query('SELECT current_user AS u')).rows[0].u;

async function cleanup() {
  for (const s of [A, B]) {
    await admin.query(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
    await admin.query(`DROP ROLE IF EXISTS "${qr.QUERY_ROLE_PREFIX}${s}"`);
    await admin.query(`DROP ROLE IF EXISTS "${s}"`);
  }
  await admin.query(`DROP TABLE IF EXISTS public.vq_secret`);
}
await cleanup();

// Same SQL as lib/postgres-admin.ts provisionAppSchema.
for (const s of [A, B]) {
  await admin.query(`CREATE SCHEMA "${s}"`);
  await admin.query(`CREATE USER "${s}" WITH PASSWORD 'unused-${Math.random()}'`);
  await admin.query(`GRANT USAGE ON SCHEMA "${s}" TO "${s}"`);
  await admin.query(`GRANT CREATE ON SCHEMA "${s}" TO "${s}"`);
  await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${s}" GRANT ALL ON TABLES TO "${s}"`);
  await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${s}" GRANT ALL ON SEQUENCES TO "${s}"`);
}
await admin.query(`CREATE TABLE "${B}".children (name text); ALTER TABLE "${B}".children OWNER TO "${B}"`);
await admin.query(`INSERT INTO "${B}".children VALUES ('other-tenant-row')`);
await admin.query(`CREATE TABLE public.vq_secret (v text); INSERT INTO public.vq_secret VALUES ('admin-only')`);
// The old provisioning made the admin a member of every app role; it must not matter any more.
await admin.query(`GRANT "${A}" TO CURRENT_USER`);
await admin.query(`GRANT "${B}" TO CURRENT_USER`);

const setup = await qr.ensureQueryRole(adminExec, A, SECRET);
ok('query role created', setup.created === true);
const role = qr.queryRoleName(A);

// Same client settings as the route.
async function tenantClient() {
  const c = new Client({
    connectionString: qr.queryRoleConnectionString(ADMIN_URL, role, qr.queryRolePassword(SECRET, role)),
    statement_timeout: TIMEOUT_MS,
    idle_in_transaction_session_timeout: TIMEOUT_MS,
    query_timeout: TIMEOUT_MS + 5_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'datanexus-query-verify',
  });
  await c.connect();
  await c.query(`SET ROLE "${A}"`);
  await c.query(`SET search_path TO "${A}"`);
  return c;
}
async function attempt(name, sql, { expect, mode = 'extended', match } = {}) {
  const c = await tenantClient();
  let err, res;
  try {
    res = mode === 'extended' ? await c.query({ text: sql, values: [], queryMode: 'extended' }) : await c.query(sql);
  } catch (e) { err = e; }
  await c.end().catch(() => {});
  if (expect === 'allow') ok(`${name} -> allowed`, !err, err?.message ?? '');
  else ok(`${name} -> refused`, !!err && (!match || match.test(err.message)), err ? err.message : JSON.stringify(res?.rows ?? res));
  return { err, res };
}

const c0 = await tenantClient();
const who = (await c0.query('SELECT session_user AS s, current_user AS c')).rows[0];
await c0.end();
ok(`real login: session_user = ${role}, current_user = ${A}`, who.s === role && who.c === A, JSON.stringify(who));

await attempt('create own table', `CREATE TABLE t (x int)`, { expect: 'allow' });
await attempt('insert own table', `INSERT INTO t VALUES (1)`, { expect: 'allow' });
await attempt('read own table', `SELECT * FROM t`, { expect: 'allow' });
const owner = (await admin.query(`SELECT tableowner FROM pg_tables WHERE schemaname = $1 AND tablename = 't'`, [A])).rows[0];
ok(`tenant table owned by ${A}`, owner?.tableowner === A, JSON.stringify(owner));

const denied = /permission denied|must be superuser|not permitted|insufficient privilege|cannot/i;
await attempt('read other tenant', `SELECT * FROM "${B}".children`, { match: denied });
await attempt('read admin table', `SELECT * FROM public.vq_secret`, { match: denied });
await attempt('read pg_authid', `SELECT rolname, rolpassword FROM pg_authid`, { match: denied });
await attempt('multi-statement over extended protocol', `RESET ROLE; SELECT 1`, { match: /multiple commands/ });
await attempt('simple protocol: RESET ROLE; read admin table', `RESET ROLE; SELECT * FROM public.vq_secret`, { mode: 'simple', match: denied });
await attempt('simple protocol: RESET ROLE; read other tenant', `RESET ROLE; SELECT * FROM "${B}".children`, { mode: 'simple', match: denied });
await attempt('DO: set_config(role, none) then read other tenant', `DO $$ BEGIN
  PERFORM set_config('role', 'none', false);
  PERFORM * FROM "${B}".children;
END $$`, { match: denied });
await attempt('DO: after RESET ROLE, query role has no app privileges', `DO $$ BEGIN
  PERFORM set_config('role', 'none', false);
  PERFORM * FROM "${A}".t;
END $$`, { match: denied });
await attempt(`SET ROLE ${B}`, `SET ROLE "${B}"`, { match: denied });
await attempt(`SET ROLE ${adminUser}`, `SET ROLE "${adminUser}"`, { match: denied });
await attempt(`SET SESSION AUTHORIZATION ${adminUser}`, `SET SESSION AUTHORIZATION "${adminUser}"`, { match: denied });
await attempt('set_config(session_authorization)', `SELECT set_config('session_authorization', '${adminUser}', false)`, { match: denied });
await attempt('ALTER ROLE other password', `ALTER ROLE "${B}" PASSWORD 'pwned'`, { match: denied });
await attempt('CREATE ROLE', `CREATE ROLE vq_evil SUPERUSER`, { match: denied });
await attempt('COPY TO PROGRAM', `COPY (SELECT 1) TO PROGRAM 'id'`, { match: denied });
await attempt('pg_read_file', `SELECT pg_read_file('/etc/passwd')`, { match: denied });

// Statement timeout, including a DO block that tries to lift it mid-statement.
await attempt('statement_timeout cancels pg_sleep', `SELECT pg_sleep(${(TIMEOUT_MS / 1000) * 3})`, { match: /statement timeout/ });
await attempt('statement_timeout survives set_config inside the statement', `DO $$ BEGIN
  PERFORM set_config('statement_timeout', '0', false);
  PERFORM pg_sleep(${(TIMEOUT_MS / 1000) * 3});
END $$`, { match: /statement timeout/ });

// Connection limit per app.
const held = [];
let limitErr;
try { for (let i = 0; i <= LIMIT; i++) held.push(await tenantClient()); } catch (e) { limitErr = e; }
for (const c of held) await c.end().catch(() => {});
ok(`connection limit ${LIMIT} enforced (53300)`, limitErr?.code === '53300', limitErr ? `${limitErr.code} ${limitErr.message}` : `opened ${held.length}`);

// Wrong password (e.g. rotated secret) is a 28P01, which the route repairs.
let pwErr;
try {
  const c = new Client({ connectionString: qr.queryRoleConnectionString(ADMIN_URL, role, 'wrong-password') });
  await c.connect(); await c.end();
} catch (e) { pwErr = e; }
ok('wrong password -> 28P01', pwErr?.code === '28P01', pwErr ? pwErr.code : 'connected');

if (!process.argv.includes('--keep')) await cleanup();
await admin.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
