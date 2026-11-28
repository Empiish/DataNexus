import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { introspectSchema } from '@/lib/postgres-admin';
import { notFound } from '@/lib/errors';
import { requireAdmin } from '@/lib/admin-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await params;
  const app = await prisma.application.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!app) return notFound('Application');

  const tables = await introspectSchema(app.slug);
  return Response.json({ schema_name: app.schemaName, tables });
}
