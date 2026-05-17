'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface App {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  created_by: string;
  schema_name: string;
  created_at: string;
  active_keys: number;
}

interface ActivityEvent {
  id: string;
  ts: string;
  app_slug: string;
  app_name: string;
  table: string;
  inserts: number;
  updates: number;
  deletes: number;
}

interface IdleApp {
  applicationId: string;
  slug: string;
  name: string;
  last_write_at: string | null;
  days_idle: number | null;
  is_idle: boolean;
}

interface Overview {
  apps: { total: number; active: number; idle: number };
  keys: { active: number };
  data: { total_size_bytes: number; total_rows: number; per_app: Array<{ slug: string; name: string; size_bytes: number; rows: number }> };
  write_series_24h: Array<{ bucket: string; writes: number }>;
  health: { postgres: boolean; snapshotter: boolean; poller: boolean; last_snapshot_age_sec: number | null; ok: boolean };
}

interface ConnRow { user: string | null; app: string; connections: number; active: number }
interface Alert { id: string; severity: 'info' | 'warning' | 'error'; kind: string; app: string; message: string; ts: string }
interface SourceRow { id: string; label: string; type: 'postgres_schema' | 'vault'; status: 'ok' | 'empty' | 'unreachable'; size_bytes: number; summary: string; detail: string }
interface AppHealth { slug: string; name: string; status: string; schema: string; size_bytes: number; tables: number; rows: number; connections: number; active_connections: number; last_seen_at: string | null; last_write_at: string | null; is_idle: boolean; days_idle: number | null }

function timeAgoShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 5_000) return 'now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function fmtBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

const SEG_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

