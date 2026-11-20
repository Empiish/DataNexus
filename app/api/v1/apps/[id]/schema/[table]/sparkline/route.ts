import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getSparkline, startSnapshotter } from '@/lib/snapshots';
import { notFound } from '@/lib/errors';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; table: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  startSnapshotter();
  const { id, table } = await params;
  const app = await prisma.application.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!app) return notFound('Application');

  const spanRaw = req.nextUrl.searchParams.get('span');
  const span: '24h' | '30d' = spanRaw === '30d' ? '30d' : '24h';

  const data = await getSparkline(app.id, table, span);
  return Response.json(data);
}
