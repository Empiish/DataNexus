#!/usr/bin/env node
// DataNexus MCP server (L-438).
//
// Mediates DataNexus writes. Reads are free; every mutating tool requires a
// `reason` string enforced at the tool schema (Zod .min(1)). Auto-executes on
// Claude — no interactive approval — the audit trail IS the accountability.
// Every mutation lands on /audit with actor + reason attached (server writes
// them into AuditEvent.metadata).
//
// Config (env):
//   DATANEXUS_URL       — default http://nos-server-01-ts:4000 (Tailnet)
//   DATANEXUS_ADMIN_KEY — optional Bearer; only needed off-Tailnet
//                         (control-plane is Tailnet-trusted; see L-409)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const DN_URL = (process.env.DATANEXUS_URL || 'http://nos-server-01-ts:4000').replace(/\/+$/, '');
const DN_KEY = process.env.DATANEXUS_ADMIN_KEY || '';

async function dn(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (DN_KEY) headers.authorization = `Bearer ${DN_KEY}`;
  const res = await fetch(`${DN_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`DataNexus ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return json;
}

const ok = (v) => ({
  content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
});

const server = new McpServer({ name: 'datanexus-mcp', version: '0.1.0' });

// ────────────────────────────── Reads ──────────────────────────────

server.registerTool('datanexus_list_apps', {
  title: 'List DataNexus applications',
  description: 'Registry of every registered app (id, slug, status, key count, timestamps).',
  inputSchema: {},
}, async () => ok(await dn('GET', '/api/v1/apps')));

server.registerTool('datanexus_get_app', {
  title: 'Get one DataNexus application (by id or slug)',
  description: 'Full detail: connection keys, recent audit events, schema/db-user.',
  inputSchema: { id_or_slug: z.string().min(1) },
}, async ({ id_or_slug }) =>
  ok(await dn('GET', `/api/v1/apps/${encodeURIComponent(id_or_slug)}`)));

server.registerTool('datanexus_app_health', {
  title: 'Complete per-app health rollup',
  description: 'One row per app: status, size (tables/rows), live conns, last-seen, activity/idle.',
  inputSchema: {},
}, async () => ok(await dn('GET', '/api/v1/app-health')));

server.registerTool('datanexus_audit', {
  title: 'Query the audit log',
  description: 'Recent audit events; optionally filter by app or event_type. Reason (if any) is inside metadata.',
  inputSchema: {
    limit: z.number().int().min(1).max(200).default(50),
    app_id: z.string().optional(),
    event_type: z.string().optional(),
  },
}, async ({ limit, app_id, event_type }) => {
  const q = new URLSearchParams({ limit: String(limit ?? 50) });
  if (app_id) q.set('app_id', app_id);
  if (event_type) q.set('event_type', event_type);
  return ok(await dn('GET', `/api/v1/audit?${q.toString()}`));
});

server.registerTool('datanexus_pulse', {
  title: 'Federated pulse (registry counts + activity sparkline)',
  description: 'Small posture used by The Nexus SYSTEMS tile.',
  inputSchema: {},
}, async () => ok(await dn('GET', '/api/v1/pulse')));

server.registerTool('datanexus_overview', {
  title: 'Aggregate dashboard overview',
  description: 'App counts, per-app sizes, 24h write-throughput series, composite health.',
  inputSchema: {},
}, async () => ok(await dn('GET', '/api/v1/overview')));

server.registerTool('datanexus_sources', {
  title: 'Federated data sources (PG schemas + Pandora vault metadata)',
  description: 'Metadata only — never secret values.',
  inputSchema: {},
}, async () => ok(await dn('GET', '/api/v1/sources')));

server.registerTool('datanexus_connections', {
  title: 'Live Postgres connections per app (pg_stat_activity)',
  description: 'Only apps with an open DB socket appear (persistent pools).',
  inputSchema: {},
}, async () => ok(await dn('GET', '/api/v1/connections')));

// ─────────────────── Mutating tools — reason REQUIRED ───────────────────
// Every write goes to /audit with actor + reason. Auto-executes on Claude —
// no interactive gate. Missing reason = SDK-level validation error.

const REASON = z.string().min(1,
  'reason is required — briefly describe WHY this change is happening; it is written to the audit trail');
const ACTOR = z.string().default('claude');

server.registerTool('datanexus_register_app', {
  title: 'Register a new application (creates schema + per-app role + initial dn_ key)',
  description: 'MUTATION — requires reason. Returns connection_string + api_key ONCE (store securely).',
  inputSchema: {
    name: z.string().min(1),
    description: z.string().optional(),
    reason: REASON,
    actor: ACTOR,
  },
}, async ({ name, description, reason, actor }) => ok(
  await dn('POST', '/api/v1/apps', { name, description, created_by: actor, reason }),
));

server.registerTool('datanexus_update_app', {
  title: 'Update an application (description and/or status)',
  description: 'MUTATION — requires reason. Writes an "updated" audit event with the diff + reason.',
  inputSchema: {
    id_or_slug: z.string().min(1),
    description: z.string().optional(),
    status: z.enum(['active', 'disconnected', 'suspended']).optional(),
    reason: REASON,
    actor: ACTOR,
  },
}, async ({ id_or_slug, description, status, reason, actor }) => ok(
  await dn('PATCH', `/api/v1/apps/${encodeURIComponent(id_or_slug)}`, {
    description, status, reason, actor,
  }),
));

server.registerTool('datanexus_disconnect_app', {
  title: 'Disconnect an application (revokes all keys; optionally DROP SCHEMA)',
  description: 'MUTATION — requires reason. drop_schema=true is destructive (DROP SCHEMA CASCADE + DROP USER).',
  inputSchema: {
    id_or_slug: z.string().min(1),
    drop_schema: z.boolean().default(false),
    reason: REASON,
    actor: ACTOR,
  },
}, async ({ id_or_slug, drop_schema, reason, actor }) => ok(
  await dn('DELETE', `/api/v1/apps/${encodeURIComponent(id_or_slug)}`, {
    drop_schema, reason, actor,
  }),
));

server.registerTool('datanexus_generate_key', {
  title: 'Mint a new dn_ API key for an app',
  description: 'MUTATION — requires reason. The dn_ key value is returned ONCE.',
  inputSchema: {
    id_or_slug: z.string().min(1),
    label: z.string().default('API key'),
    reason: REASON,
    actor: ACTOR,
  },
}, async ({ id_or_slug, label, reason, actor }) => ok(
  await dn('POST', `/api/v1/apps/${encodeURIComponent(id_or_slug)}/keys`, {
    label, reason, actor,
  }),
));

server.registerTool('datanexus_revoke_key', {
  title: 'Revoke a dn_ API key (soft-delete; revokedAt set)',
  description: 'MUTATION — requires reason. Revoked keys stop working within 60s (verifyKey TTL).',
  inputSchema: {
    id_or_slug: z.string().min(1),
    key_id: z.string().min(1),
    reason: REASON,
    actor: ACTOR,
  },
}, async ({ id_or_slug, key_id, reason, actor }) => ok(
  await dn('DELETE', `/api/v1/apps/${encodeURIComponent(id_or_slug)}/keys`, {
    key_id, reason, actor,
  }),
));

const transport = new StdioServerTransport();
await server.connect(transport);
