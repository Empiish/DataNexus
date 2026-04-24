import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { previewRows } from '@/lib/postgres-admin';
import { notFound } from '@/lib/errors';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; table: string }> }) {
  const { id, table } = await params;
  const app = await prisma.application.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!app) return notFound('Application');

  const limitRaw = req.nextUrl.searchParams.get('limit');
  const limit = limitRaw ? Math.max(1, Math.min(500, parseInt(limitRaw, 10) || 100)) : 100;

  const preview = await previewRows(app.slug, table, limit);
  if (preview === null) return notFound('Table');

  // JSON-serialize Date / BigInt / Buffer values
  const safe = preview.rows.map(row => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) { out[k] = v; continue; }
      if (v instanceof Date) { out[k] = v.toISOString(); continue; }
      if (typeof v === 'bigint') { out[k] = v.toString(); continue; }
      if (Buffer.isBuffer(v)) { out[k] = `<binary ${v.length} bytes>`; continue; }
      out[k] = v;
    }
    return out;
  });

  return Response.json({
    table,
    rows: safe,
    order_by: preview.order_by,
    order_direction: preview.order_direction,
    total_estimate: preview.total_estimate,
    returned: safe.length,
  });
}
