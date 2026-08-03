import express from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { getDb } from '../db/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { asyncRoute, requireFields } from '../middleware/validate.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' },
});

router.post(
  '/login',
  loginLimiter,
  asyncRoute(async (req, res) => {
    requireFields(req.body, ['email', 'password']);
    const email = String(req.body.email).toLowerCase().trim();
    const admin = await getDb().admins.findOne({ email });

    // Same message and roughly the same work for both failure modes, so the
    // response does not reveal whether the address exists.
    const hash = admin?.passwordHash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const ok = await bcrypt.compare(String(req.body.password), hash);
    if (!admin || !ok) return res.status(401).json({ error: 'Invalid email or password' });

    return res.json({
      token: signToken(admin),
      user: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json({ user: req.admin });
  })
);

router.post(
  '/change-password',
  requireAuth,
  asyncRoute(async (req, res) => {
    requireFields(req.body, ['currentPassword', 'newPassword']);
    if (String(req.body.newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const db = getDb();
    const admin = await db.admins.findById(req.admin.id);
    const ok = await bcrypt.compare(String(req.body.currentPassword), admin.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });

    await db.admins.updateById(admin.id, { passwordHash: await bcrypt.hash(String(req.body.newPassword), 10) });
    return res.json({ ok: true });
  })
);

export default router;
