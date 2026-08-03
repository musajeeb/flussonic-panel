import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.join(ROOT, '.env') });

function bool(v, fallback = false) {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function int(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: int(process.env.PORT, 5000),
  HOST: process.env.HOST || '0.0.0.0',

  // 'mongo' (default, production) or 'memory' (no database needed, data lost on restart)
  DB_DRIVER: (process.env.DB_DRIVER || 'mongo').toLowerCase(),
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/flussonic-crm',

  JWT_SECRET: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  JWT_EXPIRE: process.env.JWT_EXPIRE || '7d',

  // Used to encrypt the Flussonic admin passwords we store.
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'dev-only-insecure-encryption-key',

  ADMIN_EMAIL: (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase(),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'changeme',

  CORS_ORIGIN: process.env.CORS_ORIGIN || '',

  // Public base URL of THIS panel. Flussonic servers and customers must be able to
  // reach it, so in production set it to your real domain.
  PUBLIC_URL: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),

  // Shared secret Flussonic must present when calling our authorization backend.
  AUTH_BACKEND_KEY: process.env.AUTH_BACKEND_KEY || 'change-this-auth-backend-key',

  MONITOR_ENABLED: bool(process.env.MONITOR_ENABLED, true),
  // Heavy cycle: full stream list + sessions.
  MONITOR_INTERVAL_SEC: int(process.env.MONITOR_INTERVAL_SEC, 30),
  // Light cycle: one small status request per server. Safe to run every second.
  MONITOR_FAST_SEC: int(process.env.MONITOR_FAST_SEC, 2),
  FLUSSONIC_TIMEOUT_MS: int(process.env.FLUSSONIC_TIMEOUT_MS, 25000),

  LOG_REQUESTS: bool(process.env.LOG_REQUESTS, true),
};

export function warnInsecureDefaults(log = console.warn) {
  if (env.NODE_ENV !== 'production') return [];
  const problems = [];
  if (env.JWT_SECRET.startsWith('dev-only')) problems.push('JWT_SECRET is still the default value');
  if (env.ENCRYPTION_KEY.startsWith('dev-only')) problems.push('ENCRYPTION_KEY is still the default value');
  if (env.ADMIN_PASSWORD === 'changeme') problems.push('ADMIN_PASSWORD is still the default value');
  if (env.AUTH_BACKEND_KEY === 'change-this-auth-backend-key') problems.push('AUTH_BACKEND_KEY is still the default value');
  for (const p of problems) log(`[security] ${p}`);
  return problems;
}
