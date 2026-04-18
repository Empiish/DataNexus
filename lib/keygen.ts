import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = `dn_${crypto.randomBytes(24).toString('base64url')}`;
  const prefix = raw.slice(0, 12);
  const hash = bcrypt.hashSync(raw, 10);
  return { key: raw, prefix, hash };
}

export function generateDbPassword(): string {
  return crypto.randomBytes(20).toString('base64url');
}

export function buildConnectionString(slug: string, password: string): string {
  const host = process.env.PG_HOST ?? 'localhost';
  const port = process.env.PG_PORT ?? '5432';
  const db = process.env.PG_DATABASE ?? 'datanexus';
  const user = `app_${slug}`;
  const schema = `app_${slug}`;
  return `postgresql://${user}:${password}@${host}:${port}/${db}?schema=${schema}`;
}
