import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Admin authentication for the DataNexus control plane (app registry, key
// minting/revocation, audit, schema/row introspection, dashboards).
//
// Before this, the control plane had NO authentication: the only guard was the
// proxy's X-DN-Edge check, so anything that could reach :4000 directly (any
// container on the host, any tailnet device) could mint dn_ keys, which are
// also identities for the Pandora vault. Now every control-plane request must
// carry ONE of:
//   - `Authorization: Bearer <DATANEXUS_ADMIN_TOKEN>`  (MCP server, scripts, curl)
//   - the signed `dn_admin_session` cookie set by /login  (the web UI)
//
// Fail closed: if DATANEXUS_ADMIN_TOKEN is unset (or shorter than 32 chars)
// every control-plane request gets 503. The public data plane
// (/api/v1/health, /api/v1/auth/verify, /api/v1/query) never comes through
// here; it authenticates itself with dn_ keys.
//
// This module is the ONLY place the check lives. proxy.ts calls it for every
// non-public /api path (deny by default, so new routes are covered), and each
// control-plane route handler calls requireAdmin() again as defense in depth.

export const ADMIN_TOKEN_ENV = 'DATANEXUS_ADMIN_TOKEN';
export const MIN_ADMIN_TOKEN_LENGTH = 32;
export const SESSION_COOKIE = 'dn_admin_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

const SESSION_VERSION = 'v1';
const SESSION_KEY_CONTEXT = 'datanexus-admin-session-v1';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type AdminAuthResult =
  | { ok: true; via: 'bearer' | 'session' }
  | { ok: false; status: 401 | 403 | 503; error: string };

/** The configured admin token, or null when unset/too short (fail closed). */
export function getAdminToken(): string | null {
  const raw = process.env[ADMIN_TOKEN_ENV];
  // Trim so a stray CR/LF from an env file cannot silently lock everyone out.
  const token = raw?.trim();
  if (!token || token.length < MIN_ADMIN_TOKEN_LENGTH) return null;
  return token;
}

export const NOT_CONFIGURED_MESSAGE =
  `DataNexus admin API is disabled: ${ADMIN_TOKEN_ENV} is not set on the server ` +
  `(it must be at least ${MIN_ADMIN_TOKEN_LENGTH} random characters).`;

/**
 * Constant-time string comparison. Both sides are hashed to fixed-length
 * digests first, so neither the content nor the length of the secret leaks
 * through timing, and timingSafeEqual never throws on a length mismatch.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}

// The session signing key is derived from the admin token, so the cookie never
// contains the token and rotating the token invalidates every session.
function sessionKey(token: string): Buffer {
  return createHmac('sha256', token).update(SESSION_KEY_CONTEXT).digest();
}

function sign(payload: string, token: string): string {
  return createHmac('sha256', sessionKey(token)).update(payload).digest('base64url');
}

/** Cookie value: v1.<expiry unix seconds>.<random nonce>.<HMAC-SHA256 signature>. */
export function createSessionValue(token: string, nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  const nonce = randomBytes(16).toString('base64url');
  const payload = `${SESSION_VERSION}.${exp}.${nonce}`;
  return `${payload}.${sign(payload, token)}`;
}

export function verifySessionValue(value: string | undefined | null, token: string, nowMs: number = Date.now()): boolean {
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== SESSION_VERSION) return false;
  const exp = Number(parts[1]);
  if (!Number.isSafeInteger(exp) || exp * 1000 <= nowMs) return false;
  const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
  return constantTimeEqual(sign(payload, token), parts[3]);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

/**
 * Cookie-authenticated state changes must come from the DataNexus UI itself.
 * SameSite=Strict still sends the cookie on requests from sibling subdomains
 * (same *site*), so also require a same-origin browser request.
 */
function isSameOriginRequest(req: Request): boolean {
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite) return fetchSite === 'same-origin';
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Does the request carry a valid (unexpired, correctly signed) UI session cookie? */
export function hasValidSession(req: Request, nowMs: number = Date.now()): boolean {
  const token = getAdminToken();
  if (!token) return false;
  return verifySessionValue(readCookie(req, SESSION_COOKIE), token, nowMs);
}

export function checkAdmin(req: Request, nowMs: number = Date.now()): AdminAuthResult {
  const token = getAdminToken();
  if (!token) return { ok: false, status: 503, error: NOT_CONFIGURED_MESSAGE };

  const presented = bearerToken(req);
  if (presented !== null) {
    return constantTimeEqual(presented, token)
      ? { ok: true, via: 'bearer' }
      : { ok: false, status: 401, error: 'invalid admin token' };
  }

  if (verifySessionValue(readCookie(req, SESSION_COOKIE), token, nowMs)) {
    if (!SAFE_METHODS.has(req.method.toUpperCase()) && !isSameOriginRequest(req)) {
      return { ok: false, status: 403, error: 'cross-origin request refused' };
    }
    return { ok: true, via: 'session' };
  }

  return {
    ok: false,
    status: 401,
    error: 'admin authentication required (Authorization: Bearer <DATANEXUS_ADMIN_TOKEN>)',
  };
}

export function adminAuthErrorResponse(result: Extract<AdminAuthResult, { ok: false }>): Response {
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (result.status === 401) headers['www-authenticate'] = 'Bearer realm="datanexus-admin"';
  return Response.json({ error: result.error }, { status: result.status, headers });
}

/**
 * Route-handler guard. Usage at the top of every control-plane handler:
 *   const denied = requireAdmin(req); if (denied) return denied;
 */
export function requireAdmin(req: Request): Response | null {
  const result = checkAdmin(req);
  return result.ok ? null : adminAuthErrorResponse(result);
}

/** Cookie attributes for the UI session (Secure when served over https). */
export function sessionCookieOptions(req: Request, maxAgeSeconds: number = SESSION_TTL_SECONDS) {
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  let secure = forwardedProto === 'https';
  if (!secure) {
    try {
      secure = new URL(req.url).protocol === 'https:';
    } catch {
      secure = false;
    }
  }
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: 'strict' as const,
    secure,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
