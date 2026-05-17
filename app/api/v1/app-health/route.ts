import { getAppHealth } from '@/lib/app-health';

export const dynamic = 'force-dynamic';

// L-414: complete per-app health rollup. Control-plane read (Tailnet-only per
// L-409 — proxy.ts gates it; not in the public allowlist). Read-only, composes
// existing data; no schema change, no new auth surface.
export async function GET() {
  const apps = await getAppHealth();
  return Response.json({ apps, generated_at: new Date().toISOString() });
}