function Donut({ data }: { data: Array<{ name: string; size_bytes: number }> }) {
  const top = [...data].sort((a, b) => b.size_bytes - a.size_bytes).slice(0, 4);
  const rest = data.slice(4).reduce((s, d) => s + d.size_bytes, 0);
  const segs = rest > 0 ? [...top, { name: 'Other', size_bytes: rest }] : top;
  const total = segs.reduce((s, d) => s + d.size_bytes, 0) || 1;
  const R = 54;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--color-bg-tertiary)" strokeWidth="16" />
        {segs.map((s, i) => {
          const frac = s.size_bytes / total;
          const len = frac * C;
          const el = (
            <circle
              key={s.name}
              cx="70" cy="70" r={R} fill="none"
              stroke={SEG_COLORS[i % SEG_COLORS.length]}
              strokeWidth="16"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
            />
          );
          offset += len;
          return el;
        })}
        <text x="70" y="66" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--color-text-primary)">
          {fmtBytes(total).split(' ')[0]}
        </text>
        <text x="70" y="84" textAnchor="middle" fontSize="10" fill="var(--color-text-tertiary)">
          {fmtBytes(total).split(' ')[1]} total
        </text>
      </svg>
      <div className="donut-legend">
        {segs.map((s, i) => (
          <div className="legend-row" key={s.name}>
            <span className="legend-swatch" style={{ background: SEG_COLORS[i % SEG_COLORS.length] }} />
            {s.name}
            <span className="val">{fmtBytes(s.size_bytes)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AreaChart({ series }: { series: Array<{ bucket: string; writes: number }> }) {
  const W = 600;
  const H = 120;
  const pad = 4;
  const max = Math.max(1, ...series.map((s) => s.writes));
  const n = series.length;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, n - 1);
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const line = series.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(s.writes).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  return (
    <svg className="areachart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="wt-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#wt-grad)" />
      <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export default function Dashboard() {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [pollerStarted, setPollerStarted] = useState(false);
  const [idleApps, setIdleApps] = useState<IdleApp[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [conns, setConns] = useState<ConnRow[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [appHealth, setAppHealth] = useState<AppHealth[]>([]);

  useEffect(() => {
    fetch('/api/v1/apps')
      .then((r) => r.json())
      .then((data) => { setApps(data); setLoading(false); });

    fetch('/api/v1/activity/idle?days=7')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setIdleApps(d.apps ?? []); })
      .catch(() => {});

    const slow = () => {
      fetch('/api/v1/overview').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setOverview(d); }).catch(() => {});
      fetch('/api/v1/connections').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setConns(d.by_app ?? []); }).catch(() => {});
      fetch('/api/v1/alerts').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setAlerts(d.alerts ?? []); }).catch(() => {});
      fetch('/api/v1/sources').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setSources(d.sources ?? []); }).catch(() => {});
      fetch('/api/v1/app-health').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setAppHealth(d.apps ?? []); }).catch(() => {});
    };
    slow();
    const st = setInterval(slow, 20_000);

    const fetchActivity = () => {
      fetch('/api/v1/activity/tail?limit=20')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) { setActivity(d.events ?? []); setPollerStarted(!!d.poller_started); } })
        .catch(() => {});
    };
    fetchActivity();
    const t = setInterval(fetchActivity, 5_000);
    return () => { clearInterval(t); clearInterval(st); };
  }, []);

  const active = apps.filter((a) => a.status === 'active').length;
  const totalKeys = apps.reduce((sum, a) => sum + a.active_keys, 0);
  const idleVisible = idleApps.filter((a) => a.is_idle);

  const healthSegs: Array<{ name: string; ok: boolean | null; detail: string }> = overview
    ? [
        { name: 'PostgreSQL', ok: overview.health.postgres, detail: overview.health.postgres ? 'reachable' : 'unreachable' },
        { name: 'Snapshotter', ok: overview.health.snapshotter, detail: overview.health.snapshotter ? 'running' : 'stale' },
        { name: 'Activity poller', ok: overview.health.poller, detail: overview.health.poller ? 'running' : 'idle' },
        {
          name: 'Last snapshot',
          ok: overview.health.last_snapshot_age_sec !== null && overview.health.last_snapshot_age_sec < 900,
          detail: overview.health.last_snapshot_age_sec !== null ? `${Math.floor(overview.health.last_snapshot_age_sec / 60)}m ago` : 'never',
        },
      ]
    : [];

  return (
    <>
      <header className="main-header">
        <h1>Overview</h1>
        <span className="subtitle">Real-time view of your data infrastructure</span>
      </header>
      <main className="main-content animate-in">
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-value">{loading ? '—' : apps.length}</div>
            <div className="stat-label">Total apps</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--color-success)' }}>{loading ? '—' : active}</div>
            <div className="stat-label">Active</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{loading ? '—' : totalKeys}</div>
            <div className="stat-label">Active keys</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{overview ? fmtBytes(overview.data.total_size_bytes) : '—'}</div>
            <div className="stat-label">Total data size</div>
            {overview && <div className="stat-sub">{fmtNum(overview.data.total_rows)} rows</div>}
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: idleVisible.length ? 'var(--color-warning)' : undefined }}>
              {overview ? overview.apps.idle : '—'}
            </div>
            <div className="stat-label">Idle apps</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: overview ? (overview.health.ok ? 'var(--color-success)' : 'var(--color-error)') : undefined }}>
              {overview ? (overview.health.ok ? 'OK' : 'Degraded') : '—'}
            </div>
            <div className="stat-label">System health</div>
          </div>
        </div>

        {/* Idle apps callout (L-094) — preserved */}
        {idleVisible.length > 0 && (
          <div className="card" style={{ border: '1px solid var(--color-warning)', background: 'var(--color-warning-light)', marginBottom: 18 }}>
            <div className="card-header" style={{ background: 'transparent' }}>
              <h2 style={{ color: 'var(--color-warning)' }}>⚠ Idle apps ({idleVisible.length})</h2>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>no writes in past 7 days</span>
            </div>
            <table>
              <thead><tr><th>App</th><th>Last write</th><th style={{ textAlign: 'right' }}>Days idle</th></tr></thead>
              <tbody>
                {idleVisible.map((a) => (
                  <tr key={a.applicationId}>
                    <td><Link href={`/apps/${a.slug}`} style={{ color: 'var(--color-accent)', textDecoration: 'none', fontWeight: 500 }}>{a.name}</Link></td>
                    <td style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>{a.last_write_at ? new Date(a.last_write_at).toLocaleString() : 'never'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--color-warning)', fontWeight: 600 }}>{a.days_idle !== null ? `${a.days_idle}d` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="dash-grid">
          <div className="section-gap">
            {/* Applications health — complete per-app fused view (L-414) */}
            <div className="card">
              <div className="card-header">
                <h2>Applications health</h2>
                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  {appHealth.length} app{appHealth.length === 1 ? '' : 's'} · every registered app
                </span>
              </div>
              {appHealth.length === 0 ? (
                <div className="empty-state">Loading…</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>App</th><th>Status</th>
                      <th style={{ textAlign: 'right' }}>Size</th>
                      <th style={{ textAlign: 'right' }}>Conns</th>
                      <th>Last seen</th><th>Activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appHealth.map((a) => (
                      <tr key={a.slug}>
                        <td>
                          <Link href={`/apps/${a.slug}`} style={{ color: 'var(--color-accent)', textDecoration: 'none', fontWeight: 500 }}>{a.name}</Link>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{a.schema}</div>
                        </td>
                        <td><span className={`badge badge-${a.status}`}>{a.status}</span></td>
                        <td style={{ textAlign: 'right' }}>
                          {a.tables > 0 ? (
                            <>
                              <span style={{ fontWeight: 600 }}>{fmtBytes(a.size_bytes)}</span>
                              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{a.tables}t · {fmtNum(a.rows)}r</div>
                            </>
                          ) : (
                            <span style={{ color: 'var(--color-text-tertiary)' }}>— identity-only</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', color: a.connections > 0 ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>
                          {a.connections > 0 ? `${a.active_connections}/${a.connections}` : '—'}
                        </td>
                        <td style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }} title={a.last_seen_at ?? ''}>
                          {a.last_seen_at ? `${timeAgoShort(a.last_seen_at)} ago` : 'never'}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {a.is_idle ? (
                            <span style={{ color: 'var(--color-warning)' }}>idle {a.days_idle ?? '?'}d</span>
                          ) : a.last_write_at ? (
                            <span style={{ color: 'var(--color-text-secondary)' }}>{timeAgoShort(a.last_write_at)} ago</span>
                          ) : (
                            <span style={{ color: 'var(--color-text-tertiary)' }}>no writes</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <h2>Write throughput</h2>
                <div className="range-tabs">
                  <button className="range-tab active">24h</button>
                  <button className="range-tab" disabled title="Not implemented yet">30d</button>
                </div>
              </div>
              <div className="card-body">
                {overview ? <AreaChart series={overview.write_series_24h} /> : <div className="empty-state">Loading…</div>}
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
                  Rows written (insert + update + delete) per hour, all apps · last 24h
                </div>
              </div>
            </div>

            <div className="grid-2">
              <div className="card">
                <div className="card-header"><h2>Data size by app</h2></div>
                <div className="card-body">
                  {overview && overview.data.per_app.length > 0
                    ? <Donut data={overview.data.per_app} />
                    : <div className="empty-state">No snapshots yet.</div>}
                </div>
              </div>
              <div className="card">
                <div className="card-header"><h2>System status</h2></div>
                <div className="card-body">
                  {healthSegs.length === 0
                    ? <div className="empty-state">Loading…</div>
                    : healthSegs.map((s) => (
                        <div className="status-row" key={s.name}>
                          <span className={`dot ${s.ok === null ? 'dot-idle' : s.ok ? 'dot-ok' : 'dot-err'}`} />
                          <span className="name">{s.name}</span>
                          <span className="state" style={{ color: s.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{s.detail}</span>
                        </div>
                      ))}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h2>Active connections by app</h2>
                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  {conns.reduce((s, c) => s + c.connections, 0)} total · pg_stat_activity
                </span>
              </div>
              {conns.length === 0 ? (
                <div className="empty-state">No active connections.</div>
              ) : (
                <table>
                  <thead><tr><th>App</th><th>Role</th><th style={{ textAlign: 'right' }}>Active</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                  <tbody>
                    {conns.map((c) => (
                      <tr key={c.user ?? c.app}>
                        <td style={{ color: 'var(--color-text-primary)' }}>{c.app}</td>
                        <td><span className="mono">{c.user}</span></td>
                        <td style={{ textAlign: 'right' }}>{c.active}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{c.connections}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Data sources — federated read-only view (L-411) */}
            <div className="card">
              <div className="card-header">
                <h2>Data sources</h2>
                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  {sources.length} source{sources.length === 1 ? '' : 's'} · federated, read-only
                </span>
              </div>
              {sources.length === 0 ? (
                <div className="empty-state">Loading…</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Source</th><th>Type</th><th>Status</th>
                      <th style={{ textAlign: 'right' }}>Size</th><th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{s.label}</span>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{s.detail}</div>
                        </td>
                        <td><span className="badge" style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}>{s.type === 'vault' ? 'Vault' : 'PG schema'}</span></td>
                        <td>
                          <span className={`dot ${s.status === 'ok' ? 'dot-ok' : s.status === 'empty' ? 'dot-idle' : 'dot-err'}`} style={{ display: 'inline-block', marginRight: 6, verticalAlign: 'middle' }} />
                          <span style={{ fontSize: 12, color: s.status === 'unreachable' ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>{s.status}</span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{s.size_bytes > 0 ? fmtBytes(s.size_bytes) : '—'}</td>
                        <td style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>{s.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Live activity tail — preserved (5s poll) */}
            <div className="card">
              <div className="card-header">
                <h2>Live activity</h2>
                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  {pollerStarted ? (
                    <><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--color-success)', marginRight: 6, verticalAlign: 'middle' }} />polling every 5s</>
                  ) : 'waking poller…'}
                </span>
              </div>
              {activity.length === 0 ? (
                <div className="empty-state">{pollerStarted ? 'No writes detected yet. Events will appear here as apps write to their schemas.' : 'Starting activity poller…'}</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>When</th><th>App</th><th>Table</th>
                      <th style={{ textAlign: 'right' }}>+ins</th><th style={{ textAlign: 'right' }}>~upd</th><th style={{ textAlign: 'right' }}>−del</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.map((e) => (
                      <tr key={e.id}>
                        <td style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }} title={e.ts}>{timeAgoShort(e.ts)}</td>
                        <td><Link href={`/apps/${e.app_slug}`} style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>{e.app_name}</Link></td>
                        <td><Link href={`/apps/${e.app_slug}/tables/${encodeURIComponent(e.table)}`} className="mono" style={{ color: 'var(--color-text-secondary)', textDecoration: 'none', fontSize: 12 }}>{e.table}</Link></td>
                        <td style={{ textAlign: 'right', color: e.inserts > 0 ? 'var(--color-success)' : 'var(--color-text-tertiary)', fontSize: 12 }}>{e.inserts > 0 ? `+${e.inserts}` : '—'}</td>
                        <td style={{ textAlign: 'right', color: e.updates > 0 ? 'var(--color-warning)' : 'var(--color-text-tertiary)', fontSize: 12 }}>{e.updates > 0 ? e.updates : '—'}</td>
                        <td style={{ textAlign: 'right', color: e.deletes > 0 ? 'var(--color-error)' : 'var(--color-text-tertiary)', fontSize: 12 }}>{e.deletes > 0 ? `-${e.deletes}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Applications table — preserved */}
            <div className="card">
              <div className="card-header">
                <h2>Applications</h2>
                <Link href="/apps/new" className="btn btn-primary" style={{ fontSize: 12 }}>+ Register app</Link>
              </div>
              {loading ? (
                <div className="empty-state">Loading…</div>
              ) : apps.length === 0 ? (
                <div className="empty-state">No applications registered yet.</div>
              ) : (
                <table>
                  <thead><tr><th>Name</th><th>Slug</th><th>Status</th><th>Active keys</th><th>Created</th></tr></thead>
                  <tbody>
                    {apps.map((app) => (
                      <tr key={app.id}>
                        <td>
                          <Link href={`/apps/${app.slug}`} style={{ color: 'var(--color-accent)', textDecoration: 'none', fontWeight: 500 }}>{app.name}</Link>
                          {app.description && <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{app.description}</div>}
                        </td>
                        <td><span className="mono">{app.slug}</span></td>
                        <td><span className={`badge badge-${app.status}`}>{app.status}</span></td>
                        <td>{app.active_keys}</td>
                        <td style={{ color: 'var(--color-text-tertiary)' }}>{new Date(app.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <aside className="rail">
            <div className="card">
              <div className="card-header"><h2>Quick actions</h2></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Link href="/apps/new" className="quick-action">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                  Register application
                </Link>
                <Link href="/apps" className="quick-action">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></svg>
                  Browse applications
                </Link>
                <Link href="/audit" className="quick-action">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" /></svg>
                  View audit trail
                </Link>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h2>Recent alerts</h2>
                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{alerts.length}</span>
              </div>
              <div className="card-body">
                {alerts.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>No alerts — all apps healthy.</div>
                ) : (
                  alerts.slice(0, 8).map((a) => (
                    <div className="alert-row" key={a.id}>
                      <span className={`dot ${a.severity === 'error' ? 'dot-err' : a.severity === 'warning' ? 'dot-warn' : 'dot-idle'}`} style={{ marginTop: 5 }} />
                      <div className="body">
                        <div className="title">{a.app}</div>
                        <div className="meta">{a.message} · {timeAgoShort(a.ts)} ago</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h2>Top apps by size</h2></div>
              <div className="card-body">
                {!overview || overview.data.per_app.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>No snapshots yet.</div>
                ) : (
                  [...overview.data.per_app].sort((a, b) => b.size_bytes - a.size_bytes).slice(0, 6).map((a) => {
                    const max = Math.max(...overview.data.per_app.map((x) => x.size_bytes), 1);
                    return (
                      <div key={a.slug} style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                          <Link href={`/apps/${a.slug}`} style={{ color: 'var(--color-text-secondary)', textDecoration: 'none' }}>{a.name}</Link>
                          <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{fmtBytes(a.size_bytes)}</span>
                        </div>
                        <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(2, (a.size_bytes / max) * 100)}%` }} /></div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
