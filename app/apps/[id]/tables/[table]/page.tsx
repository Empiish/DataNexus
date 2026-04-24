'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';

interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  default: string | null;
  is_primary_key: boolean;
  foreign_reference: string | null;
  is_indexed: boolean;
  ordinal: number;
}

interface TablePayload {
  schema_name: string;
  table: string;
  columns: ColumnInfo[];
  error?: string;
}

function Tag({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      background: color,
      color: '#fff',
      marginRight: 4,
    }}>{children}</span>
  );
}

export default function TableDrillDownPage({ params }: { params: Promise<{ id: string; table: string }> }) {
  const { id, table } = use(params);
  const [data, setData] = useState<TablePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/apps/${id}/schema/${encodeURIComponent(table)}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); setLoading(false); return null; }
        return r.json();
      })
      .then(d => { if (d) setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id, table]);

  if (loading) return (
    <>
      <header className="main-header"><h1>Loading…</h1></header>
      <main className="main-content"><div className="empty-state">Loading table…</div></main>
    </>
  );

  if (notFound || !data) return (
    <>
      <header className="main-header">
        <Link href={`/apps/${id}`} style={{ color: 'var(--color-text-tertiary)', textDecoration: 'none', fontSize: 13 }}>← App</Link>
        <h1 style={{ marginLeft: 8 }}>Table not found</h1>
      </header>
      <main className="main-content"><div className="empty-state">This table does not exist in the schema.</div></main>
    </>
  );

  return (
    <>
      <header className="main-header">
        <Link href={`/apps/${id}`} style={{ color: 'var(--color-text-tertiary)', textDecoration: 'none', fontSize: 13 }}>← App</Link>
        <h1 style={{ marginLeft: 8 }}><span className="mono">{data.table}</span></h1>
        <span className="mono" style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-tertiary)' }}>{data.schema_name}.{data.table}</span>
      </header>
      <main className="main-content animate-in section-gap">

        {/* Schema strip */}
        <div className="card">
          <div className="card-header">
            <h2>Schema</h2>
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {data.columns.length} column{data.columns.length === 1 ? '' : 's'}
            </span>
          </div>
          {data.columns.length === 0 ? (
            <div className="empty-state">No columns.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th>Column</th>
                  <th>Type</th>
                  <th>Nullable</th>
                  <th>Default</th>
                  <th>Keys &amp; indexes</th>
                </tr>
              </thead>
              <tbody>
                {data.columns.map(c => (
                  <tr key={c.name}>
                    <td style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>{c.ordinal}</td>
                    <td>
                      <span className="mono" style={{ fontWeight: c.is_primary_key ? 600 : 400 }}>{c.name}</span>
                    </td>
                    <td><span className="mono" style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{c.data_type}</span></td>
                    <td style={{ color: c.is_nullable ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)' }}>
                      {c.is_nullable ? 'nullable' : 'NOT NULL'}
                    </td>
                    <td style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>
                      {c.default ? <span className="mono">{c.default}</span> : '—'}
                    </td>
                    <td>
                      {c.is_primary_key && <Tag color="#7c3aed">PK</Tag>}
                      {c.foreign_reference && (
                        <span title={`references ${c.foreign_reference}`}>
                          <Tag color="#0891b2">FK</Tag>
                        </span>
                      )}
                      {c.is_indexed && !c.is_primary_key && <Tag color="#64748b">IDX</Tag>}
                      {c.foreign_reference && (
                        <span className="mono" style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 4 }}>
                          → {c.foreign_reference}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Placeholders for upcoming layers */}
        <div className="card">
          <div className="card-header"><h2>Rows preview</h2><span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>coming soon</span></div>
          <div className="empty-state">Last 100 rows will appear here (L-088).</div>
        </div>
        <div className="card">
          <div className="card-header"><h2>Activity</h2><span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>coming soon</span></div>
          <div className="empty-state">Write activity sparkline (L-089) and size/growth deltas (L-090).</div>
        </div>

      </main>
    </>
  );
}
