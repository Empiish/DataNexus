import { prisma } from '@/lib/db';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: 'ok', product: 'DataNexus', version: '0.1.0' });
  } catch {
    return Response.json({ status: 'error', product: 'DataNexus' }, { status: 503 });
  }
}
