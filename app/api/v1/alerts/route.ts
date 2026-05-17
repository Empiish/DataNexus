import { prisma } from '@/lib/db';
import { getIdleAppStatus, getSchemaDiffLog } from '@/lib/snapshots';

export const dynamic = 'force-dynamic';

type Severity = 'info' | 'warning' | 'error';
interface Alert {
  id: string;
  severity: Severity;
  kind: string;
  app: string;
  message: string;
  ts: string;
}

// L-408: alerts synthesized from signals DataNexus already has — idle apps,
// schema drift, non-active apps, stale key activity. No new alerting subsystem,
// no fabricated entries. Read-only; control-plane (Tailnet-only per L-409).
export async function GET() {
  const now = Date.now();
  const apps = await prisma.application.findMany({
    select: { id: true, name: true, status: true, lastSeenAt: true },
  });
  const alerts: Alert[] = [];

  for (const a of apps) {
    if (a.status !== 'active') {
      alerts.push({
        id: `status:${a.id}`,
        severity: a.status === 'disconnected' ? 'warning' : 'info',
        kind: 'app_status',
        app: a.name,
        message: `Application is ${a.status}`,
        ts: new Date().toISOString(),
      });
    }
    if (a.status === 'active' && a.lastSeenAt && now - a.lastSeenAt.getTime() > 7 * 86_400_000) {
      alerts.push({
        id: `stale:${a.id}`,
        severity: 'info',
        kind: 'stale_key',
        app: a.name,
        message: `No key activity since ${a.lastSeenAt.toISOString().slice(0, 10)}`,
        ts: a.lastSeenAt.toISOString(),
      });
    }
  }

  const idle = await getIdleAppStatus(7);
  for (const i of idle) {
    if (i.is_idle) {
      alerts.push({
        id: `idle:${i.applicationId}`,
        severity: 'warning',
        kind: 'idle',
        app: i.name,
        message: `No writes in ${i.days_idle ?? '?'}d`,
        ts: i.last_write_at ?? new Date().toISOString(),
      });
    }
  }

  const driftSince = now - 7 * 86_400_000;
  for (const a of apps) {
    let changes: Awaited<ReturnType<typeof getSchemaDiffLog>> = [];
    try {
      changes = await getSchemaDiffLog(a.id);
    } catch {
      changes = [];
    }
    for (const c of changes.slice(0, 3)) {
      if (new Date(c.observed_at).getTime() < driftSince) continue;
      const n = c.added.length + c.removed.length + c.changed.length;
      alerts.push({
        id: `drift:${a.id}:${c.table}:${c.observed_at}`,
        severity: 'info',
        kind: 'schema_drift',
        app: a.name,
        message: `${c.table}: ${n} column change${n === 1 ? '' : 's'}`,
        ts: c.observed_at,
      });
    }
  }

  alerts.sort((x, y) => new Date(y.ts).getTime() - new Date(x.ts).getTime());
  return Response.json({ alerts: alerts.slice(0, 30), generated_at: new Date().toISOString() });
}
