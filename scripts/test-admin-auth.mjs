// Unit tests for lib/admin-auth.ts (no test framework in this repo; uses
// node:test and Node's built-in TypeScript type stripping, Node >= 22.18).
//   npm run test:auth
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  ADMIN_TOKEN_ENV,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  checkAdmin,
  constantTimeEqual,
  createSessionValue,
  getAdminToken,
  hasValidSession,
  requireAdmin,
  sessionCookieOptions,
  verifySessionValue,
} from '../lib/admin-auth.ts';

const TOKEN = randomBytes(32).toString('base64url'); // 43 chars, test-only
const URL_BASE = 'http://dn.test:4000';

function withToken(value, fn) {
  const prev = process.env[ADMIN_TOKEN_ENV];
  if (value === undefined) delete process.env[ADMIN_TOKEN_ENV];
  else process.env[ADMIN_TOKEN_ENV] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[ADMIN_TOKEN_ENV];
    else process.env[ADMIN_TOKEN_ENV] = prev;
  }
}

function req(path, { method = 'GET', headers = {} } = {}) {
  return new Request(`${URL_BASE}${path}`, { method, headers: { host: 'dn.test:4000', ...headers } });
}

test('constantTimeEqual: equal, unequal, different lengths, empty', () => {
  assert.equal(constantTimeEqual(TOKEN, TOKEN), true);
  assert.equal(constantTimeEqual(TOKEN, TOKEN.slice(0, -1) + (TOKEN.endsWith('A') ? 'B' : 'A')), false);
  // A naive crypto.timingSafeEqual on raw buffers throws on length mismatch;
  // hashing first makes every comparison fixed-length and non-throwing.
  assert.equal(constantTimeEqual(TOKEN, TOKEN + 'x'), false);
  assert.equal(constantTimeEqual('', TOKEN), false);
  assert.equal(constantTimeEqual('', ''), true);
});

test('getAdminToken: unset and too-short tokens fail closed; whitespace trimmed', () => {
  withToken(undefined, () => assert.equal(getAdminToken(), null));
  withToken('', () => assert.equal(getAdminToken(), null));
  withToken('x'.repeat(31), () => assert.equal(getAdminToken(), null));
  withToken(`${TOKEN}\r\n`, () => assert.equal(getAdminToken(), TOKEN));
});

test('env unset -> 503 with a clear message, even with credentials', () => {
  withToken(undefined, () => {
    const r = checkAdmin(req('/api/v1/apps', { headers: { authorization: `Bearer ${TOKEN}` } }));
    assert.equal(r.ok, false);
    assert.equal(r.status, 503);
    assert.match(r.error, /DATANEXUS_ADMIN_TOKEN/);
    const res = requireAdmin(req('/api/v1/apps'));
    assert.equal(res.status, 503);
  });
});

test('missing credentials -> 401 with WWW-Authenticate', async () => {
  await withToken(TOKEN, async () => {
    const res = requireAdmin(req('/api/v1/apps/foo/keys', { method: 'POST' }));
    assert.ok(res);
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate') ?? '', /^Bearer/);
    const body = await res.json();
    assert.match(body.error, /admin authentication required/);
  });
});

test('wrong / malformed bearer -> 401; dn_ keys are not admin credentials', () => {
  withToken(TOKEN, () => {
    for (const auth of [`Bearer ${TOKEN}x`, 'Bearer dn_abcdefghijklmnopqrstuvwxyz', `Bearer ${TOKEN.slice(1)}`, 'Bearer  ']) {
      const res = requireAdmin(req('/api/v1/apps', { headers: { authorization: auth } }));
      assert.equal(res?.status, 401, auth.slice(0, 12));
    }
  });
});

test('correct bearer -> allowed for reads and writes', () => {
  withToken(TOKEN, () => {
    assert.equal(requireAdmin(req('/api/v1/apps', { headers: { authorization: `Bearer ${TOKEN}` } })), null);
    const r = checkAdmin(req('/api/v1/apps/foo/keys', { method: 'POST', headers: { authorization: `bearer   ${TOKEN}` } }));
    assert.deepEqual(r, { ok: true, via: 'bearer' });
  });
});

test('session cookie: valid, expired, tampered, signed with a rotated token', () => {
  withToken(TOKEN, () => {
    const now = Date.now();
    const value = createSessionValue(TOKEN, now);
    assert.ok(!value.includes(TOKEN), 'cookie must not contain the token');
    assert.equal(value.split('.').length, 4);
    assert.equal(verifySessionValue(value, TOKEN, now), true);
    assert.equal(verifySessionValue(value, TOKEN, now + (SESSION_TTL_SECONDS + 1) * 1000), false, 'expired');

    const [v, exp, nonce, sig] = value.split('.');
    assert.equal(verifySessionValue(`${v}.${Number(exp) + 3600}.${nonce}.${sig}`, TOKEN, now), false, 'extended expiry');
    const badSig = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    assert.equal(verifySessionValue(`${v}.${exp}.${nonce}.${badSig}`, TOKEN, now), false, 'bad sig');
    assert.equal(verifySessionValue(`${v}.${exp}.${nonce}`, TOKEN, now), false, 'missing sig');
    assert.equal(verifySessionValue(TOKEN, TOKEN, now), false, 'raw token is not a session');
    assert.equal(verifySessionValue(value, randomBytes(32).toString('base64url'), now), false, 'rotated token');

    const cookie = `other=1; ${SESSION_COOKIE}=${value}`;
    assert.equal(hasValidSession(req('/', { headers: { cookie } })), true);
    assert.deepEqual(checkAdmin(req('/api/v1/apps', { headers: { cookie } })), { ok: true, via: 'session' });
    assert.equal(requireAdmin(req('/api/v1/apps', { headers: { cookie: `${SESSION_COOKIE}=${value}x` } }))?.status, 401);
  });
});

test('cookie-authenticated writes must be same-origin (CSRF guard)', () => {
  withToken(TOKEN, () => {
    const cookie = `${SESSION_COOKIE}=${createSessionValue(TOKEN)}`;
    const post = (headers) => checkAdmin(req('/api/v1/apps/foo/keys', { method: 'POST', headers: { cookie, ...headers } }));
    assert.equal(post({ 'sec-fetch-site': 'same-origin' }).ok, true);
    assert.equal(post({ origin: URL_BASE }).ok, true);
    assert.equal(post({ 'sec-fetch-site': 'same-site' }).status, 403);
    assert.equal(post({ 'sec-fetch-site': 'cross-site' }).status, 403);
    assert.equal(post({ origin: 'http://evil.dn.test:4000' }).status, 403);
    assert.equal(post({}).status, 403);
    // Bearer callers (MCP, curl) are not browsers and are not origin-checked.
    assert.equal(checkAdmin(req('/api/v1/apps', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } })).ok, true);
  });
});

test('session cookie options: httpOnly, SameSite=Strict, Secure only on https', () => {
  const plain = sessionCookieOptions(req('/api/v1/session', { method: 'POST' }));
  assert.equal(plain.httpOnly, true);
  assert.equal(plain.sameSite, 'strict');
  assert.equal(plain.secure, false);
  assert.equal(plain.maxAge, SESSION_TTL_SECONDS);
  assert.equal(sessionCookieOptions(req('/x', { headers: { 'x-forwarded-proto': 'https' } })).secure, true);
  assert.equal(sessionCookieOptions(new Request('https://dn.test/x')).secure, true);
});
