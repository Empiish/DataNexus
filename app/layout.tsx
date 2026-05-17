import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import SidebarNav from './SidebarNav';
import TopBar from './TopBar';
import FooterBar from './FooterBar';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'DataNexus',
  description: 'Centralized multi-tenant PostgreSQL platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <div className="sidebar-header">
              <div className="sidebar-logo">DN</div>
              <div>
                <span className="sidebar-brand">DataNexus</span>
                <span className="sidebar-sub">System of record · NexusOS</span>
              </div>
            </div>
            <SidebarNav />
          </aside>
          <div className="main-area">
            <TopBar />
            {children}
            <FooterBar />
          </div>
        </div>
      </body>
    </html>
  );
}
