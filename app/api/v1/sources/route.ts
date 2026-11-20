import { getAllSources } from '@/lib/sources';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

// L-411: federated read-only "data sources" aggregate. Control-plane route
// (Tailnet-only per L-409 — proxy.ts gates it; not in the public allowlist).
// No new auth surface; the Pandora call is localhost server-to-server,
// metadata only, and degrades gracefully.
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const sources = await getAllSources();
  return Response.json({ sources, generated_at: new Date().toISOString() });
}
