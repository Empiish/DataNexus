import { NextRequest, NextResponse } from 'next/server';

// L-409 finding #1 — app-level backstop to the network posture.
//
// Operator decision (2026-05-17): the DataNexus control plane is Tailnet-only.
// Caddy's public host (datanexus.78.46.200.161.sslip.io) reverse-proxies ONLY
// the two data-plane routes below, stamping `X-DN-Edge: public` on them and
// stripping any client-supplied X-DN-Edge. Everything else is reachable only
// Tailnet-direct.
//
// Therefore: a control-plane request that carries the edge marker means Caddy
// was misconfigured to expose it — refuse (mirror Caddy's own 404). An
// unmarked control-plane request can only have arrived Tailnet-direct (the
// trusted operator) and passes through. The firewall + Caddy allowlist are the
// real boundary; this middleware is defense-in-depth against an ingress
// misconfiguration, not a substitute for it.

const EDGE_MARKER = 'x-dn-edge';

// Intentionally reachable from the public edge:
//  - /api/v1/health        — liveness, no secrets
//  - /api/v1/auth/verify   — the verify primitive; self-authenticating (key in
//                            the body); Pandora and other siblings depend on it
//  - /api/v1/query         — data plane; authenticates itself in-route
//                            (dn_ key, 60s TTL, per-app SET ROLE)
const EDGE_ALLOWED = new Set<string>([
  '/api/v1/health',
  '/api/v1/auth/verify',
  '/api/v1/query',
]);

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (EDGE_ALLOWED.has(path)) return NextResponse.next();

  // Any other /api/v1/* path is control plane. It must not be reachable via
  // the public ingress; the marker's presence proves it was.
  if (req.headers.get(EDGE_MARKER)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: '/api/v1/:path*',
};
