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

export default function AppsPage() {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/apps').then(r => r.json()).then(data => { setApps(data); setLoading(false); });
  }, []);

  return (
    <>
      <header className="main-header">
        <h1>Applications</h1>
        <div style={{ marginLeft: 'auto' }}>
          <Link href="/apps/new" className="btn btn-primary">+ Register app</Link>
        </div>
      </header>
      <main className="main-content animate-in">
        <div className="card">
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : apps.length === 0 ? (
            <div className="empty-state">No applications yet. Register your first app above.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Schema</th>
                  <th>Status</th>
                  <th>Keys</th>
                  <th>Created by</th>
                  <th>Registered</th>
                </tr>
              </thead>
              <tbody>
                {apps.map(app => (
                  <tr key={app.id}>
                    <td>
                      <Link href={`/apps/${app.slug}`} style={{ color: 'var(--color-accent)', textDecoration: 'none', fontWeight: 500 }}>
                        {app.name}
                      </Link>
                      {app.description && (
                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{app.description}</div>
                      )}
                    </td>
                    <td><span className="mono">{app.schema_name}</span></td>
                    <td><span className={`badge badge-${app.status}`}>{app.status}</span></td>
                    <td>{app.active_keys}</td>
                    <td style={{ color: 'var(--color-text-tertiary)' }}>{app.created_by}</td>
                    <td style={{ color: 'var(--color-text-tertiary)' }}>{new Date(app.created_at).toLocaleDateString()}</td>
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
