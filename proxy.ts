import { NextRequest, NextResponse } from 'next/server';
import { adminAuthErrorResponse, checkAdmin, hasValidSession } from '@/lib/admin-auth';

// L-409 finding #1 — app-level backstop to the network posture.
// (Next 16 renamed the `middleware` file convention to `proxy`; same role.
// Proxy runs on the Node.js runtime, so lib/admin-auth's node:crypto works here.)
//
// Operator decision (2026-05-17): the DataNexus control plane is Tailnet-only.
// Caddy's public host reverse-proxies ONLY the data-plane routes below,
// stamping `X-DN-Edge: public` on them and stripping any client-supplied
// X-DN-Edge. Everything else is reachable only Tailnet-direct.
//
// Therefore: a control-plane request that carries the edge marker means Caddy
// was misconfigured to expose it — refuse (mirror Caddy's own 404).
//
// Network position is NOT authentication. Anything that can reach :4000
// directly (a container on the host, any tailnet device) used to get the full
// control plane. Now every control-plane API request must also pass the admin
// check in lib/admin-auth.ts (Bearer DATANEXUS_ADMIN_TOKEN, or the signed UI
// session cookie from /login). The check is deny-by-default here, so a new
// route is protected without anyone remembering to add it; route handlers
// re-check as defense in depth.

const EDGE_MARKER = 'x-dn-edge';

// Intentionally reachable from the public edge AND without admin auth:
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

// Control plane (edge-blocked) but exempt from the admin check because it IS
// the admin login/logout endpoint and verifies the token itself.
const SESSION_ENDPOINT = '/api/v1/session';
const LOGIN_PAGE = '/login';

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (EDGE_ALLOWED.has(path)) return NextResponse.next();

  if (path.startsWith('/api/')) {
    // Any other /api/v1/* path is control plane. It must not be reachable via
    // the public ingress; the marker's presence proves it was.
    if (path.startsWith('/api/v1/') && req.headers.get(EDGE_MARKER)) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    if (path === SESSION_ENDPOINT) return NextResponse.next();

    const result = checkAdmin(req);
    if (!result.ok) return adminAuthErrorResponse(result);
    return NextResponse.next();
  }

  // UI pages. They are client components that load everything through the
  // (now authenticated) API, so this redirect is about UX, not the boundary.
  if (path === LOGIN_PAGE) return NextResponse.next();
  if (!hasValidSession(req)) {
    const url = req.nextUrl.clone();
    url.pathname = LOGIN_PAGE;
    url.search = '';
    if (path !== '/') url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Every API path, unconditionally (an id like "x.svg" must not skip the check).
    '/api/:path*',
    // Pages, minus build assets and the static files in /public.
    '/((?!api/|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
