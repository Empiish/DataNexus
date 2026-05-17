import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';

// L-409 finding #3: single source of truth for dn_ key verification with a
// 60s TTL, so a revoked/inactivated key stops working within 60s instead of
// living forever in an unbounded in-process map (the old query-proxy cache).
//
// Finding #1 (control-plane gating) is enforced by middleware.ts + the network
// posture (Tailnet-only control plane, Caddy 2-route public allowlist) — it
// needs no IP logic here, so none lives here.

export type Principal = {
  application_id: string;
  slug: string;
  name: string;
  status: string;
  key_id: string;
  label: string | null;
  scopes: string[];
};

export type VerifyOutcome =
  | { kind: 'ok'; principal: Principal; schemaName: string }
  | { kind: 'invalid' };

type CacheEntry = { principal: Principal; schemaName: string; expires: number };
const TTL_MS = 60_000;
// Keyed by the full dn_ key. Entries are overwritten or dropped on the next
// verify after expiry, so revocation/inactivation propagates within TTL_MS.
const cache = new Map<string, CacheEntry>();

// Verify a dn_ key against DataNexus's OWN ConnectionKey table (it owns the
// table — no HTTP self-call). Mirrors /api/v1/auth/verify semantics exactly:
// prefix-indexed candidates, bcrypt compare, revokedAt:null + app active.
export async function verifyKey(key: string): Promise<VerifyOutcome> {
  if (typeof key !== 'string' || !key.startsWith('dn_') || key.length < 12) {
    return { kind: 'invalid' };
  }
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) {
    return { kind: 'ok', principal: hit.principal, schemaName: hit.schemaName };
  }

  const prefix = key.slice(0, 12);
  const candidates = await prisma.connectionKey.findMany({
    where: { keyPrefix: prefix, revokedAt: null },
    include: { application: true },
  });

  for (const c of candidates) {
    if (!bcrypt.compareSync(key, c.keyHash)) continue;
    if (c.application.status !== 'active') return { kind: 'invalid' };
    const principal: Principal = {
      application_id: c.application.id,
      slug: c.application.slug,
      name: c.application.name,
      status: c.application.status,
      key_id: c.id,
      label: c.label,
      scopes: c.scopes ? (JSON.parse(c.scopes) as string[]) : [],
    };
    cache.set(key, { principal, schemaName: c.application.schemaName, expires: now + TTL_MS });
    return { kind: 'ok', principal, schemaName: c.application.schemaName };
  }
  // No match: drop any stale entry so a previously-cached key that was just
  // revoked cannot keep matching past its TTL.
  cache.delete(key);
  return { kind: 'invalid' };
}
