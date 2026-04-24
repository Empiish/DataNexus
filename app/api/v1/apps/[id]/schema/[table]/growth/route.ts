import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getSizeDeltas, startSnapshotter } from '@/lib/snapshots';
import { notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; table: string }> }) {
  startSnapshotter();
  const { id, table } = await params;
  const app = await prisma.application.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!app) return notFound('Application');

  const deltas = await getSizeDeltas(app.id, table);
  return Response.json(deltas);
}
