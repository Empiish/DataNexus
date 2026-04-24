import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getSchemaDiffLog, startSnapshotter } from '@/lib/snapshots';
import { notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  startSnapshotter();
  const { id } = await params;
  const app = await prisma.application.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!app) return notFound('Application');

  const changes = await getSchemaDiffLog(app.id);
  return Response.json({ changes });
}
