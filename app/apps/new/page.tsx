'use client';

import { useState } from 'react';
import Link from 'next/link';

interface RegisterResult {
  id: string;
  name: string;
  slug: string;
  schema_name: string;
  api_key: string;
  api_key_prefix: string;
  connection_string: string;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="btn btn-ghost"
      style={{ fontSize: 11, padding: '3px 10px', flexShrink: 0 }}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function CodeBlock({ value }: { value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', borderRadius: 7, padding: '8px 10px' }}>
      <code className="mono" style={{ fontSize: 12, wordBreak: 'break-all', flex: 1, color: 'var(--color-text-primary)' }}>{value}</code>
      <CopyButton value={value} />
    </div>
  );
}

function TabBar({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 16 }}>
      {tabs.map(t => (
        <button
          key={t}
          onClick={() => onChange(t)}
          style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 500, border: 'none', background: 'none', cursor: 'pointer',
            color: active === t ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            borderBottom: active === t ? '2px solid var(--color-accent)' : '2px solid transparent',
            marginBottom: -1,
          }}
        >{t}</button>
      ))}
    </div>
  );
}

function SuccessView({ result }: { result: RegisterResult }) {
  const [tab, setTab] = useState('Manual');

  const envBlock = `# Add to your app's .env or .env.local
DATABASE_URL="${result.connection_string}"
DATANEXUS_API_KEY="${result.api_key}"
DATANEXUS_SCHEMA="${result.schema_name}"`;

  const prismaBlock = `// schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}`;

  const curlBlock = `curl -X POST https://datanexus.78.46.200.161.sslip.io/api/v1/apps \\
  -H "Content-Type: application/json" \\
  -d '{"name": "${result.name}", "created_by": "agent"}'`;

  const regBlock = `/reg datanexus "${result.name}"`;

  return (
    <>
      <header className="main-header">
        <Link href="/apps" style={{ color: 'var(--color-text-tertiary)', textDecoration: 'none', fontSize: 13 }}>← Apps</Link>
        <h1 style={{ marginLeft: 8 }}>{result.name} registered</h1>
        <span className="badge badge-active" style={{ marginLeft: 8 }}>active</span>
      </header>
      <main className="main-content animate-in section-gap" style={{ maxWidth: 680 }}>

        {/* Credentials — shown once */}
        <div style={{ background: 'var(--color-success-light)', border: '1px solid var(--color-success)', borderRadius: 10, padding: 20 }}>
          <div style={{ fontWeight: 600, color: 'var(--color-success)', marginBottom: 16 }}>
            Store these now — they won't be shown again
          </div>
          {([
            ['API key', result.api_key],
            ['Connection string', result.connection_string],
            ['Schema', result.schema_name],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-success)', marginBottom: 6 }}>{label}</div>
              <CodeBlock value={value} />
            </div>
          ))}
        </div>

        {/* Integration guide */}
        <div className="card">
          <div className="card-header"><h2>How to integrate</h2></div>
          <div className="card-body">
            <TabBar tabs={['Manual', 'API', 'Agent (/reg)']} active={tab} onChange={setTab} />

            {tab === 'Manual' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>1. Add credentials to your app</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
                    Paste the block below into your app's <code className="mono">.env</code> or <code className="mono">.env.local</code> file.
                    Make sure it's in your <code className="mono">.gitignore</code>.
                  </div>
                  <CodeBlock value={envBlock} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>2. Point Prisma at it</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
                    In your app's <code className="mono">prisma/schema.prisma</code>, use the env var:
                  </div>
                  <CodeBlock value={prismaBlock} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>3. Push your schema</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
                    Run this in your app's directory. Your tables will be created in the isolated <code className="mono">{result.schema_name}</code> schema.
                  </div>
                  <CodeBlock value="npx prisma db push" />
                </div>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>4. Done</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                    Your app is now connected to DataNexus. Every app gets its own isolated schema — no tables clash with other apps.
                  </div>
                </div>
              </div>
            )}

            {tab === 'API' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  Use the REST API to register apps programmatically — from CI pipelines, scripts, or other services.
                </div>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Register an app</div>
                  <CodeBlock value={curlBlock} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Other endpoints</div>
                  <table style={{ fontSize: 12 }}>
                    <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
                    <tbody>
                      {([
                        ['POST', '/api/v1/apps', 'Register new app, get connection string + API key'],
                        ['GET',  '/api/v1/apps', 'List all apps'],
                        ['GET',  '/api/v1/apps/:id', 'App detail, keys, audit log'],
                        ['POST', '/api/v1/apps/:id/keys', 'Generate a new API key'],
                        ['DELETE', '/api/v1/apps/:id/keys', 'Revoke a key'],
                        ['GET',  '/api/v1/apps/:id/schema', 'Introspect tables + row counts'],
                        ['DELETE', '/api/v1/apps/:id', 'Disconnect app (optionally drop schema)'],
                        ['GET',  '/api/v1/audit', 'Global audit log'],
                      ] as [string, string, string][]).map(([method, path, desc]) => (
                        <tr key={path + method}>
                          <td><span className="mono" style={{ color: method === 'GET' ? 'var(--color-accent)' : method === 'POST' ? 'var(--color-success)' : 'var(--color-error)' }}>{method}</span></td>
                          <td><span className="mono">{path}</span></td>
                          <td style={{ color: 'var(--color-text-tertiary)' }}>{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'Agent (/reg)' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  The <code className="mono">/reg</code> Claude Code skill lets any agent register an app and wire up credentials automatically — no browser needed.
                </div>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Usage (in any Claude Code session)</div>
                  <CodeBlock value={regBlock} />
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
                    The agent will find DataNexus, register the app, and save the connection string + API key directly into the project's <code className="mono">.env</code> file.
                  </div>
                </div>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>What it does automatically</div>
                  <ol style={{ fontSize: 12, color: 'var(--color-text-secondary)', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <li>Checks if the app is already registered (prevents duplicates)</li>
                    <li>Calls <code className="mono">POST /api/v1/apps</code> with the project name</li>
                    <li>Writes <code className="mono">DATABASE_URL</code>, <code className="mono">DATANEXUS_API_KEY</code>, <code className="mono">DATANEXUS_SCHEMA</code> to <code className="mono">.env.local</code></li>
                    <li>Warns if the env file isn't gitignored</li>
                  </ol>
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <Link href={`/apps/${result.slug}`} className="btn btn-primary">View app dashboard →</Link>
        </div>
      </main>
    </>
  );
}

export default function NewAppPage() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createdBy, setCreatedBy] = useState('operator');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [error, setError] = useState('');

  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

  const submit = async () => {
    setError('');
    setLoading(true);
    const res = await fetch('/api/v1/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, created_by: createdBy }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error ?? 'Registration failed'); return; }
    setResult(data);
  };

  if (result) return <SuccessView result={result} />;

  return (
    <>
      <header className="main-header">
        <Link href="/apps" style={{ color: 'var(--color-text-tertiary)', textDecoration: 'none', fontSize: 13 }}>← Apps</Link>
        <h1 style={{ marginLeft: 8 }}>Register app</h1>
      </header>
      <main className="main-content animate-in">
        <div style={{ maxWidth: 480 }} className="card">
          <div className="card-header"><h2>New application</h2></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && (
              <div style={{ background: 'var(--color-error-light)', color: 'var(--color-error)', padding: '10px 14px', borderRadius: 7, fontSize: 13 }}>{error}</div>
            )}
            {([
              { label: 'App name', value: name, setter: setName, placeholder: 'My App', required: true },
              { label: 'Description', value: description, setter: setDescription, placeholder: 'Optional' },
              { label: 'Created by', value: createdBy, setter: setCreatedBy, placeholder: 'operator' },
            ] as { label: string; value: string; setter: (v: string) => void; placeholder: string; required?: boolean }[]).map(({ label, value, setter, placeholder, required }) => (
              <div key={label}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
                  {label}{required && ' *'}
                </label>
                <input
                  value={value}
                  onChange={e => setter(e.target.value)}
                  placeholder={placeholder}
                  onKeyDown={e => e.key === 'Enter' && !loading && name.trim() && submit()}
                  style={{
                    width: '100%', border: '1px solid var(--color-border)', background: 'var(--color-bg)',
                    color: 'var(--color-text-primary)', borderRadius: 7, padding: '8px 12px', fontSize: 13,
                  }}
                />
              </div>
            ))}
            {slug && (
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                Slug: <span className="mono">{slug}</span>
              </div>
            )}
            <button className="btn btn-primary" onClick={submit} disabled={loading || !name.trim()} style={{ alignSelf: 'flex-start' }}>
              {loading ? 'Registering…' : 'Register app'}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
