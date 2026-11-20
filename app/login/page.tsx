'use client';

import { useState } from 'react';

// Owner login: paste DATANEXUS_ADMIN_TOKEN once. POST /api/v1/session checks it
// and sets an httpOnly signed-session cookie; the token is not stored anywhere
// in the browser.

function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get('next');
  // Only same-site absolute paths (no "//host" or "/\host" open redirects).
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

export default function LoginPage() {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/v1/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Sign-in failed (${res.status})`);
        return;
      }
      setToken('');
      window.location.assign(safeNext());
    } catch {
      setError('Sign-in failed: network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <header className="main-header">
        <h1>Sign in</h1>
      </header>
      <main className="main-content animate-in">
        <div style={{ maxWidth: 480 }} className="card">
          <div className="card-header"><h2>Operator access</h2></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && (
              <div style={{ background: 'var(--color-error-light)', color: 'var(--color-error)', padding: '10px 14px', borderRadius: 7, fontSize: 13 }}>{error}</div>
            )}
            <div>
              <label htmlFor="dn-admin-token" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
                Admin token (DATANEXUS_ADMIN_TOKEN)
              </label>
              <input
                id="dn-admin-token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={e => setToken(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !loading && token.trim() && submit()}
                style={{
                  width: '100%', border: '1px solid var(--color-border)', background: 'var(--color-bg)',
                  color: 'var(--color-text-primary)', borderRadius: 7, padding: '8px 12px', fontSize: 13,
                }}
              />
            </div>
            <button className="btn btn-primary" onClick={submit} disabled={loading || !token.trim()} style={{ alignSelf: 'flex-start' }}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
