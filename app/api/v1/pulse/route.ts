import { prisma } from '@/lib/db';

/**
 * GET /api/v1/pulse — federated dashboard pulse.
 *
 * Same contract shape as Loom's /pulse: a small numeric posture plus a
 * 15-bucket × 2-minute audit-event sparkline (30 minutes of activity).
 * Consumed by The Nexus SYSTEMS tile.
 */
export async function GET() {
  try {
    const now = Date.now();
    const SPARK_WINDOW_MS = 30 * 60 * 1000;
    const SPARK_BUCKETS = 15;
    const BUCKET_MS = SPARK_WINDOW_MS / SPARK_BUCKETS;
    const windowStart = new Date(now - SPARK_WINDOW_MS);
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

    const [registry, activeNow, drift, auditToday, lastSync, recentAudit] = await Promise.all([
      prisma.application.count({ where: { status: 'active' } }),
      prisma.application.count({
        where: { status: 'active', lastSeenAt: { gte: oneHourAgo } },
      }),
      prisma.application.count({
        where: {
          status: 'active',
          OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: oneDayAgo } }],
        },
      }),
      prisma.auditEvent.count({ where: { createdAt: { gte: dayStart } } }),
      prisma.application.findFirst({
        where: { status: 'active' },
        orderBy: { lastSeenAt: 'desc' },
        select: { lastSeenAt: true },
      }),
      prisma.auditEvent.findMany({
        where: { createdAt: { gte: windowStart } },
        select: { createdAt: true },
      }),
    ]);

    const sparkline = new Array(SPARK_BUCKETS).fill(0);
    for (const e of recentAudit) {
      const idx = Math.min(
        SPARK_BUCKETS - 1,
        Math.floor((e.createdAt.getTime() - windowStart.getTime()) / BUCKET_MS),
      );
      if (idx >= 0) sparkline[idx]++;
    }

    return Response.json({
      registry,
      active_now: activeNow,
      drift,
      audit_today: auditToday,
      last_sync: lastSync?.lastSeenAt?.toISOString() ?? null,
      sparkline,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json(
      { error: 'pulse_unavailable', detail: err instanceof Error ? err.message : 'unknown' },
      { status: 503 },
    );
  }
}
