import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getSchemaDiffLog, startSnapshotter } from '@/lib/snapshots';
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

  const changes = await getSchemaDiffLog(app.id);
  return Response.json({ changes });
}
