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

export default function Dashboard() {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/apps')
      .then(r => r.json())
      .then(data => { setApps(data); setLoading(false); });
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
