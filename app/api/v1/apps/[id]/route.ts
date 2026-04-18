import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { dropAppSchema } from '@/lib/postgres-admin';
import { apiError, notFound } from '@/lib/errors';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = await prisma.application.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    include: {
      connectionKeys: { orderBy: { createdAt: 'desc' } },
      auditEvents: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
  if (!app) return notFound('Application');

  return Response.json({
    id: app.id,
    name: app.name,
    slug: app.slug,
    description: app.description,
    status: app.status,
    created_by: app.createdBy,
    schema_name: app.schemaName,
    db_user: app.dbUser,
    created_at: app.createdAt,
    updated_at: app.updatedAt,
    last_seen_at: app.lastSeenAt,
    keys: app.connectionKeys.map(k => ({
      id: k.id,
      prefix: k.keyPrefix,
      label: k.label,
      created_at: k.createdAt,
      last_used_at: k.lastUsedAt,
      revoked_at: k.revokedAt,
    })),
    recent_events: app.auditEvents.map(e => ({
      id: e.id,
      event_type: e.eventType,
      actor: e.actor,
      metadata: e.metadata ? JSON.parse(e.metadata) : null,
      created_at: e.createdAt,
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = await prisma.application.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!app) return notFound('Application');

  const body = await req.json();
  const updated = await prisma.application.update({
    where: { id: app.id },
    data: {
      ...(body.description !== undefined && { description: body.description }),
      ...(body.status !== undefined && { status: body.status }),
    },
  });
  return Response.json({ id: updated.id, status: updated.status, description: updated.description });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = await prisma.application.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!app) return notFound('Application');

  const { drop_schema = false, actor = 'operator' } = await req.json().catch(() => ({}));

  if (drop_schema) {
    await dropAppSchema(app.slug);
  }

  await prisma.auditEvent.create({
    data: {
      applicationId: app.id,
      eventType: 'disconnected',
      actor,
      metadata: JSON.stringify({ drop_schema }),
    },
  });

  await prisma.application.update({ where: { id: app.id }, data: { status: 'disconnected' } });
  await prisma.connectionKey.updateMany({
    where: { applicationId: app.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return Response.json({ message: `${app.name} disconnected`, schema_dropped: drop_schema });
}
