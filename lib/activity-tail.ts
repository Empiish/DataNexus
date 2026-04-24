import { Client } from 'pg';
import { prisma } from './db';

export interface ActivityEvent {
  id: string;          // monotonically increasing per-process id
  ts: string;          // ISO timestamp of when this delta was detected
  app_slug: string;
  app_name: string;
  table: string;
  inserts: number;     // delta since last poll
  updates: number;
  deletes: number;
}

type Counters = { ins: number; upd: number; del: number };

const POLL_INTERVAL_MS = 5_000;
const BUFFER_CAP = 100;

// Keyed by `${schema}.${table}`
const lastSnapshot = new Map<string, Counters>();
let buffer: ActivityEvent[] = [];
let nextId = 1;
let pollerStarted = false;
let pollerTimer: NodeJS.Timeout | null = null;

function adminClient() {
  return new Client({ connectionString: process.env.DATABASE_URL });
}

async function pollOnce(): Promise<void> {
  // Load current apps (slug -> name, schema)
  const apps = await prisma.application.findMany({
    where: { status: { not: 'deleted' } },
    select: { slug: true, name: true, schemaName: true },
  });
  if (apps.length === 0) return;

  const schemaList = apps.map(a => a.schemaName);
  const client = adminClient();
  await client.connect();
  try {
    const res = await client.query(
      `SELECT
         n.nspname AS schema,
         c.relname AS table,
         COALESCE(s.n_tup_ins, 0)::bigint AS ins,
         COALESCE(s.n_tup_upd, 0)::bigint AS upd,
         COALESCE(s.n_tup_del, 0)::bigint AS del
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE c.relkind = 'r' AND n.nspname = ANY($1)`,
      [schemaList]
    );

    const now = new Date().toISOString();
    const schemaToApp = new Map<string, { slug: string; name: string }>();
    for (const a of apps) schemaToApp.set(a.schemaName, { slug: a.slug, name: a.name });

    for (const row of res.rows as Array<{ schema: string; table: string; ins: string; upd: string; del: string }>) {
      const key = `${row.schema}.${row.table}`;
      const cur: Counters = { ins: Number(row.ins), upd: Number(row.upd), del: Number(row.del) };
      const prev = lastSnapshot.get(key);
      lastSnapshot.set(key, cur);

      // Skip the first observation of any (schema,table) — can't compute a delta
      if (!prev) continue;

      const dIns = cur.ins - prev.ins;
      const dUpd = cur.upd - prev.upd;
      const dDel = cur.del - prev.del;

      // Guard against counter resets (e.g. pg_stat_reset) which produce negatives
      if (dIns < 0 || dUpd < 0 || dDel < 0) continue;
      if (dIns === 0 && dUpd === 0 && dDel === 0) continue;

      const app = schemaToApp.get(row.schema);
      if (!app) continue;

      buffer.unshift({
        id: `evt_${nextId++}`,
        ts: now,
        app_slug: app.slug,
        app_name: app.name,
        table: row.table,
        inserts: dIns,
        updates: dUpd,
        deletes: dDel,
      });
    }

    if (buffer.length > BUFFER_CAP) buffer = buffer.slice(0, BUFFER_CAP);
  } finally {
    await client.end();
  }
}

function startPoller(): void {
  if (pollerStarted) return;
  pollerStarted = true;
  // Prime the snapshot immediately so subsequent polls can compute deltas
  pollOnce().catch(err => console.error('[activity-tail] initial poll failed:', err));
  pollerTimer = setInterval(() => {
    pollOnce().catch(err => console.error('[activity-tail] poll failed:', err));
  }, POLL_INTERVAL_MS);
  // Don't keep the event loop alive just for this timer
  if (pollerTimer && typeof pollerTimer.unref === 'function') pollerTimer.unref();
}

export function getRecentActivity(limit = 20): { events: ActivityEvent[]; poller_started: boolean } {
  startPoller();
  return {
    events: buffer.slice(0, Math.max(1, Math.min(limit, BUFFER_CAP))),
    poller_started: pollerStarted,
  };
}
