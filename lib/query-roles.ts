import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

// Tenant isolation for POST /api/v1/query (security review DN-1, 2026-11-21).
//
// Before: the route connected as DATABASE_URL (the cluster superuser) and ran
// `SET ROLE app_<slug>` before the caller's SQL. SET ROLE is not a security
// boundary: Postgres checks it against the SESSION user, and the caller's own
// SQL can undo it (`RESET ROLE`, `SET ROLE NONE`, `set_config('role', ...)` in
// a DO block). Any valid dn_ key could become the superuser.
//
// Now the route logs in AS a dedicated per-app query role, so the session user
// itself is unprivileged:
//
//   dnq_app_<slug>   LOGIN NOINHERIT, no SUPERUSER/CREATEDB/CREATEROLE/
//                    REPLICATION/BYPASSRLS, CONNECTION LIMIT n
//                    member of app_<slug> WITH INHERIT FALSE, SET TRUE
//
// The route then runs `SET ROLE app_<slug>`, so objects the tenant creates are
// owned by app_<slug> as before. If the tenant's SQL resets the role, it lands
// on dnq_app_<slug>, which holds no privileges of its own (NOINHERIT) and can
// SET ROLE only to app_<slug>.
//
// The `dnq_` prefix cannot collide with an app role: every app role is
// `app_<slug>`. The password is derived (HMAC of DATANEXUS_QUERY_ROLE_SECRET
// and the role name), so DataNexus stores no per-app DB passwords. Postgres
// only ever sees a SCRAM-SHA-256 verifier computed here, so the plaintext is
// never in SQL text or server logs.
//
// The checks below refuse to set up a query role when the app role could be
// used to escalate (superuser, CREATEROLE, REPLICATION, BYPASSRLS, or a member
// of any other role, since SET ROLE follows membership chains).

export const QUERY_ROLE_SECRET_ENV = 'DATANEXUS_QUERY_ROLE_SECRET';
export const MIN_QUERY_ROLE_SECRET_LENGTH = 32;
export const QUERY_ROLE_PREFIX = 'dnq_';

// 'dnq_' (4) + schema name must fit Postgres's 63-byte identifier limit,
// otherwise Postgres would silently truncate and two apps could share a role.
const APP_SCHEMA_RE = /^app_[a-z0-9_]{1,55}$/;
const PASSWORD_CONTEXT = 'datanexus-query-role-v1:';
const SCRAM_ITERATIONS = 4096;

export const NOT_CONFIGURED_MESSAGE =
  `DataNexus query API is disabled: ${QUERY_ROLE_SECRET_ENV} is not set on the server ` +
  `(it must be at least ${MIN_QUERY_ROLE_SECRET_LENGTH} random characters).`;

export class QueryRoleError extends Error {}

export type SqlRow = Record<string, unknown>;
export type SqlExec = (text: string, values?: unknown[]) => Promise<{ rows: SqlRow[] }>;

/** The configured derivation secret, or null when unset/too short (fail closed). */
export function getQueryRoleSecret(): string | null {
  const secret = process.env[QUERY_ROLE_SECRET_ENV]?.trim();
  if (!secret || secret.length < MIN_QUERY_ROLE_SECRET_LENGTH) return null;
  return secret;
}

/** Connections each app may hold at once (bounds what one key can take from max_connections). */
export function queryRoleConnectionLimit(): number {
  const n = Number(process.env.DATANEXUS_QUERY_CONNECTION_LIMIT ?? 5);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 5;
}

/** Validates the app schema name and returns its query role name. */
export function queryRoleName(schemaName: string): string {
  if (typeof schemaName !== 'string' || !APP_SCHEMA_RE.test(schemaName)) {
    throw new QueryRoleError(`schema name ${JSON.stringify(schemaName)} is not app_<slug> (a-z, 0-9, _; max 59 chars)`);
  }
  return `${QUERY_ROLE_PREFIX}${schemaName}`;
}

export function queryRolePassword(secret: string, role: string): string {
  return createHmac('sha256', secret).update(PASSWORD_CONTEXT + role).digest('base64url');
}

/**
 * SCRAM-SHA-256 verifier in Postgres's stored format (RFC 5802 / 7677):
 *   SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>
 * The password is ASCII (base64url), so SASLprep is the identity.
 */
