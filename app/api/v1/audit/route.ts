import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200);
  const appId = searchParams.get('app_id') ?? undefined;
  const eventType = searchParams.get('event_type') ?? undefined;

  const events = await prisma.auditEvent.findMany({
    where: {
      ...(appId && { applicationId: appId }),
      ...(eventType && { eventType }),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { application: { select: { name: true, slug: true } } },
  });

  return Response.json(events.map(e => ({
    id: e.id,
    app_id: e.applicationId,
    app_name: e.application?.name ?? null,
    app_slug: e.application?.slug ?? null,
    event_type: e.eventType,
    actor: e.actor,
    metadata: e.metadata ? JSON.parse(e.metadata) : null,
    created_at: e.createdAt,
  })));
}
