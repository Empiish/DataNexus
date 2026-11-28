'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

interface AuditEvent {
  id: string;
  app_id: string;
  app_name: string;
  app_slug: string;
  event_type: string;
  actor: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function AuditContent() {
  const searchParams = useSearchParams();
  const appId = searchParams.get('app_id');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = appId ? `/api/v1/audit?app_id=${appId}&limit=100` : '/api/v1/audit?limit=100';
    fetch(url).then(r => r.json()).then(data => { setEvents(data); setLoading(false); });
  }, [appId]);

  return (
    <div className="card animate-in">
      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : events.length === 0 ? (
        <div className="empty-state">No audit events.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>App</th>
              <th>Actor</th>
              <th>Reason</th>
              <th>Details</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {events.map(e => {
              const reason = e.metadata && typeof e.metadata.reason === 'string' ? e.metadata.reason : null;
              const rest = e.metadata ? Object.fromEntries(Object.entries(e.metadata).filter(([k]) => k !== 'reason')) : null;
              const hasRest = rest && Object.keys(rest).length > 0;
              const isAgent = e.actor && e.actor !== 'operator';
              return (
                <tr key={e.id}>
                  <td><span className="mono">{e.event_type}</span></td>
                  <td style={{ color: 'var(--color-accent)' }}>{e.app_name}</td>
                  <td>
                    <span
                      className={isAgent ? 'badge' : undefined}
                      style={isAgent
                        ? { background: 'var(--color-accent-light)', color: 'var(--color-accent)' }
                        : { color: 'var(--color-text-tertiary)' }}
                    >
                      {e.actor}
                    </span>
                  </td>
                  <td style={{ maxWidth: 360 }}>
                    {reason ? (
                      <span style={{ color: 'var(--color-text-primary)', whiteSpace: 'normal' }}>{reason}</span>
                    ) : (
                      <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
                    )}
                  </td>
                  <td>
                    {hasRest && (
                      <span className="mono" style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                        {JSON.stringify(rest)}
                      </span>
                    )}
                  </td>
                  <td style={{ color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function AuditPage() {
  return (
    <>
      <header className="main-header">
        <h1>Audit Log</h1>
      </header>
      <main className="main-content">
        <Suspense fallback={<div className="empty-state">Loading…</div>}>
          <AuditContent />
        </Suspense>
      </main>
    </>
  );
}
