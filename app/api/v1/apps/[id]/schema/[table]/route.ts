import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { introspectTable } from '@/lib/postgres-admin';
import { notFound } from '@/lib/errors';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; table: string }> }) {
  const { id, table } = await params;
  const app = await prisma.application.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!app) return notFound('Application');

  const columns = await introspectTable(app.slug, table);
  if (columns === null) return notFound('Table');

  return Response.json({
    schema_name: app.schemaName,
    table,
    columns,
  });
}