export function scramSha256Verifier(password: string, salt: Buffer = randomBytes(16), iterations = SCRAM_ITERATIONS): string {
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/** DATABASE_URL with the query role's credentials (and Prisma's ?schema= dropped). */
export function queryRoleConnectionString(databaseUrl: string, role: string, password: string): string {
  const url = new URL(databaseUrl);
  url.username = role;
  url.password = password;
  url.searchParams.delete('schema');
  return url.toString();
}

type RoleRow = {
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  rolinherit: boolean;
  rolcanlogin: boolean;
  rolconnlimit: number;
  member_of: string[] | null;
};

async function loadRole(exec: SqlExec, name: string): Promise<RoleRow | null> {
  const { rows } = await exec(
    `SELECT r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls,
            r.rolinherit, r.rolcanlogin, r.rolconnlimit,
            ARRAY(SELECT DISTINCT g.rolname::text FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
                   WHERE m.member = r.oid ORDER BY 1) AS member_of
       FROM pg_roles r WHERE r.rolname = $1`,
    [name],
  );
  return (rows[0] as RoleRow | undefined) ?? null;
}

/** Problems that make it unsafe to hand an app role to a tenant session. Empty = safe. */
export async function checkQueryRoleSetup(
  exec: SqlExec,
  schemaName: string,
): Promise<{ queryRoleExists: boolean; queryRoleConnLimit: number | null; problems: string[] }> {
  const role = queryRoleName(schemaName);
  const problems: string[] = [];

  const app = await loadRole(exec, schemaName);
  if (!app) {
    problems.push(`app role ${schemaName} does not exist`);
  } else {
    if (app.rolsuper) problems.push(`app role ${schemaName} is SUPERUSER`);
    if (app.rolcreaterole) problems.push(`app role ${schemaName} has CREATEROLE`);
    if (app.rolreplication) problems.push(`app role ${schemaName} has REPLICATION`);
    if (app.rolbypassrls) problems.push(`app role ${schemaName} has BYPASSRLS`);
    const memberOf = app.member_of ?? [];
    if (memberOf.length) problems.push(`app role ${schemaName} is a member of ${memberOf.join(', ')}`);
  }

  const q = await loadRole(exec, role);
  if (q) {
    if (q.rolsuper || q.rolcreaterole || q.rolcreatedb || q.rolreplication || q.rolbypassrls) {
      problems.push(`query role ${role} has elevated attributes`);
    }
    if (q.rolinherit) problems.push(`query role ${role} is INHERIT (must be NOINHERIT)`);
    const memberOf = q.member_of ?? [];
    if (memberOf.length !== 1 || memberOf[0] !== schemaName) {
      problems.push(`query role ${role} must be a member of exactly ${schemaName} (is: ${memberOf.join(', ') || 'none'})`);
    }
  }
  return { queryRoleExists: !!q, queryRoleConnLimit: q ? Number(q.rolconnlimit) : null, problems };
}

/** SQLSTATE of a pg error, if any. */
export function pgCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}

/**
 * Create the app's query role if missing (or reset its password when
 * `resetPassword`), after checking that the setup cannot be used to escalate.
 * `exec` must run as a role that may create roles and grant app_<slug>
 * (today: the DATABASE_URL superuser). Identifiers are safe to interpolate:
 * queryRoleName() restricts them to [a-z0-9_]; the verifier is base64 plus '$:'.
 */
export async function ensureQueryRole(
  exec: SqlExec,
  schemaName: string,
  secret: string,
  opts: { resetPassword?: boolean } = {},
): Promise<{ created: boolean; passwordReset: boolean; limitChanged?: boolean }> {
  const role = queryRoleName(schemaName);
  const before = await checkQueryRoleSetup(exec, schemaName);
  if (before.problems.length) throw new QueryRoleError(`refusing query role setup: ${before.problems.join('; ')}`);

  const verifier = scramSha256Verifier(queryRolePassword(secret, role));
  const limit = queryRoleConnectionLimit();
  const attrs = `LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${limit}`;

  if (before.queryRoleExists) {
    if (!opts.resetPassword) {
      // 2026-11-28: keep DATANEXUS_QUERY_CONNECTION_LIMIT authoritative for roles that already exist (it used to
      // apply only at creation or a password reset). Checked on every ensure (route: every 10 minutes per app).
      if (before.queryRoleConnLimit !== limit) {
        await exec(`ALTER ROLE "${role}" CONNECTION LIMIT ${limit}`);
        return { created: false, passwordReset: false, limitChanged: true };
      }
      return { created: false, passwordReset: false };
    }
    await exec(`ALTER ROLE "${role}" WITH ${attrs} PASSWORD '${verifier}'`);
    return { created: false, passwordReset: true };
  }

  try {
    await exec('BEGIN');
    await exec(`CREATE ROLE "${role}" WITH ${attrs} PASSWORD '${verifier}'`);
    await exec(`GRANT "${schemaName}" TO "${role}" WITH INHERIT FALSE, SET TRUE`);
    await exec('COMMIT');
  } catch (err) {
    await exec('ROLLBACK').catch(() => {});
    // Another request created it first (same derived password): fine if it checks out.
    if (pgCode(err) !== '42710') throw err;
    const again = await checkQueryRoleSetup(exec, schemaName);
    if (again.problems.length || !again.queryRoleExists) {
      throw new QueryRoleError(`refusing query role setup: ${again.problems.join('; ') || 'role vanished'}`);
    }
    return { created: false, passwordReset: false };
  }

  const after = await checkQueryRoleSetup(exec, schemaName);
  if (after.problems.length || !after.queryRoleExists) {
    throw new QueryRoleError(`query role setup did not verify: ${after.problems.join('; ') || 'role missing'}`);
  }
  return { created: true, passwordReset: false };
}
