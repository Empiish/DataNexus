import { Client } from 'pg';
import { createHash } from 'crypto';
import { prisma } from './db';

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;       // 5 minutes
const RETENTION_DAYS = 30;
const COLUMN_SNAPSHOT_EVERY_N_SNAPSHOTS = 12;     // ~every 60 min

let snapshotterStarted = false;
let snapshotTimer: NodeJS.Timeout | null = null;
let snapshotTick = 0;

function adminClient() {
  return new Client({ connectionString: process.env.DATABASE_URL });
}

async function takeSnapshot(): Promise<void> {
  const apps = await prisma.application.findMany({
    where: { status: { not: 'deleted' } },
    select: { id: true, slug: true, schemaName: true },
  });
  if (apps.length === 0) return;

  const schemaList = apps.map(a => a.schemaName);
  const schemaToAppId = new Map<string, string>();
  for (const a of apps) schemaToAppId.set(a.schemaName, a.id);

  const includeColumns = (snapshotTick % COLUMN_SNAPSHOT_EVERY_N_SNAPSHOTS) === 0;
  snapshotTick++;

  const client = adminClient();
  await client.connect();
  try {
    const statsRes = await client.query(
      `SELECT
         n.nspname AS schema,
         c.relname AS table,
         pg_total_relation_size(c.oid)::bigint AS size_bytes,
         COALESCE(s.n_live_tup, 0)::bigint AS row_count,
         COALESCE(s.n_tup_ins, 0)::bigint AS ins,
         COALESCE(s.n_tup_upd, 0)::bigint AS upd,
         COALESCE(s.n_tup_del, 0)::bigint AS del
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE c.relkind = 'r' AND n.nspname = ANY($1)`,
      [schemaList]
    );

    const now = new Date();
    const rows: Array<{ schema: string; table: string; size_bytes: string; row_count: string; ins: string; upd: string; del: string }> = statsRes.rows;

    // Bulk insert table snapshots
    if (rows.length > 0) {
      await prisma.tableSnapshot.createMany({
        data: rows.flatMap(r => {
          const appId = schemaToAppId.get(r.schema);
          if (!appId) return [];
          return [{
            applicationId: appId,
            tableName: r.table,
            observedAt: now,
            rowCount: BigInt(r.row_count),
            sizeBytes: BigInt(r.size_bytes),
            inserts: BigInt(r.ins),
            updates: BigInt(r.upd),
            deletes: BigInt(r.del),
          }];
        }),
      });
    }

    // Optionally capture column snapshots this tick
    if (includeColumns) {
      const colsRes = await client.query(
        `SELECT
           c.table_schema AS schema,
           c.table_name   AS table,
           c.column_name  AS name,
           c.data_type,
           c.is_nullable,
           c.ordinal_position,
           EXISTS (
             SELECT 1 FROM information_schema.key_column_usage kcu
             JOIN information_schema.table_constraints tc
               ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema   = kcu.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY'
               AND kcu.table_schema  = c.table_schema
               AND kcu.table_name    = c.table_name
               AND kcu.column_name   = c.column_name
           ) AS is_pk
         FROM information_schema.columns c
         WHERE c.table_schema = ANY($1)
         ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
        [schemaList]
      );

      // Group by (schema, table)
      const byTable = new Map<string, Array<{ name: string; data_type: string; is_nullable: boolean; is_pk: boolean }>>();
      for (const r of colsRes.rows as Array<{ schema: string; table: string; name: string; data_type: string; is_nullable: string; is_pk: boolean }>) {
        const key = `${r.schema}.${r.table}`;
        if (!byTable.has(key)) byTable.set(key, []);
        byTable.get(key)!.push({
          name: r.name,
          data_type: r.data_type,
          is_nullable: r.is_nullable === 'YES',
          is_pk: r.is_pk,
        });
      }

      const colSnaps: Array<{ applicationId: string; tableName: string; observedAt: Date; columnsHash: string; columns: string }> = [];
      for (const [key, cols] of byTable.entries()) {
        const [schema, table] = key.split('.', 2);
        const appId = schemaToAppId.get(schema);
        if (!appId) continue;
        const json = JSON.stringify(cols);
        const hash = createHash('sha256').update(json).digest('hex').slice(0, 32);
        colSnaps.push({
          applicationId: appId,
          tableName: table,
          observedAt: now,
          columnsHash: hash,
          columns: json,
        });
      }
      if (colSnaps.length > 0) {
        await prisma.columnSnapshot.createMany({ data: colSnaps });
      }
    }

    // Retention: drop snapshots older than 30 days
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
    await prisma.tableSnapshot.deleteMany({ where: { observedAt: { lt: cutoff } } });
    await prisma.columnSnapshot.deleteMany({ where: { observedAt: { lt: cutoff } } });
  } finally {
    await client.end();
  }
}

export function startSnapshotter(): void {
  if (snapshotterStarted) return;
  snapshotterStarted = true;
  takeSnapshot().catch(err => console.error('[snapshots] initial snapshot failed:', err));
  snapshotTimer = setInterval(() => {
    takeSnapshot().catch(err => console.error('[snapshots] snapshot failed:', err));
  }, SNAPSHOT_INTERVAL_MS);
  if (snapshotTimer && typeof snapshotTimer.unref === 'function') snapshotTimer.unref();
}

// ----- Query helpers ------------------------------------------------------

export interface SparklineBucket {
  bucket: string;      // ISO start of bucket
  inserts: number;
  updates: number;
  deletes: number;
}

export interface SparklineData {
  granularity: 'hour' | 'day';
  span: '24h' | '30d';
  buckets: SparklineBucket[];
}

// Compute rows-per-hour (24h) or rows-per-day (30d) by diffing adjacent
// cumulative-counter snapshots.
export async function getSparkline(
  applicationId: string,
  tableName: string,
  span: '24h' | '30d',
): Promise<SparklineData> {
  const now = new Date();
  const windowMs = span === '24h' ? 24 * 3600_000 : 30 * 86_400_000;
  const bucketMs = span === '24h' ? 3600_000 : 86_400_000;
  const since = new Date(now.getTime() - windowMs);

  const snaps = await prisma.tableSnapshot.findMany({
    where: { applicationId, tableName, observedAt: { gte: since } },
    orderBy: { observedAt: 'asc' },
    select: { observedAt: true, inserts: true, updates: true, deletes: true },
  });

  // Bucket each snapshot; record first/last per bucket.
  type Slot = { min: { ins: bigint; upd: bigint; del: bigint } | null; max: { ins: bigint; upd: bigint; del: bigint } | null };
  const buckets = new Map<number, Slot>();
  for (const s of snaps) {
    const t = s.observedAt.getTime();
    const b = Math.floor(t / bucketMs) * bucketMs;
    const slot = buckets.get(b) ?? { min: null, max: null };
    const cur = { ins: s.inserts, upd: s.updates, del: s.deletes };
    if (!slot.min || s.observedAt.getTime() < (slot as Slot & { minTs?: number }).minTs!) {
      slot.min = cur;
      (slot as Slot & { minTs?: number }).minTs = t;
    }
    if (!slot.max || s.observedAt.getTime() > (slot as Slot & { maxTs?: number }).maxTs!) {
      slot.max = cur;
      (slot as Slot & { maxTs?: number }).maxTs = t;
    }
    buckets.set(b, slot);
  }

  // Convert: delta = max - min within bucket.
  const result: SparklineBucket[] = [];
  const nowBucket = Math.floor(now.getTime() / bucketMs) * bucketMs;
  const spanBuckets = span === '24h' ? 24 : 30;
  for (let i = spanBuckets - 1; i >= 0; i--) {
    const b = nowBucket - i * bucketMs;
    const slot = buckets.get(b);
    if (!slot || !slot.min || !slot.max) {
      result.push({ bucket: new Date(b).toISOString(), inserts: 0, updates: 0, deletes: 0 });
      continue;
    }
    result.push({
      bucket: new Date(b).toISOString(),
      inserts: Number(slot.max.ins - slot.min.ins),
      updates: Number(slot.max.upd - slot.min.upd),
      deletes: Number(slot.max.del - slot.min.del),
    });
  }

  return { granularity: span === '24h' ? 'hour' : 'day', span, buckets: result };
}

export interface SizeDelta {
  size_now: number;
  size_24h_ago: number | null;
  size_7d_ago: number | null;
  delta_24h: number | null;
  delta_7d: number | null;
  rows_now: number;
  rows_24h_ago: number | null;
  rows_7d_ago: number | null;
}

export async function getSizeDeltas(applicationId: string, tableName: string): Promise<SizeDelta> {
  const latest = await prisma.tableSnapshot.findFirst({
    where: { applicationId, tableName },
    orderBy: { observedAt: 'desc' },
  });
  if (!latest) return {
    size_now: 0, size_24h_ago: null, size_7d_ago: null,
    delta_24h: null, delta_7d: null,
    rows_now: 0, rows_24h_ago: null, rows_7d_ago: null,
  };

  const now = latest.observedAt.getTime();
  const findNearest = async (targetMsAgo: number) => {
    const target = new Date(now - targetMsAgo);
    // Nearest snapshot within ±10% window
    const tolerance = Math.max(targetMsAgo * 0.1, 3600_000);
    const hit = await prisma.tableSnapshot.findFirst({
      where: {
        applicationId, tableName,
        observedAt: { gte: new Date(target.getTime() - tolerance), lte: new Date(target.getTime() + tolerance) },
      },
      orderBy: { observedAt: 'asc' },
    });
    return hit;
  };

  const s24 = await findNearest(24 * 3600_000);
  const s7d = await findNearest(7 * 86_400_000);

  const sizeNow = Number(latest.sizeBytes);
  const rowsNow = Number(latest.rowCount);
  return {
    size_now: sizeNow,
    size_24h_ago: s24 ? Number(s24.sizeBytes) : null,
    size_7d_ago: s7d ? Number(s7d.sizeBytes) : null,
    delta_24h: s24 ? sizeNow - Number(s24.sizeBytes) : null,
    delta_7d: s7d ? sizeNow - Number(s7d.sizeBytes) : null,
    rows_now: rowsNow,
    rows_24h_ago: s24 ? Number(s24.rowCount) : null,
    rows_7d_ago: s7d ? Number(s7d.rowCount) : null,
  };
}

export interface HeatmapCell {
  day: string;         // ISO date (YYYY-MM-DD)
  hour: number;        // 0-23
  inserts: number;
  updates: number;
  deletes: number;
  total: number;
}

// Writes per hour over the last N days, summed across all tables of the app.
export async function getWriteHeatmap(applicationId: string, days = 14): Promise<HeatmapCell[]> {
  const now = new Date();
  const since = new Date(now.getTime() - days * 86_400_000);
  const snaps = await prisma.tableSnapshot.findMany({
    where: { applicationId, observedAt: { gte: since } },
    orderBy: { observedAt: 'asc' },
    select: { tableName: true, observedAt: true, inserts: true, updates: true, deletes: true },
  });

  // Diff within each (table, hourBucket)
  type Slot = { minIns: bigint; maxIns: bigint; minUpd: bigint; maxUpd: bigint; minDel: bigint; maxDel: bigint };
  const key = (table: string, bucket: number) => `${table}|${bucket}`;
  const slots = new Map<string, Slot>();
  for (const s of snaps) {
    const bucket = Math.floor(s.observedAt.getTime() / 3600_000) * 3600_000;
    const k = key(s.tableName, bucket);
    const slot = slots.get(k);
    if (!slot) {
      slots.set(k, { minIns: s.inserts, maxIns: s.inserts, minUpd: s.updates, maxUpd: s.updates, minDel: s.deletes, maxDel: s.deletes });
    } else {
      if (s.inserts < slot.minIns) slot.minIns = s.inserts;
      if (s.inserts > slot.maxIns) slot.maxIns = s.inserts;
      if (s.updates < slot.minUpd) slot.minUpd = s.updates;
      if (s.updates > slot.maxUpd) slot.maxUpd = s.updates;
      if (s.deletes < slot.minDel) slot.minDel = s.deletes;
      if (s.deletes > slot.maxDel) slot.maxDel = s.deletes;
    }
  }

  // Roll up per hour-bucket across all tables
  const perBucket = new Map<number, { ins: number; upd: number; del: number }>();
  for (const [k, slot] of slots.entries()) {
    const bucket = Number(k.split('|')[1]);
    const agg = perBucket.get(bucket) ?? { ins: 0, upd: 0, del: 0 };
    agg.ins += Number(slot.maxIns - slot.minIns);
    agg.upd += Number(slot.maxUpd - slot.minUpd);
    agg.del += Number(slot.maxDel - slot.minDel);
    perBucket.set(bucket, agg);
  }

  const cells: HeatmapCell[] = [];
  const nowBucket = Math.floor(now.getTime() / 3600_000) * 3600_000;
  for (let i = days * 24 - 1; i >= 0; i--) {
    const b = nowBucket - i * 3600_000;
    const d = new Date(b);
    const agg = perBucket.get(b) ?? { ins: 0, upd: 0, del: 0 };
    cells.push({
      day: d.toISOString().slice(0, 10),
      hour: d.getUTCHours(),
      inserts: agg.ins,
      updates: agg.upd,
      deletes: agg.del,
      total: agg.ins + agg.upd + agg.del,
    });
  }
  return cells;
}

export interface SchemaChange {
  observed_at: string;
  table: string;
  added: Array<{ name: string; data_type: string }>;
  removed: Array<{ name: string; data_type: string }>;
  changed: Array<{ name: string; from: string; to: string }>;
}

export async function getSchemaDiffLog(applicationId: string): Promise<SchemaChange[]> {
  const snaps = await prisma.columnSnapshot.findMany({
    where: { applicationId },
    orderBy: { observedAt: 'asc' },
  });

  // Group by table, walk in order, emit diff when hash changes
  const byTable = new Map<string, typeof snaps>();
  for (const s of snaps) {
    const list = byTable.get(s.tableName) ?? [];
    list.push(s);
    byTable.set(s.tableName, list);
  }

  const changes: SchemaChange[] = [];
  for (const [table, list] of byTable.entries()) {
    for (let i = 1; i < list.length; i++) {
      if (list[i].columnsHash === list[i - 1].columnsHash) continue;
      const prev = JSON.parse(list[i - 1].columns) as Array<{ name: string; data_type: string }>;
      const cur = JSON.parse(list[i].columns) as Array<{ name: string; data_type: string }>;
      const prevMap = new Map(prev.map(c => [c.name, c.data_type]));
      const curMap = new Map(cur.map(c => [c.name, c.data_type]));

      const added = cur.filter(c => !prevMap.has(c.name));
      const removed = prev.filter(c => !curMap.has(c.name));
      const changed: Array<{ name: string; from: string; to: string }> = [];
      for (const c of cur) {
        const was = prevMap.get(c.name);
        if (was && was !== c.data_type) changed.push({ name: c.name, from: was, to: c.data_type });
      }
      if (added.length + removed.length + changed.length === 0) continue;
      changes.push({
        observed_at: list[i].observedAt.toISOString(),
        table,
        added, removed, changed,
      });
    }
  }
  changes.sort((a, b) => b.observed_at.localeCompare(a.observed_at));
  return changes;
}

export interface IdleAppStatus {
  applicationId: string;
  slug: string;
  name: string;
  last_write_at: string | null;
  days_idle: number | null;
  is_idle: boolean;        // no writes in past 7 days
}

export async function getIdleAppStatus(idleThresholdDays = 7): Promise<IdleAppStatus[]> {
  const apps = await prisma.application.findMany({
    where: { status: { not: 'deleted' } },
    select: { id: true, slug: true, name: true },
  });
  if (apps.length === 0) return [];

  const now = new Date();
  const results: IdleAppStatus[] = [];
  for (const app of apps) {
    // Walk snapshots in reverse; find the most recent bucket with a positive write delta.
    const recent = await prisma.tableSnapshot.findMany({
      where: { applicationId: app.id },
      orderBy: { observedAt: 'desc' },
      take: 500,
    });
    // Group by table, find the latest moment the cumulative counter increased.
    type PerTable = Array<{ t: number; total: bigint }>;
    const byTable = new Map<string, PerTable>();
    for (const s of recent) {
      const arr = byTable.get(s.tableName) ?? [];
      arr.push({ t: s.observedAt.getTime(), total: s.inserts + s.updates + s.deletes });
      byTable.set(s.tableName, arr);
    }

    let lastWriteMs: number | null = null;
    for (const arr of byTable.values()) {
      // arr is desc by time; scan from newest, find first gap where newer > older
      for (let i = 0; i < arr.length - 1; i++) {
        if (arr[i].total > arr[i + 1].total) {
          const t = arr[i].t;
          if (lastWriteMs === null || t > lastWriteMs) lastWriteMs = t;
          break;
        }
      }
    }

    const daysIdle = lastWriteMs ? (now.getTime() - lastWriteMs) / 86_400_000 : null;
    results.push({
      applicationId: app.id,
      slug: app.slug,
      name: app.name,
      last_write_at: lastWriteMs ? new Date(lastWriteMs).toISOString() : null,
      days_idle: daysIdle ? Math.floor(daysIdle * 10) / 10 : null,
      is_idle: daysIdle === null ? false : daysIdle >= idleThresholdDays,
    });
  }
  return results;
}
