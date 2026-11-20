This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## API authentication

DataNexus has two API surfaces with different credentials.

**Data plane (public, `dn_` keys).** No admin token needed; these authenticate themselves:

| Route | Auth |
| --- | --- |
| `GET /api/v1/health` | none (liveness only) |
| `POST /api/v1/auth/verify` | `dn_` key in the JSON body (Pandora and sibling apps use this) |
| `POST /api/v1/query` | `Authorization: Bearer dn_...` |

**Control plane (everything else under `/api/`).** Creating, changing, listing or deleting apps; minting, listing or revoking keys; audit log; schema, row previews, activity, connections, sources, overview, pulse, alerts, app-health. Every request needs:

```
Authorization: Bearer <DATANEXUS_ADMIN_TOKEN>
```

- `DATANEXUS_ADMIN_TOKEN` is a server env var: at least 32 random characters
  (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).
- Missing or wrong token: `401`. Server has no token (or one shorter than 32 chars): `503` for the
  whole control plane (fails closed).
- The check lives in `lib/admin-auth.ts`. `proxy.ts` applies it to every non-public `/api/` path
  (deny by default) and each route handler calls `requireAdmin()` again.
- `dn_` keys are never admin credentials.
- The control plane is still Tailnet-only, and requests that came through the public Caddy edge
  (`X-DN-Edge`) still get 404. That network rule is defense in depth, not the authentication.

Example:

```bash
curl -s -H "Authorization: Bearer $DATANEXUS_ADMIN_TOKEN" http://nos-server-01-ts:4000/api/v1/apps
```

**Web UI.** Pages redirect to `/login`, where the operator pastes the admin token once.
`POST /api/v1/session` checks it and sets the `dn_admin_session` cookie: httpOnly,
SameSite=Strict, Secure on https, 12 h expiry, holding an HMAC-signed session derived from the
token (never the token itself). Cookie-authenticated writes must also be same-origin. "Sign out"
in the top bar (`DELETE /api/v1/session`) clears it. Rotating the token signs out every session.

The MCP server in `packages/mcp-server` reads `DATANEXUS_ADMIN_TOKEN` from its own env and sends
it as the Bearer header.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
