import { getAllSources } from '@/lib/sources';

export const dynamic = 'force-dynamic';

// L-411: federated read-only "data sources" aggregate. Control-plane route
// (Tailnet-only per L-409 — proxy.ts gates it; not in the public allowlist).
// No new auth surface; the Pandora call is localhost server-to-server,
// metadata only, and degrades gracefully.
export async function GET() {
  const sources = await getAllSources();
  return Response.json({ sources, generated_at: new Date().toISOString() });
}
