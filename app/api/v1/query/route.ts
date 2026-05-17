import { NextRequest } from 'next/server';
import { Client } from 'pg';
import { verifyKey } from '@/lib/auth';
import { apiError } from '@/lib/errors';

export async function POST(req: NextRequest) {
  // --- Auth (L-409 #3): shared verifyKey with a 60s TTL. The old in-process
  // {hash,schemaName} map never expired, so a revoked key kept working until
  // process restart. verifyKey re-checks the DB (revokedAt:null + app active)
  // at most every 60s. ---
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return apiError('Missing Bearer token', 401);

  const outcome = await verifyKey(auth.slice(7));
  if (outcome.kind !== 'ok') return apiError('Invalid API key', 401);
  const { schemaName } = outcome;

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

  // --- Execute (L-388 Phase 1): drop from the datanexus_admin connection to
  // the caller's own least-privilege role BEFORE running tenant SQL. Previously
  // search_path was the ONLY isolation, so a tenant key could read any schema
  // (incl. datanexus."ConnectionKey"). SET ROLE confines the session to the
  // app_<slug> role's grants; SET search_path keeps unqualified names working.
  // schemaName == role name == app_<slug> (set at provision; slug is
  // sanitized to [a-z0-9_], safe as an identifier). Per-request client is
  // closed in finally (implicit RESET). ---
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`SET ROLE "${schemaName}"`);
    await client.query(`SET search_path TO "${schemaName}"`);
    const result = await client.query(sql, (params as unknown[]) ?? []);
    return Response.json({ rows: result.rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Query failed';
    return apiError(msg, 400);
  } finally {
    await client.end();
  }
}
