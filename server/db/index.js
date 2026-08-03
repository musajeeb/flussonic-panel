import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { createMemoryDb } from './memory.js';

let db = null;

export async function initDb({ driver = env.DB_DRIVER } = {}) {
  if (driver === 'memory') {
    db = createMemoryDb();
  } else {
    const { createMongoDb } = await import('./mongo.js');
    db = createMongoDb();
  }
  await db.connect();
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialised — call initDb() first');
  return db;
}

/** Creates the panel admin account on first boot. Never overwrites an existing one. */
export async function ensureAdmin({ email = env.ADMIN_EMAIL, password = env.ADMIN_PASSWORD } = {}) {
  const repo = getDb().admins;
  const existing = await repo.findOne({ email: email.toLowerCase() });
  if (existing) return { created: false, admin: existing };
  const admin = await repo.create({
    email: email.toLowerCase(),
    name: 'Administrator',
    role: 'owner',
    passwordHash: await bcrypt.hash(password, 10),
  });
  return { created: true, admin };
}
