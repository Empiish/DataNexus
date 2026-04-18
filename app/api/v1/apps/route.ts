import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { provisionAppSchema } from '@/lib/postgres-admin';
import { generateApiKey, generateDbPassword, buildConnectionString } from '@/lib/keygen';
import { apiError } from '@/lib/errors';

export async function GET() {
  const apps = await prisma.application.findMany({
    orderBy: { createdAt: 'desc' },
    include: { connectionKeys: { where: { revokedAt: null } } },
  });

  return Response.json(apps.map(a => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    description: a.description,
    status: a.status,
    created_by: a.createdBy,
    schema_name: a.schemaName,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
    last_seen_at: a.lastSeenAt,
    active_keys: a.connectionKeys.length,
  })));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, created_by = 'operator' } = body;

    if (!name || typeof name !== 'string') return apiError('name is required', 400);

    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    if (!slug) return apiError('name produces an empty slug', 400);

    const existing = await prisma.application.findUnique({ where: { slug } });
    if (existing) return apiError(`App with slug "${slug}" already exists`, 409);

    const dbPassword = generateDbPassword();
    const { schema, user } = await provisionAppSchema(slug, dbPassword);
    const connectionString = buildConnectionString(slug, dbPassword);

    const { key, prefix, hash } = generateApiKey();

    const app = await prisma.application.create({
      data: {
        name,
        slug,
        description,
        createdBy: created_by,
        schemaName: schema,
        dbUser: user,
        connectionKeys: { create: { keyHash: hash, keyPrefix: prefix, label: 'Initial key' } },
      },
    });

    await prisma.auditEvent.create({
      data: { applicationId: app.id, eventType: 'registered', actor: created_by, metadata: JSON.stringify({ slug, schema }) },
    });

    return Response.json({
      id: app.id,
      name: app.name,
      slug: app.slug,
      schema_name: schema,
      connection_string: connectionString,
      api_key: key,
      api_key_prefix: prefix,
      message: 'Store the connection_string and api_key securely — they will not be shown again.',
    }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return apiError(`Registration failed: ${msg}`);
  }
}
