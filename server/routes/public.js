import express from 'express';
import { getDb } from '../db/index.js';
import { env } from '../config/env.js';
import { evaluateSubscriber, canAccessChannel, entitledChannels } from '../services/access.js';
import { playbackUrls } from '../services/flussonic.js';
import { safeEqual } from '../services/crypto.js';
import { asyncRoute } from '../middleware/validate.js';

const router = express.Router();

/**
 * Flussonic authorization backend.
 *
 * Configure this URL once on every Flussonic server (Config -> Auth backends):
 *   http://YOUR-PANEL/api/auth-backend?key=AUTH_BACKEND_KEY
 *
 * Flussonic then asks the panel on every play request, which is why a subscriber
 * only has to be created once here instead of on each server.
 * Contract: HTTP 200 = allow, HTTP 403 = deny.
 */
async function handleAuthBackend(req, res) {
  const params = { ...req.query, ...(req.body || {}) };

  if (!safeEqual(params.key || req.headers['x-auth-key'], env.AUTH_BACKEND_KEY)) {
    return res.status(403).json({ error: 'forbidden', reason: 'bad_backend_key' });
  }

  const token = String(params.token || '').trim();
  const streamName = String(params.name || params.stream || '').trim();
  const ip = String(params.ip || '').trim();

  if (!token) return res.status(403).json({ error: 'forbidden', reason: 'no_token' });

  const db = getDb();
  const user = await db.iptvUsers.findOne({ token });
  const verdict = evaluateSubscriber(user);
  if (!verdict.allowed) return res.status(403).json({ error: 'forbidden', reason: verdict.reason });

  if (streamName) {
    const channels = await db.channels.find({ name: streamName });
    const permitted = channels.some((c) => canAccessChannel(user, c));
    // If the panel does not know the stream at all we deny: the operator manages
    // every channel here, so an unknown name means it is not part of any package.
    if (!permitted) return res.status(403).json({ error: 'forbidden', reason: 'channel_not_allowed' });
  }

  // Only overwrite lastIp when Flussonic actually sent one, otherwise a
  // re-auth request without the parameter would erase the known address.
  await db.iptvUsers.updateById(user.id, { lastSeenAt: new Date(), ...(ip ? { lastIp: ip } : {}) });

  // Flussonic reads these headers to enforce the concurrent-session limit for us.
  res.set('X-UserId', String(user.id));
  res.set('X-Max-Sessions', String(user.maxConnections || 1));
  res.set('X-AuthDuration', '600');
  return res.status(200).json({ status: 'ok', user_id: String(user.id) });
}

router.get('/api/auth-backend', asyncRoute(handleAuthBackend));
router.post('/api/auth-backend', asyncRoute(handleAuthBackend));

function m3uEscape(value) {
  return String(value || '').replace(/[\r\n"]/g, ' ').trim();
}

/** Per-subscriber M3U playlist — the single file you hand to a customer. */
router.get(
  '/playlist/:token.m3u',
  asyncRoute(async (req, res) => {
    const token = String(req.params.token || '').trim();
    const db = getDb();
    const user = await db.iptvUsers.findOne({ token });
    const verdict = evaluateSubscriber(user);
    if (!verdict.allowed) return res.status(403).type('text/plain').send(`#EXTM3U\n# access denied: ${verdict.reason}\n`);

    const [channels, servers] = await Promise.all([
      db.channels.find({}, { sort: { name: 1 } }),
      db.servers.find({}),
    ]);
    const serverMap = new Map(servers.map((s) => [s.id, s]));
    const allowed = entitledChannels(user, channels);

    const lines = ['#EXTM3U'];
    for (const channel of allowed) {
      const server = serverMap.get(String(channel.serverId));
      if (!server || server.enabled === false) continue;
      const urls = playbackUrls(server, channel.name, user.token);
      const display = m3uEscape(channel.title || channel.name);
      const attrs = [
        `tvg-id="${m3uEscape(channel.epgId)}"`,
        `tvg-name="${display}"`,
        `tvg-logo="${m3uEscape(channel.logo)}"`,
        `group-title="${m3uEscape(channel.category)}"`,
      ].join(' ');
      lines.push(`#EXTINF:-1 ${attrs},${display}`);
      lines.push(urls.hls);
    }

    res.type('audio/x-mpegurl');
    res.set('Content-Disposition', `attachment; filename="${user.username}.m3u"`);
    res.set('Cache-Control', 'no-store');
    return res.send(`${lines.join('\n')}\n`);
  })
);

export default router;
