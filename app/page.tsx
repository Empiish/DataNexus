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

function timeAgoShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 5_000) return 'now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

export default function Dashboard() {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [pollerStarted, setPollerStarted] = useState(false);

  useEffect(() => {
    fetch('/api/v1/apps')
      .then(r => r.json())
      .then(data => { setApps(data); setLoading(false); });

    const fetchActivity = () => {
      fetch('/api/v1/activity/tail?limit=20')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) { setActivity(d.events ?? []); setPollerStarted(!!d.poller_started); } })
        .catch(() => {});
    };
    fetchActivity();
    const t = setInterval(fetchActivity, 5_000);
    return () => clearInterval(t);
  }, []);

  const active = apps.filter(a => a.status === 'active').length;
  const totalKeys = apps.reduce((sum, a) => sum + a.active_keys, 0);

  return (
    <>
      <header className="main-header">
        <h1>Dashboard</h1>
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
        </div>

        {/* Live activity tail */}
        <div className="card">
          <div className="card-header">
            <h2>Live activity</h2>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              {pollerStarted ? (
                <>
                  <span style={{
                    display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--color-success)', marginRight: 6, verticalAlign: 'middle',
                  }} />
                  polling every 5s
                </>
              ) : 'waking poller…'}
            </span>
          </div>
          {activity.length === 0 ? (
            <div className="empty-state">
              {pollerStarted
                ? 'No writes detected yet. Events will appear here as apps write to their schemas.'
                : 'Starting activity poller…'}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>When</th>
                  <th>App</th>
                  <th>Table</th>
                  <th style={{ textAlign: 'right' }}>+ins</th>
                  <th style={{ textAlign: 'right' }}>~upd</th>
                  <th style={{ textAlign: 'right' }}>−del</th>
                </tr>
              </thead>
              <tbody>
                {activity.map(e => (
                  <tr key={e.id}>
                    <td style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }} title={e.ts}>{timeAgoShort(e.ts)}</td>
                    <td>
                      <Link href={`/apps/${e.app_slug}`} style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>
                        {e.app_name}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/apps/${e.app_slug}/tables/${encodeURIComponent(e.table)}`} className="mono" style={{ color: 'var(--color-text-secondary)', textDecoration: 'none', fontSize: 12 }}>
                        {e.table}
                      </Link>
                    </td>
                    <td style={{ textAlign: 'right', color: e.inserts > 0 ? 'var(--color-success)' : 'var(--color-text-tertiary)', fontSize: 12 }}>
                      {e.inserts > 0 ? `+${e.inserts}` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: e.updates > 0 ? 'var(--color-warning)' : 'var(--color-text-tertiary)', fontSize: 12 }}>
                      {e.updates > 0 ? e.updates : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: e.deletes > 0 ? 'var(--color-error)' : 'var(--color-text-tertiary)', fontSize: 12 }}>
                      {e.deletes > 0 ? `-${e.deletes}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Applications</h2>
            <Link href="/apps/new" className="btn btn-primary" style={{ fontSize: 12 }}>
              + Register app
            </Link>
          </div>
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : apps.length === 0 ? (
            <div className="empty-state">No applications registered yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Status</th>
                  <th>Active keys</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {apps.map(app => (
                  <tr key={app.id} style={{ cursor: 'pointer' }}>
                    <td>
                      <Link href={`/apps/${app.slug}`} style={{ color: 'var(--color-accent)', textDecoration: 'none', fontWeight: 500 }}>
                        {app.name}
                      </Link>
                      {app.description && (
                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{app.description}</div>
                      )}
                    </td>
                    <td><span className="mono">{app.slug}</span></td>
                    <td><span className={`badge badge-${app.status}`}>{app.status}</span></td>
                    <td>{app.active_keys}</td>
                    <td style={{ color: 'var(--color-text-tertiary)' }}>
                      {new Date(app.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </>
  );
}
