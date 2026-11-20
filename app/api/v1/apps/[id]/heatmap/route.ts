import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getWriteHeatmap, startSnapshotter } from '@/lib/snapshots';
import { notFound } from '@/lib/errors';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  startSnapshotter();
  const { id } = await params;
  const app = await prisma.application.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!app) return notFound('Application');

  const daysRaw = req.nextUrl.searchParams.get('days');
  const days = Math.max(1, Math.min(30, daysRaw ? parseInt(daysRaw, 10) || 14 : 14));

  const cells = await getWriteHeatmap(app.id, days);
  return Response.json({ days, cells });
}
