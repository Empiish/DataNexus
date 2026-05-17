import { prisma } from '@/lib/db';

// L-411: federated "data sources" view. DataNexus hosts ONLY its own Postgres.
// Each non-Postgres source self-reports via its OWN read-only metadata API —
// DataNexus never opens another engine's file/DB directly. Each adapter is
// independently failure-isolated (Promise.allSettled + per-adapter try/catch)
// so one unreachable source never breaks the page. Metadata only — no values.

export type SourceStatus = 'ok' | 'empty' | 'unreachable';

export interface SourceRow {
  id: string;
  label: string;
  type: 'postgres_schema' | 'vault';
  status: SourceStatus;
  size_bytes: number;
  summary: string;
  detail: string;
}

// Adapter 1 — Postgres app schemas DataNexus itself hosts. LEFT JOIN so every
// registered app appears, including empty/identity-only ones (labeled, never
// dropped — feedback_dashboard_completeness).
async function postgresSchemaSources(): Promise<SourceRow[]> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ slug: string; name: string; schema: string; size_bytes: bigint; rows: bigint; tables: number }>
    >`
      SELECT a.slug, a.name, a."schemaName" AS schema,
             COALESCE(s.bytes, 0)::bigint AS size_bytes,
             COALESCE(s.rows, 0)::bigint  AS rows,
             COALESCE(s.tbls, 0)::int     AS tables
      FROM "Application" a
      LEFT JOIN (
        SELECT t."applicationId" AS aid,
               SUM(t."sizeBytes") AS bytes, SUM(t."rowCount") AS rows, count(*) AS tbls
        FROM "TableSnapshot" t
        JOIN (SELECT "applicationId", MAX("observedAt") AS mo
                FROM "TableSnapshot" GROUP BY "applicationId") l
          ON l."applicationId" = t."applicationId" AND t."observedAt" = l.mo
        GROUP BY t."applicationId"
      ) s ON s.aid = a.id
      WHERE a.status <> 'deleted'
      ORDER BY size_bytes DESC`;

    return rows.map((r) => {
      const tables = Number(r.tables);
      const rowCount = Number(r.rows);
      return {
        id: `pg:${r.slug}`,
        label: r.name,
        type: 'postgres_schema' as const,
        status: (tables > 0 ? 'ok' : 'empty') as SourceStatus,
        size_bytes: Number(r.size_bytes),
        summary:
          tables > 0
            ? `${tables} table${tables === 1 ? '' : 's'} · ${rowCount.toLocaleString('en-US')} rows`
            : 'empty — identity-only / no tables',
        detail: r.schema,
      };
    });
  } catch {
    return [
      { id: 'pg:_', label: 'Postgres schemas', type: 'postgres_schema', status: 'unreachable', size_bytes: 0, summary: '—', detail: 'query failed' },
    ];
  }
}

// Adapter 2 — Pandora vault, via its OWN network-trusted metadata endpoint
// (localhost from NOS-resident DataNexus). Metadata only; Pandora's /stats
// returns no secret values by construction. Fully graceful on any failure.
async function pandoraVaultSource(): Promise<SourceRow> {
  const base = process.env.PANDORA_URL ?? 'http://localhost:4500';
  try {
    const res = await fetch(`${base}/stats`, { signal: AbortSignal.timeout(2500), cache: 'no-store' });
    if (!res.ok) {
      return { id: 'pandora', label: 'Pandora vault', type: 'vault', status: 'unreachable', size_bytes: 0, summary: '—', detail: `stats ${res.status}` };
    }
    const s = (await res.json()) as {
      version?: string; db_size_bytes?: number; total_secrets?: number;
      active_apps?: number; pending_requests?: number;
    };
    const secrets = Number(s.total_secrets ?? 0);
    const apps = Number(s.active_apps ?? 0);
    const pending = Number(s.pending_requests ?? 0);
    return {
      id: 'pandora',
      label: 'Pandora vault',
      type: 'vault',
      status: 'ok',
      size_bytes: Number(s.db_size_bytes ?? 0),
      summary: `${secrets} secret${secrets === 1 ? '' : 's'} · ${apps} app${apps === 1 ? '' : 's'}${pending > 0 ? ` · ${pending} pending` : ''}`,
      detail: s.version ? `SQLite+libsodium · v${s.version}` : 'SQLite+libsodium',
    };
  } catch (e) {
    return {
      id: 'pandora',
      label: 'Pandora vault',
      type: 'vault',
      status: 'unreachable',
      size_bytes: 0,
      summary: '—',
      detail: e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'unreachable',
    };
  }
}

export async function getAllSources(): Promise<SourceRow[]> {
  const settled = await Promise.allSettled([postgresSchemaSources(), pandoraVaultSource()]);
  const out: SourceRow[] = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    if (Array.isArray(r.value)) out.push(...r.value);
    else out.push(r.value);
  }
  return out;
}
