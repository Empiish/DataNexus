import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { generateApiKey, buildConnectionString, generateDbPassword } from '@/lib/keygen';
import { apiError, notFound } from '@/lib/errors';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = await prisma.application.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!app) return notFound('Application');

  const { label = 'API key', actor = 'operator' } = await req.json().catch(() => ({}));
  const { key, prefix, hash } = generateApiKey();
  const dbPassword = generateDbPassword();
  const connectionString = buildConnectionString(app.slug, dbPassword);

  const created = await prisma.connectionKey.create({
    data: { applicationId: app.id, keyHash: hash, keyPrefix: prefix, label },
  });
  await prisma.auditEvent.create({
    data: { applicationId: app.id, eventType: 'key_created', actor, metadata: JSON.stringify({ prefix }) },
  });

  return Response.json({
    id: created.id,
    api_key: key,
    prefix,
    label,
    connection_string: connectionString,
    message: 'Store these credentials securely — they will not be shown again.',
  }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = await prisma.application.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!app) return notFound('Application');

  const { key_id, actor = 'operator' } = await req.json().catch(() => ({}));
  if (!key_id) return apiError('key_id is required', 400);

  const key = await prisma.connectionKey.findFirst({ where: { id: key_id, applicationId: app.id } });
  if (!key) return notFound('Key');

  await prisma.connectionKey.update({ where: { id: key_id }, data: { revokedAt: new Date() } });
  await prisma.auditEvent.create({
    data: { applicationId: app.id, eventType: 'key_revoked', actor, metadata: JSON.stringify({ key_id }) },
  });

  return Response.json({ message: 'Key revoked' });
}
