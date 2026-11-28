import { NextRequest, NextResponse } from 'next/server';
import {
  NOT_CONFIGURED_MESSAGE,
  constantTimeEqual,
  createSessionValue,
  getAdminToken,
  sessionCookieOptions,
} from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

// UI login/logout for the control plane. The owner pastes DATANEXUS_ADMIN_TOKEN
// once on /login; we answer with an httpOnly, SameSite=Strict cookie holding an
// HMAC-signed, expiring session (never the token itself). This endpoint is
// edge-blocked like the rest of the control plane (proxy.ts) and is the one
// control-plane route exempt from the admin check, because it IS the check.

export async function POST(req: NextRequest) {
  const token = getAdminToken();
  if (!token) return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const presented = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!presented || !constantTimeEqual(presented, token)) {
    return NextResponse.json({ error: 'invalid admin token' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  res.cookies.set({ ...sessionCookieOptions(req), value: createSessionValue(token) });
  return res;
}

export async function DELETE(req: NextRequest) {
  const res = NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  res.cookies.set({ ...sessionCookieOptions(req, 0), value: '' });
  return res;
}
