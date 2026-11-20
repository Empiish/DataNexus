# DataNexus MCP server

Stdio MCP that **mediates every DataNexus write** with a mandatory `reason` string. Reads need no reason. Mutations auto-execute (no interactive approval prompt — whoever holds the admin token is the trusted operator) but **land on `/audit` with the reason attached**. The trail is the accountability.

## Install

```bash
cd packages/mcp-server
npm install
```

## Register (once, per operator laptop)

Add to `~/.claude.json` under `mcpServers`, then restart Claude Code:

```jsonc
{
  "mcpServers": {
    "datanexus": {
      "command": "node",
      "args": ["<absolute path>/datanexus/packages/mcp-server/index.mjs"],
      "env": {
        "DATANEXUS_URL": "http://nos-server-01-ts:4000",
        "DATANEXUS_ADMIN_TOKEN": "<same value as the server's DATANEXUS_ADMIN_TOKEN>"
      }
    }
  }
}
```

`DATANEXUS_ADMIN_TOKEN` is **required**. Every call sends it as `Authorization: Bearer <token>`; the server answers 401 without it (and 503 if the server itself has no token configured). The control plane is also Tailnet-only (see L-409), but network position is no longer treated as authentication. Keep the token out of git; `dn_` keys are NOT accepted as admin credentials.

## Tools

### Reads (no reason)

| Tool | What |
| --- | --- |
| `datanexus_list_apps` | Registry summary |
| `datanexus_get_app { id_or_slug }` | Full detail incl. keys and recent audit events |
| `datanexus_app_health` | Every app, fused (status/size/conns/last-seen/idle) |
| `datanexus_audit { limit?, app_id?, event_type? }` | Query the audit log |
| `datanexus_pulse` | Registry counts + activity sparkline |
| `datanexus_overview` | Stat cards + 24h write-throughput series + composite health |
| `datanexus_sources` | Federated PG schemas + Pandora vault metadata |
| `datanexus_connections` | Live `pg_stat_activity` per app |

### Mutations — **`reason` REQUIRED**

| Tool | What | Notes |
| --- | --- | --- |
| `datanexus_register_app` | Create a new app (schema + per-app role + first `dn_` key) | Returns `connection_string` + `api_key` ONCE |
| `datanexus_update_app` | PATCH description/status | Writes an `updated` audit event |
| `datanexus_disconnect_app` | Soft-disconnect; `drop_schema=true` is destructive | Revokes all keys |
| `datanexus_generate_key` | Mint a new `dn_` API key | Value returned ONCE |
| `datanexus_revoke_key` | Soft-revoke a key | Stops working within 60s |

`actor` defaults to `"claude"` (override to attribute a mutation to a specific agent).

A missing `reason` triggers a tool-schema validation error at the SDK boundary — the tool never runs, so nothing to revert.

## Trail

Every mutation writes an `AuditEvent` with `event_type`, `actor`, and `metadata.reason` (the reason text from the tool call). Visible on `/audit`; filter by `app_id` / `event_type`. The dashboard also shows the last 20 mutations in real time via `/api/v1/activity/tail` and `/api/v1/audit`.
