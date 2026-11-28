import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { Client, type QueryConfig } from 'pg';
import { verifyKey } from '@/lib/auth';
import { apiError } from '@/lib/errors';
import {
  NOT_CONFIGURED_MESSAGE,
  QueryRoleError,
  ensureQueryRole,
  getQueryRoleSecret,
  pgCode,
  queryRoleConnectionLimit,
  queryRoleConnectionString,
  queryRoleName,
  queryRolePassword,
  type SqlExec,
} from '@/lib/query-roles';
import {
  QuerySlotQueueFullError,
  acquireQuerySlot,
  querySlotMaxQueue,
  querySlotWaitMs,
} from '@/lib/query-slots';

// Data plane: run one SQL statement for the app that owns the dn_ key.
//
// Isolation (security review DN-1, 2026-11-21): the tenant's SQL runs in a
// session that LOGGED IN as the app's query role (dnq_app_<slug>, see
// lib/query-roles.ts), never in a DATABASE_URL (superuser) session. The old
// "connect as superuser, then SET ROLE app_<slug>" could be undone by the
// tenant's own SQL (RESET ROLE / set_config('role', ...)), so any key could
// read every schema, pg_authid and ConnectionKey.
//
// Also:
//  - extended protocol only: one statement per request;
//  - statement_timeout + a per-app CONNECTION LIMIT on the role, so one key
//    cannot exhaust the cluster's connections;
//  - a per-app queue in front of that limit (lib/query-slots.ts, 2026-11-28):
//    a burst bigger than the limit waits for a free connection instead of
//    failing with 429;
//  - one log line per request: key id, app, a hash of the SQL (never the SQL
//    text or params), duration, row count, error code.

const ENSURE_TTL_MS = 10 * 60 * 1000;
const ensuredUntil = new Map<string, number>();

function statementTimeoutMs(): number {
  const n = Number(process.env.DATANEXUS_QUERY_STATEMENT_TIMEOUT_MS ?? 30_000);
  return Number.isFinite(n) && n >= 1_000 && n <= 300_000 ? Math.floor(n) : 30_000;
}

/** Run `fn` on a short-lived DATABASE_URL connection. Used ONLY for role setup, never for tenant SQL. */
async function withAdmin<T>(databaseUrl: string, fn: (exec: SqlExec) => Promise<T>): Promise<T> {
  const admin = new Client({ connectionString: databaseUrl, application_name: 'datanexus-query-setup' });
  await admin.connect();
  try {
    return await fn((text, values) => admin.query(text, values));
  } finally {
    await admin.end();
  }
}

async function ensureRole(databaseUrl: string, schemaName: string, secret: string, resetPassword: boolean) {
  const r = await withAdmin(databaseUrl, (exec) => ensureQueryRole(exec, schemaName, secret, { resetPassword }));
  ensuredUntil.set(schemaName, Date.now() + ENSURE_TTL_MS);
  if (r.created || r.passwordReset || r.limitChanged) {
    console.info(JSON.stringify({
      event: 'dn.query_role', schema: schemaName, created: r.created, password_reset: r.passwordReset,
      ...(r.limitChanged ? { connection_limit: queryRoleConnectionLimit() } : {}),
    }));
  }
}

/** Connect as the app's query role; repair the role once if login fails (missing role or rotated secret). */
async function connectAsQueryRole(databaseUrl: string, schemaName: string, secret: string): Promise<Client> {
  const role = queryRoleName(schemaName);
  const timeout = statementTimeoutMs();
  const open = async () => {
    const client = new Client({
      connectionString: queryRoleConnectionString(databaseUrl, role, queryRolePassword(secret, role)),
      statement_timeout: timeout,
      idle_in_transaction_session_timeout: timeout,
      query_timeout: timeout + 5_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'datanexus-query',
    });
    await client.connect();
    return client;
  };

  if ((ensuredUntil.get(schemaName) ?? 0) <= Date.now()) {
    await ensureRole(databaseUrl, schemaName, secret, false);
  }
  try {
    return await open();
  } catch (err) {
    const code = pgCode(err);
    // 28P01 invalid_password (also what Postgres reports for a missing role), 28000 invalid authorization.
    if (code !== '28P01' && code !== '28000') throw err;
  }
  await ensureRole(databaseUrl, schemaName, secret, true);
  return open();
}

