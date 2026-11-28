import { NextRequest } from 'next/server';
import { getRecentActivity } from '@/lib/activity-tail';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const limitRaw = req.nextUrl.searchParams.get('limit');
  const limit = limitRaw ? Math.max(1, Math.min(100, parseInt(limitRaw, 10) || 20)) : 20;
  const { events, poller_started } = getRecentActivity(limit);
  return Response.json({ events, poller_started, limit });
}
