import { Client } from 'pg';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// L-408: live connection count per application, from the real pg_stat_activity
// view grouped by login role (each app connects as its app_<slug> role).
// Read-only; control-plane (Tailnet-only per L-409).
export async function GET() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let rows: Array<{ usename: string | null; cnt: number; active: number }> = [];
  try {
    const res = await client.query(
      `SELECT usename,
              COUNT(*)::int AS cnt,
              COUNT(*) FILTER (WHERE state = 'active')::int AS active
       FROM pg_stat_activity
       WHERE datname = current_database() AND usename IS NOT NULL
       GROUP BY usename
       ORDER BY cnt DESC`,
    );
    rows = res.rows;
  } finally {
    await client.end();
  }

  const apps = await prisma.application.findMany({ select: { name: true, dbUser: true } });
  const nameByUser = new Map(apps.map((a) => [a.dbUser, a.name]));

  const byApp = rows.map((r) => ({
    user: r.usename,
    app: r.usename ? (nameByUser.get(r.usename) ?? r.usename) : 'unknown',
    connections: Number(r.cnt),
    active: Number(r.active),
  }));
  const total = byApp.reduce((s, r) => s + r.connections, 0);

  return Response.json({ total, by_app: byApp, generated_at: new Date().toISOString() });
}
