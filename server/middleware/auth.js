import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { getDb } from '../db/index.js';

export function signToken(admin) {
  return jwt.sign({ sub: admin.id, email: admin.email, role: admin.role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRE,
  });
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.cookies?.token) return req.cookies.token;
  return null;
}

export async function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return res.status(401).json({ error: expired ? 'Session expired — please sign in again' : 'Invalid token' });
  }

  const admin = await getDb().admins.findById(payload.sub);
  if (!admin) return res.status(401).json({ error: 'Account no longer exists' });

  req.admin = { id: admin.id, email: admin.email, role: admin.role, name: admin.name };
  return next();
}
