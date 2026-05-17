'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface AppRow { slug: string; name: string }
interface Health { postgres: boolean; snapshotter: boolean; poller: boolean; ok: boolean }

// L-408: top bar. Search is a REAL app quick-jump (datalist of registered apps
// → navigates to that app). Status is the REAL composite health from
// /api/v1/overview rendered as discrete component dots — not a single
// decorative "online" blob.
export default function TopBar() {
  const router = useRouter();
  const [apps, setApps] = useState<AppRow[]>([]);
  const [q, setQ] = useState('');
  const [health, setHealth] = useState<Health | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/v1/apps')
      .then((r) => (r.ok ? r.json() : []))
      .then((d: AppRow[]) => setApps(Array.isArray(d) ? d : []))
      .catch(() => {});

    const load = () =>
      fetch('/api/v1/overview')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.health) setHealth(d.health); })
        .catch(() => {});
    load();
    const t = setInterval(load, 15_000);

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { clearInterval(t); window.removeEventListener('keydown', onKey); };
  }, []);

  const jump = () => {
    const v = q.trim().toLowerCase();
    if (!v) return;
    const hit = apps.find((a) => a.slug === v || a.name.toLowerCase() === v) ?? apps.find((a) => a.name.toLowerCase().includes(v) || a.slug.includes(v));
    router.push(hit ? `/apps/${hit.slug}` : '/apps');
    setQ('');
  };

  const dotClass = (ok: boolean | undefined) => (ok === undefined ? 'dot-idle' : ok ? 'dot-ok' : 'dot-err');

  return (
    <div className="topbar">
      <div className="topbar-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
        </svg>
        <input
          ref={inputRef}
          list="dn-app-list"
          placeholder="Jump to an application…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') jump(); }}
        />
        <datalist id="dn-app-list">
          {apps.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
        </datalist>
        <kbd>⌘K</kbd>
      </div>
      <div className="topbar-spacer" />
      <div className="status-pill" title="Live composite health (/api/v1/overview)">
        <span className="seg"><span className={`dot ${dotClass(health?.postgres)}`} />DB</span>
        <span className="seg"><span className={`dot ${dotClass(health?.snapshotter)}`} />Snapshotter</span>
        <span className="seg"><span className={`dot ${dotClass(health?.poller)}`} />Poller</span>
      </div>
      <div className="avatar">DN</div>
    </div>
  );
}
