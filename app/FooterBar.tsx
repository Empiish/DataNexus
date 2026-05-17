'use client';

import { useEffect, useState } from 'react';

interface Health {
  postgres: boolean;
  version: string;
  uptime_sec: number;
  region: string;
}

function fmtUptime(s: number): string {
  if (!s || s < 0) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// L-408: footer shows only real values from /api/v1/overview (version, process
// uptime, Postgres reachability, deployment region label). No fabricated SLAs.
export default function FooterBar() {
  const [h, setH] = useState<Health | null>(null);

  useEffect(() => {
    const load = () =>
      fetch('/api/v1/overview')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.health) setH(d.health); })
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <footer className="footer-bar">
      <span>DataNexus{h ? ` v${h.version}` : ''}</span>
      <span className="sep">·</span>
      <span>region {h?.region ?? '—'}</span>
      <span className="sep">·</span>
      <span>
        primary{' '}
        <span style={{ color: h ? (h.postgres ? 'var(--color-success)' : 'var(--color-error)') : 'var(--color-text-tertiary)' }}>
          {h ? (h.postgres ? 'online' : 'down') : '—'}
        </span>
      </span>
      <span className="sep">·</span>
      <span>uptime {h ? fmtUptime(h.uptime_sec) : '—'}</span>
      <span style={{ marginLeft: 'auto' }}>© {new Date().getFullYear()} NexusOS</span>
    </footer>
  );
}
