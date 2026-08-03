import express from 'express';
import { getDb } from '../db/index.js';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute, requireFields, assertUsername, HttpError } from '../middleware/validate.js';
import { randomToken, randomPassword } from '../services/crypto.js';

const router = express.Router();
router.use(requireAuth);

function publicUrl(req) {
  if (env.PUBLIC_URL) return env.PUBLIC_URL;
  return `${req.protocol}://${req.get('host')}`;
}

function present(user, req) {
  const base = publicUrl(req);
  return {
    ...user,
    playlistUrl: `${base}/playlist/${user.token}.m3u`,
    expired: Boolean(user.expiresAt && new Date(user.expiresAt).getTime() < Date.now()),
  };
}

function parseExpiry(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'expiresAt must be a valid date');
  return d;
}

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const users = await getDb().iptvUsers.find({}, { sort: { username: 1 } });
    res.json({ data: users.map((u) => present(u, req)) });
  })
);

router.post(
  '/',
  asyncRoute(async (req, res) => {
    requireFields(req.body, ['username']);
    const db = getDb();
    const username = assertUsername(req.body.username);

    if (await db.iptvUsers.findOne({ username })) {
      throw new HttpError(409, `Subscriber "${username}" already exists`);
    }

    const maxConnections = Number(req.body.maxConnections ?? 1);
    if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 100) {
      throw new HttpError(400, 'maxConnections must be an integer between 1 and 100');
    }

    const user = await db.iptvUsers.create({
      username,
      password: String(req.body.password || '').trim() || randomPassword(10),
      token: randomToken(16),
      note: String(req.body.note || '').trim(),
      status: req.body.status === 'suspended' ? 'suspended' : 'active',
      maxConnections,
      expiresAt: parseExpiry(req.body.expiresAt),
      allowedCategories: Array.isArray(req.body.allowedCategories) ? req.body.allowedCategories.map(String) : [],
      allowedServerIds: Array.isArray(req.body.allowedServerIds) ? req.body.allowedServerIds.map(String) : [],
    });

    res.status(201).json({ data: present(user, req) });
  })
);

router.put(
  '/:id',
  asyncRoute(async (req, res) => {
    const db = getDb();
    const user = await db.iptvUsers.findById(req.params.id);
    if (!user) throw new HttpError(404, 'Subscriber not found');

    const patch = {};
    if (req.body.password !== undefined) patch.password = String(req.body.password).trim();
    if (req.body.note !== undefined) patch.note = String(req.body.note).trim();
    if (req.body.status !== undefined) patch.status = req.body.status === 'suspended' ? 'suspended' : 'active';
    if (req.body.maxConnections !== undefined) {
      const n = Number(req.body.maxConnections);
      if (!Number.isInteger(n) || n < 1 || n > 100) throw new HttpError(400, 'maxConnections must be 1-100');
      patch.maxConnections = n;
    }
    if (req.body.expiresAt !== undefined) patch.expiresAt = parseExpiry(req.body.expiresAt);
    if (req.body.allowedCategories !== undefined) {
      patch.allowedCategories = Array.isArray(req.body.allowedCategories)
        ? req.body.allowedCategories.map(String)
        : [];
    }
    if (req.body.allowedServerIds !== undefined) {
      patch.allowedServerIds = Array.isArray(req.body.allowedServerIds) ? req.body.allowedServerIds.map(String) : [];
    }

    const updated = await db.iptvUsers.updateById(user.id, patch);
    res.json({ data: present(updated, req) });
  })
);

/** Rotates the playback token, instantly invalidating any leaked playlist URL. */
router.post(
  '/:id/rotate-token',
  asyncRoute(async (req, res) => {
    const db = getDb();
    const user = await db.iptvUsers.findById(req.params.id);
    if (!user) throw new HttpError(404, 'Subscriber not found');
    const updated = await db.iptvUsers.updateById(user.id, { token: randomToken(16) });
    res.json({ data: present(updated, req) });
  })
);

router.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const deleted = await getDb().iptvUsers.deleteById(req.params.id);
    if (!deleted) throw new HttpError(404, 'Subscriber not found');
    res.json({ ok: true });
  })
);

export default router;
