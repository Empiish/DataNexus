'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';

interface Key {
  id: string;
  prefix: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface Event {
  id: string;
  event_type: string;
  actor: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface SchemaTable {
  table: string;
  rows: number;
  size_bytes: number;
  last_activity: string | null;
  inserts: number;
  updates: number;
  deletes: number;
}

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log10(n) / 3), units.length - 1);
  const v = n / Math.pow(1000, i);
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

interface AppDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  created_by: string;
  schema_name: string;
  db_user: string;
  created_at: string;
  keys: Key[];
  recent_events: Event[];
}

export default function AppDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [app, setApp] = useState<AppDetail | null>(null);
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKey, setNewKey] = useState<{ api_key: string; prefix: string } | null>(null);
  const [generating, setGenerating] = useState(false);

  const reload = () =>
    fetch(`/api/v1/apps/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { setApp(data); setLoading(false); });

  useEffect(() => {
    reload();
    fetch(`/api/v1/apps/${id}/schema`).then(r => r.json()).then(d => setTables(d.tables ?? []));
  }, [id]);

  const generateKey = async () => {
    if (!newKeyLabel.trim()) return;
    setGenerating(true);
    const res = await fetch(`/api/v1/apps/${id}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newKeyLabel }),
    });
    const data = await res.json();
    setNewKey(data);
    setNewKeyLabel('');
    setGenerating(false);
    reload();
  };

  const revokeKey = async (keyId: string) => {
    if (!confirm('Revoke this key? This cannot be undone.')) return;
    await fetch(`/api/v1/apps/${id}/keys`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key_id: keyId }),
    });
    reload();
  };

  if (loading) return (
    <>
      <header className="main-header"><h1>Loading…</h1></header>
      <main className="main-content"><div className="empty-state">Loading app…</div></main>
    </>
  );

  if (!app) return (
    <>
      <header className="main-header"><h1>Not found</h1></header>
      <main className="main-content"><div className="empty-state">Application not found.</div></main>
    </>
  );

  const activeKeys = app.keys.filter(k => !k.revoked_at);
  const revokedKeys = app.keys.filter(k => k.revoked_at);

  return (
    <>
      <header className="main-header">
        <Link href="/apps" style={{ color: 'var(--color-text-tertiary)', textDecoration: 'none', fontSize: 13 }}>
          ← Apps
        </Link>
        <h1 style={{ marginLeft: 8 }}>{app.name}</h1>
        <span className={`badge badge-${app.status}`} style={{ marginLeft: 8 }}>{app.status}</span>
      </header>
      <main className="main-content animate-in section-gap">

        {/* Meta */}
        <div className="card">
          <div className="card-header"><h2>Details</h2></div>
          <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              ['Slug', app.slug],
              ['Schema', app.schema_name],
              ['DB user', app.db_user],
              ['Created by', app.created_by],
              ['Registered', new Date(app.created_at).toLocaleString()],
              ['Description', app.description ?? '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                <div className="mono" style={{ color: 'var(--color-text-primary)', fontSize: 13 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Data overview — stats summary */}
        {(() => {
          const totalRows = tables.reduce((a, t) => a + t.rows, 0);
          const totalSize = tables.reduce((a, t) => a + t.size_bytes, 0);
          const lastActivity = tables
            .map(t => t.last_activity)
            .filter((x): x is string => !!x)
            .sort()
            .reverse()[0] ?? null;
          const maxSize = Math.max(1, ...tables.map(t => t.size_bytes));
          return (
            <div className="card">
              <div className="card-header"><h2>Data overview</h2></div>
              <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                {[
                  ['Tables', tables.length.toLocaleString()],
                  ['Total rows', totalRows.toLocaleString()],
                  ['Schema size', formatBytes(totalSize)],
                  ['Last activity', timeAgo(lastActivity)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                    <div style={{ color: 'var(--color-text-primary)', fontSize: 20, fontWeight: 600 }}>{value}</div>
                  </div>
                ))}
              </div>

              {tables.length === 0 ? (
                <div className="empty-state">No tables in this schema yet. Your app hasn't created any — run your migrations to populate it.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Table</th>
                      <th style={{ textAlign: 'right' }}>Rows</th>
                      <th>Size</th>
                      <th style={{ textAlign: 'right' }}>Inserts</th>
                      <th style={{ textAlign: 'right' }}>Updates</th>
                      <th style={{ textAlign: 'right' }}>Deletes</th>
                      <th>Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.map(t => {
                      const pct = Math.round((t.size_bytes / maxSize) * 100);
                      return (
                        <tr key={t.table}>
                          <td><span className="mono">{t.table}</span></td>
                          <td style={{ textAlign: 'right' }}>{t.rows.toLocaleString()}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 }}>
                              <div style={{ flex: 1, height: 6, background: 'var(--color-border)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-accent, #4f8ef7)' }} />
                              </div>
                              <span className="mono" style={{ fontSize: 12, color: 'var(--color-text-tertiary)', minWidth: 56, textAlign: 'right' }}>{formatBytes(t.size_bytes)}</span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'right' }}>{t.inserts.toLocaleString()}</td>
                          <td style={{ textAlign: 'right' }}>{t.updates.toLocaleString()}</td>
                          <td style={{ textAlign: 'right' }}>{t.deletes.toLocaleString()}</td>
                          <td style={{ color: 'var(--color-text-tertiary)' }}>{timeAgo(t.last_activity)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })()}

        {/* New key result */}
        {newKey && (
          <div style={{ background: 'var(--color-success-light)', border: '1px solid var(--color-success)', borderRadius: 10, padding: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--color-success)' }}>New API key — copy now, won't be shown again</div>
            <code className="mono" style={{ wordBreak: 'break-all', fontSize: 13 }}>{newKey.api_key}</code>
            <div style={{ marginTop: 8 }}>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setNewKey(null)}>Dismiss</button>
            </div>
          </div>
        )}

        {/* Keys */}
        <div className="card">
          <div className="card-header">
            <h2>API Keys</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={newKeyLabel}
                onChange={e => setNewKeyLabel(e.target.value)}
                placeholder="Key label…"
                onKeyDown={e => e.key === 'Enter' && generateKey()}
                style={{
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text-primary)',
                  borderRadius: 7,
                  padding: '6px 12px',
                  fontSize: 13,
                }}
              />
              <button className="btn btn-primary" onClick={generateKey} disabled={generating || !newKeyLabel.trim()}>
                {generating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
          {activeKeys.length === 0 ? (
            <div className="empty-state">No active keys.</div>
          ) : (
            <table>
              <thead><tr><th>Label</th><th>Prefix</th><th>Created</th><th>Last used</th><th></th></tr></thead>
              <tbody>
                {activeKeys.map(k => (
                  <tr key={k.id}>
                    <td>{k.label}</td>
                    <td><span className="mono">{k.prefix}…</span></td>
                    <td style={{ color: 'var(--color-text-tertiary)' }}>{new Date(k.created_at).toLocaleDateString()}</td>
                    <td style={{ color: 'var(--color-text-tertiary)' }}>{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}</td>
                    <td><button className="btn btn-danger" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => revokeKey(k.id)}>Revoke</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {revokedKeys.length > 0 && (
            <div style={{ padding: '8px 16px', borderTop: '1px solid var(--color-border)' }}>
              <details style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                <summary style={{ cursor: 'pointer' }}>{revokedKeys.length} revoked key{revokedKeys.length > 1 ? 's' : ''}</summary>
                <table style={{ marginTop: 8, opacity: 0.6 }}>
                  <thead><tr><th>Label</th><th>Prefix</th><th>Revoked</th></tr></thead>
                  <tbody>
                    {revokedKeys.map(k => (
                      <tr key={k.id}>
                        <td style={{ textDecoration: 'line-through' }}>{k.label}</td>
                        <td><span className="mono">{k.prefix}…</span></td>
                        <td>{k.revoked_at ? new Date(k.revoked_at).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          )}
        </div>

        {/* Audit */}
        <div className="card">
          <div className="card-header">
            <h2>Recent events</h2>
            <Link href={`/audit?app_id=${app.id}`} className="btn btn-ghost" style={{ fontSize: 12 }}>View all</Link>
          </div>
          {app.recent_events.length === 0 ? (
            <div className="empty-state">No events yet.</div>
          ) : (
            <table>
              <thead><tr><th>Event</th><th>Actor</th><th>When</th></tr></thead>
              <tbody>
                {app.recent_events.map(e => (
                  <tr key={e.id}>
                    <td><span className="mono">{e.event_type}</span></td>
                    <td style={{ color: 'var(--color-text-tertiary)' }}>{e.actor}</td>
                    <td style={{ color: 'var(--color-text-tertiary)' }}>{new Date(e.created_at).toLocaleString()}</td>
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