export async function POST(req: NextRequest) {
  // --- Auth (L-409 #3): shared verifyKey with a 60s TTL. ---
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return apiError('Missing Bearer token', 401);

  const outcome = await verifyKey(auth.slice(7));
  if (outcome.kind !== 'ok') return apiError('Invalid API key', 401);
  const { schemaName, principal } = outcome;

  const secret = getQueryRoleSecret();
  const databaseUrl = process.env.DATABASE_URL;
  if (!secret || !databaseUrl) return apiError(NOT_CONFIGURED_MESSAGE, 503);

  // --- Parse body ---
  let body: { sql?: unknown; params?: unknown };
  try {
    body = await req.json();
  } catch {
    return apiError('Invalid JSON body', 400);
  }

  const { sql, params } = body;
  if (typeof sql !== 'string' || !sql.trim()) return apiError('sql is required', 400);
  if (params !== undefined && !Array.isArray(params)) return apiError('params must be an array', 400);

  const started = Date.now();
  let waitMs = 0;
  const logLine = (fields: Record<string, unknown>) =>
    console.info(JSON.stringify({
      event: 'dn.query',
      key_id: principal.key_id,
      app: principal.slug,
      sql_sha256: createHash('sha256').update(sql).digest('hex').slice(0, 16),
      ms: Date.now() - started,
      ...(waitMs ? { wait_ms: waitMs } : {}),
      ...fields,
    }));

  // --- Wait for one of this app's connection slots (at most CONNECTION LIMIT at once) ---
  let release: () => void;
  try {
    release = await acquireQuerySlot(schemaName, queryRoleConnectionLimit(), querySlotWaitMs(), querySlotMaxQueue());
  } catch (err: unknown) {
    logLine({ error: err instanceof QuerySlotQueueFullError ? 'queue_full' : 'queue_timeout' });
    return apiError('Too many concurrent queries for this app; retry shortly', 429);
  }
  waitMs = Date.now() - started;

  // The slot is held until the connection is closed (the inner finally), then handed to the next waiter.
  try {
    // --- Connect as the app's own query role ---
    let client: Client;
    try {
      client = await connectWithRetry(databaseUrl, schemaName, secret);
    } catch (err: unknown) {
      const code = pgCode(err);
      logLine({ error: code ?? 'connect_failed' });
      if (code === '53300') return apiError('Too many concurrent queries for this app; retry shortly', 429);
      // Details (role names, failed checks) go to the server log, not to the caller.
      console.error(JSON.stringify({
        event: 'dn.query_connect_failed',
        schema: schemaName,
        error: err instanceof QueryRoleError ? err.message : code ?? (err instanceof Error ? err.message : String(err)),
      }));
      return apiError('Query service unavailable for this app', 503);
    }

    // --- Execute ---
    // The session user is dnq_<schema> (no privileges of its own). SET ROLE to
    // the app role so objects the tenant creates stay owned by app_<slug>, as
    // before. schemaName passed queryRoleName()'s [a-z0-9_] check, so it is safe
    // as a quoted identifier. The client is per request and closed in finally.
    try {
      await client.query(`SET ROLE "${schemaName}"`);
      await client.query(`SET search_path TO "${schemaName}"`);
      const query = { text: sql, values: (params as unknown[] | undefined) ?? [], queryMode: 'extended' } as QueryConfig;
      const result = await client.query(query);
      logLine({ rows: result.rowCount ?? result.rows.length });
      return Response.json({ rows: result.rows });
    } catch (err: unknown) {
      logLine({ error: pgCode(err) ?? 'query_failed' });
      const msg = err instanceof Error ? err.message : 'Query failed';
      return apiError(msg, 400);
    } finally {
      await client.end().catch(() => {});
    }
  } finally {
    release();
  }
}

/**
 * The queue keeps this process within the role's CONNECTION LIMIT, but Postgres
 * counts a backend until it has fully exited, so a login right after another
 * request closed can still see the limit for a moment (53300). Retry briefly.
 */
async function connectWithRetry(databaseUrl: string, schemaName: string, secret: string): Promise<Client> {
  const delays = [100, 300];
  for (let attempt = 0; ; attempt++) {
    try {
      return await connectAsQueryRole(databaseUrl, schemaName, secret);
    } catch (err) {
      if (pgCode(err) !== '53300' || attempt >= delays.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}
