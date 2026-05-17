import { Client } from 'pg';
import { prisma } from '@/lib/db';
import { getIdleAppStatus } from '@/lib/snapshots';

// L-414: one fused per-app health row. Composes data DataNexus already has —
// Application (status + last key-verify), latest TableSnapshot (size/tables/
// rows), pg_stat_activity (live connections), getIdleAppStatus (last write /
// idle). Every registered app appears, including empty/identity-only ones
// (size 0, labeled by the UI — feedback_dashboard_completeness). Each sub-
// source is failure-isolated so one outage never blanks the table.

export interface AppHealthRow {
  slug: string;
  name: string;
  status: string;
  schema: string;
  size_bytes: number;
  tables: number;
  rows: number;
  connections: number;
  active_connections: number;
  last_seen_at: string | null;
  last_write_at: string | null;
  is_idle: boolean;
  days_idle: number | null;
}

export async function getAppHealth(): Promise<AppHealthRow[]> {
  const apps = await prisma.application.findMany({
    where: { status: { not: 'deleted' } },
    select: { id: true, slug: true, name: true, status: true, schemaName: true, dbUser: true, lastSeenAt: true },
    orderBy: { createdAt: 'desc' },
  });

  // size / tables / rows from each app's latest TableSnapshot
  let sizeByApp = new Map<string, { bytes: number; rows: number; tbls: number }>();
  try {
    const sizeRows = await prisma.$queryRaw<
      Array<{ aid: string; bytes: bigint; rows: bigint; tbls: number }>
    >`
      SELECT t."applicationId" AS aid,
             SUM(t."sizeBytes")::bigint AS bytes,
             SUM(t."rowCount")::bigint  AS rows,
             count(*)::int              AS tbls
      FROM "TableSnapshot" t
      JOIN (SELECT "applicationId", MAX("observedAt") AS mo
              FROM "TableSnapshot" GROUP BY "applicationId") l
        ON l."applicationId" = t."applicationId" AND t."observedAt" = l.mo
      GROUP BY t."applicationId"`;
    sizeByApp = new Map(
      sizeRows.map((r) => [r.aid, { bytes: Number(r.bytes), rows: Number(r.rows), tbls: Number(r.tbls) }]),
    );
  } catch {
    /* leave empty — rows still render with 0s */
  }

  // live connections per login role (each app connects as its app_<slug> role)
  let connByUser = new Map<string, { c: number; a: number }>();
  try {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const res = await client.query(
        `SELECT usename,
                COUNT(*)::int AS c,
                COUNT(*) FILTER (WHERE state = 'active')::int AS a
         FROM pg_stat_activity
         WHERE datname = current_database() AND usename IS NOT NULL
         GROUP BY usename`,
      );
      connByUser = new Map(
        (res.rows as Array<{ usename: string; c: number; a: number }>).map((r) => [
          r.usename,
          { c: Number(r.c), a: Number(r.a) },
        ]),
      );
    } finally {
      await client.end();
    }
  } catch {
    /* leave empty */
  }

  let idleByApp = new Map<string, { last_write_at: string | null; is_idle: boolean; days_idle: number | null }>();
  try {
    const idle = await getIdleAppStatus(7);
    idleByApp = new Map(
      idle.map((i) => [i.applicationId, { last_write_at: i.last_write_at, is_idle: i.is_idle, days_idle: i.days_idle }]),
    );
  } catch {
    /* leave empty */
  }

  return apps.map((a) => {
    const sz = sizeByApp.get(a.id);
    const cn = connByUser.get(a.dbUser);
    const idl = idleByApp.get(a.id);
    return {
      slug: a.slug,
      name: a.name,
      status: a.status,
      schema: a.schemaName,
      size_bytes: sz?.bytes ?? 0,
      tables: sz?.tbls ?? 0,
      rows: sz?.rows ?? 0,
      connections: cn?.c ?? 0,
      active_connections: cn?.a ?? 0,
      last_seen_at: a.lastSeenAt ? a.lastSeenAt.toISOString() : null,
      last_write_at: idl?.last_write_at ?? null,
      is_idle: idl?.is_idle ?? false,
      days_idle: idl?.days_idle ?? null,
    };
  });
}
