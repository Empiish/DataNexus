import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getSizeDeltas, startSnapshotter } from '@/lib/snapshots';
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

  const deltas = await getSizeDeltas(app.id, table);
  return Response.json(deltas);
}
