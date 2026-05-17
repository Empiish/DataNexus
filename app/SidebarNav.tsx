'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// L-408: sectioned sidebar. Only routes that actually exist are links; every
// aspirational reference item is rendered visibly-disabled ("soon") — never a
// dead link, never faked.

type Item =
  | { label: string; href: string; icon: keyof typeof ICONS }
  | { label: string; soon: true; icon: keyof typeof ICONS };

const ICONS = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  apps: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  plus: 'M12 5v14M5 12h14',
  table: 'M3 3h18v18H3zM3 9h18M9 3v18',
  audit: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8',
  key: 'M21 2l-2 2m-7.6 7.6a5 5 0 1 0-7 7 5 5 0 0 0 7-7zm0 0L19 4',
  ops: 'M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4',
  chart: 'M3 3v18h18M7 14l4-4 4 3 5-6',
  cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L14.5 2h-5l-.3 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.5L3 11a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.3 2.5h5l.3-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .1-1z',
} as const;

const SECTIONS: { title: string; items: Item[] }[] = [
  { title: 'Overview', items: [{ label: 'Dashboard', href: '/', icon: 'grid' }] },
  {
    title: 'Registry',
    items: [
      { label: 'Applications', href: '/apps', icon: 'apps' },
      { label: 'Register App', href: '/apps/new', icon: 'plus' },
    ],
  },
  {
    title: 'Data',
    items: [
      { label: 'Tables', soon: true, icon: 'table' },
      { label: 'Queries', soon: true, icon: 'table' },
      { label: 'Migrations', soon: true, icon: 'table' },
    ],
  },
  {
    title: 'Identity',
    items: [
      { label: 'API Keys', soon: true, icon: 'key' },
      { label: 'Service Accounts', soon: true, icon: 'key' },
      { label: 'Roles & Permissions', soon: true, icon: 'key' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Backups', soon: true, icon: 'ops' },
      { label: 'Webhooks', soon: true, icon: 'ops' },
      { label: 'Integrations', soon: true, icon: 'ops' },
    ],
  },
  {
    title: 'Observability',
    items: [
      { label: 'Audit Trail', href: '/audit', icon: 'audit' },
      { label: 'Metrics', soon: true, icon: 'chart' },
      { label: 'Logs', soon: true, icon: 'chart' },
      { label: 'Alerts', soon: true, icon: 'chart' },
    ],
  },
];

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export default function SidebarNav() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/'));

  return (
    <nav className="sidebar-nav">
      {SECTIONS.map((sec) => (
        <div key={sec.title}>
          <span className="nav-label">{sec.title}</span>
          {sec.items.map((it) =>
            'href' in it ? (
              <Link key={it.label} href={it.href} className={`nav-link${isActive(it.href) ? ' active' : ''}`}>
                <NavIcon d={ICONS[it.icon]} />
                {it.label}
              </Link>
            ) : (
              <span key={it.label} className="nav-link disabled" title="Not implemented yet">
                <NavIcon d={ICONS[it.icon]} />
                {it.label}
                <span className="nav-soon">soon</span>
              </span>
            ),
          )}
        </div>
      ))}
      <div>
        <span className="nav-label">System</span>
        <span className="nav-link disabled" title="Not implemented yet">
          <NavIcon d={ICONS.cog} />
          Settings
          <span className="nav-soon">soon</span>
        </span>
      </div>
    </nav>
  );
}
