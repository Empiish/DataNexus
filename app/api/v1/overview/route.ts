import { prisma } from '@/lib/db';
import { getIdleAppStatus } from '@/lib/snapshots';
import { getRecentActivity } from '@/lib/activity-tail';

export const dynamic = 'force-dynamic';

// L-408: one aggregate read for the new overview widgets (stat cards, app-size
// donut, write-throughput chart, composite system health). Every field traces
// to a real query — no fabricated metrics. Control-plane read (Tailnet-only
// per L-409); no new auth surface.
export async function GET() {
  const now = Date.now();

  let pgOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    pgOk = false;
  }

  const [totalApps, activeApps, activeKeys, latestSnap, sizeRows, idle] = await Promise.all([
    prisma.application.count(),
    prisma.application.count({ where: { status: 'active' } }),
    prisma.connectionKey.count({ where: { revokedAt: null } }),
    prisma.tableSnapshot.findFirst({ orderBy: { observedAt: 'desc' }, select: { observedAt: true } }),
    prisma.$queryRaw<Array<{ slug: string; name: string; sz: bigint; rc: bigint }>>`
      SELECT a.slug, a.name,
             SUM(t."sizeBytes")::bigint AS sz, SUM(t."rowCount")::bigint AS rc
      FROM "TableSnapshot" t
      JOIN (SELECT "applicationId", MAX("observedAt") AS mo
              FROM "TableSnapshot" GROUP BY "applicationId") l
        ON l."applicationId" = t."applicationId" AND t."observedAt" = l.mo
      JOIN "Application" a ON a.id = t."applicationId"
      GROUP BY a.slug, a.name
      ORDER BY sz DESC`,
    getIdleAppStatus(7),
  ]);

  const perApp = sizeRows.map((r) => ({
    slug: r.slug,
    name: r.name,
    size_bytes: Number(r.sz),
    rows: Number(r.rc),
  }));
  const totalSize = perApp.reduce((s, a) => s + a.size_bytes, 0);
  const totalRows = perApp.reduce((s, a) => s + a.rows, 0);
  const idleCount = idle.filter((a) => a.is_idle).length;

  // Snapshotter ticks every 5 min; if the newest snapshot is <15 min old it's alive.
  const lastSnapMs = latestSnap ? latestSnap.observedAt.getTime() : null;
  const snapAgeSec = lastSnapMs ? Math.floor((now - lastSnapMs) / 1000) : null;
  const snapshotterOk = snapAgeSec !== null && snapAgeSec < 15 * 60;

  const { poller_started } = getRecentActivity(1);

  // 24h hourly write-throughput: diff cumulative ins+upd+del per (app,table)
  // within each hour bucket, summed across all apps. Same delta technique as
  // lib/snapshots getWriteHeatmap.
  const since = new Date(now - 24 * 3600_000);
  const snaps = await prisma.tableSnapshot.findMany({
    where: { observedAt: { gte: since } },
    orderBy: { observedAt: 'asc' },
    select: { applicationId: true, tableName: true, observedAt: true, inserts: true, updates: true, deletes: true },
  });
  const perKey = new Map<string, { min: bigint; max: bigint }>();
  for (const s of snaps) {
    const bucket = Math.floor(s.observedAt.getTime() / 3600_000) * 3600_000;
    const k = `${s.applicationId}|${s.tableName}|${bucket}`;
    const total = s.inserts + s.updates + s.deletes;
    const cur = perKey.get(k);
    if (!cur) perKey.set(k, { min: total, max: total });
    else {
      if (total < cur.min) cur.min = total;
      if (total > cur.max) cur.max = total;
    }
  }
  const perBucket = new Map<number, number>();
  for (const [k, slot] of perKey) {
    const bucket = Number(k.split('|')[2]);
    perBucket.set(bucket, (perBucket.get(bucket) ?? 0) + Number(slot.max - slot.min));
  }
  const nowBucket = Math.floor(now / 3600_000) * 3600_000;
  const writeSeries: Array<{ bucket: string; writes: number }> = [];
  for (let i = 23; i >= 0; i--) {
    const b = nowBucket - i * 3600_000;
    writeSeries.push({ bucket: new Date(b).toISOString(), writes: perBucket.get(b) ?? 0 });
  }

  return Response.json({
    apps: { total: totalApps, active: activeApps, idle: idleCount },
    keys: { active: activeKeys },
    data: { total_size_bytes: totalSize, total_rows: totalRows, per_app: perApp },
    write_series_24h: writeSeries,
    health: {
      postgres: pgOk,
      snapshotter: snapshotterOk,
      poller: poller_started,
      last_snapshot_age_sec: snapAgeSec,
      ok: pgOk && snapshotterOk && poller_started,
      version: '0.1.0',
      uptime_sec: Math.floor(process.uptime()),
      region: process.env.DN_REGION ?? 'nos-core',
    },
    generated_at: new Date().toISOString(),
  });
}
