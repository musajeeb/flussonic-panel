import express from 'express';
import { getDb } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/validate.js';
import { baseUrl } from '../services/flussonic.js';

const router = express.Router();
router.use(requireAuth);

function sum(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const db = getDb();
    const [servers, channels, users] = await Promise.all([
      db.servers.find({}, { sort: { name: 1 } }),
      db.channels.find({}),
      db.iptvUsers.find({}),
    ]);

    const now = Date.now();
    const activeUsers = users.filter(
      (u) => u.status === 'active' && (!u.expiresAt || new Date(u.expiresAt).getTime() >= now)
    );

    const channelsByServer = channels.reduce((acc, c) => {
      acc[c.serverId] = (acc[c.serverId] || 0) + 1;
      return acc;
    }, {});

    res.json({
      totals: {
        servers: servers.length,
        serversOnline: servers.filter((s) => s.status === 'online').length,
        serversOffline: servers.filter((s) => s.status === 'offline').length,
        channels: channels.length,
        channelsSynced: channels.filter((c) => c.syncState === 'synced').length,
        channelsError: channels.filter((c) => c.syncState === 'error').length,
        subscribers: users.length,
        subscribersActive: activeUsers.length,
        clients: sum(servers.map((s) => Number(s.stats?.clients))),
        outputBitrateBps: sum(servers.map((s) => Number(s.stats?.outputBitrateBps))),
        inputBitrateBps: sum(servers.map((s) => Number(s.stats?.inputBitrateBps))),
      },
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        status: s.status,
        enabled: s.enabled,
        lastError: s.lastError,
        baseUrl: baseUrl(s),
        channels: channelsByServer[s.id] || 0,
        stats: s.stats || {},
      })),
      categories: [...new Set(channels.map((c) => c.category).filter(Boolean))].sort(),
      topStreams: servers
        .flatMap((s) =>
          (s.stats?.topStreams || []).map((t) => ({ ...t, serverId: s.id, serverName: s.name }))
        )
        .sort((a, b) => (b.clients || 0) - (a.clients || 0))
        .slice(0, 10),
    });
  })
);

export default router;
