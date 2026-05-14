import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { apiError } from '@/lib/errors';

export async function POST(req: NextRequest) {
  const { key } = await req.json().catch(() => ({}));
  if (typeof key !== 'string' || !key.startsWith('dn_')) {
    return apiError('invalid key', 401);
  }

  const prefix = key.slice(0, 12);
  const candidates = await prisma.connectionKey.findMany({
    where: { keyPrefix: prefix, revokedAt: null },
    include: { application: true },
  });

  for (const candidate of candidates) {
    if (!bcrypt.compareSync(key, candidate.keyHash)) continue;
    if (candidate.application.status !== 'active') {
      return apiError('application inactive', 401);
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.connectionKey.update({ where: { id: candidate.id }, data: { lastUsedAt: now } }),
      prisma.application.update({ where: { id: candidate.application.id }, data: { lastSeenAt: now } }),
    ]);

    return Response.json({
      application_id: candidate.application.id,
      slug: candidate.application.slug,
      name: candidate.application.name,
      status: candidate.application.status,
      key_id: candidate.id,
      label: candidate.label,
      scopes: candidate.scopes ? JSON.parse(candidate.scopes) : [],
    });
  }

  return apiError('invalid key', 401);
}
