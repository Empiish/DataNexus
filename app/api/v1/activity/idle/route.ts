import { NextRequest } from 'next/server';
import { getIdleAppStatus, startSnapshotter } from '@/lib/snapshots';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  startSnapshotter();
  const thresholdRaw = req.nextUrl.searchParams.get('days');
  const threshold = Math.max(1, Math.min(60, thresholdRaw ? parseInt(thresholdRaw, 10) || 7 : 7));
  const apps = await getIdleAppStatus(threshold);
  return Response.json({ threshold_days: threshold, apps });
}
