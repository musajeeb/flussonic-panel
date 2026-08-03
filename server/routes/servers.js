import express from 'express';
import { getDb } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import {
  asyncRoute,
  requireFields,
  assertHost,
  assertPort,
  HttpError,
} from '../middleware/validate.js';
import { encrypt } from '../services/crypto.js';
import {
  fetchServerStatus,
  describeError,
  baseUrl,
  listStreams,
  restartStream,
  restartDeadStreams,
  reloadConfig,
  inspect,
} from '../services/flussonic.js';

const router = express.Router();
router.use(requireAuth);

/** Never leak the stored Flussonic password to the browser. */
function present(server) {
  const { apiPasswordEnc, ...rest } = server;
  return { ...rest, apiPasswordSet: Boolean(apiPasswordEnc), baseUrl: baseUrl(server) };
}

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const servers = await getDb().servers.find({}, { sort: { name: 1 } });
    res.json({ data: servers.map(present) });
  })
);

router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const server = await getDb().servers.findById(req.params.id);
    if (!server) throw new HttpError(404, 'Server not found');
    res.json({ data: present(server) });
  })
);

router.post(
  '/',
  asyncRoute(async (req, res) => {
    requireFields(req.body, ['name', 'host', 'apiUser', 'apiPassword']);
    const db = getDb();
    const host = assertHost(req.body.host);
    const port = assertPort(req.body.port);

    const duplicate = await db.servers.findOne({ host, port });
    if (duplicate) throw new HttpError(409, `A server with address ${host}:${port} already exists`);

    const server = await db.servers.create({
      name: String(req.body.name).trim(),
      category: String(req.body.category || 'General').trim(),
      protocol: req.body.protocol === 'https' ? 'https' : 'http',
      host,
      port,
      apiUser: String(req.body.apiUser).trim(),
      apiPasswordEnc: encrypt(String(req.body.apiPassword)),
      playbackDomain: String(req.body.playbackDomain || '').trim(),
      enabled: req.body.enabled !== false,
      status: 'unknown',
      stats: {},
    });

    res.status(201).json({ data: present(server) });
  })
);

router.put(
  '/:id',
  asyncRoute(async (req, res) => {
    const db = getDb();
    const existing = await db.servers.findById(req.params.id);
    if (!existing) throw new HttpError(404, 'Server not found');

    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body.category !== undefined) patch.category = String(req.body.category).trim();
    if (req.body.protocol !== undefined) patch.protocol = req.body.protocol === 'https' ? 'https' : 'http';
    if (req.body.host !== undefined) patch.host = assertHost(req.body.host);
    if (req.body.port !== undefined) patch.port = assertPort(req.body.port, existing.port);
    if (req.body.apiUser !== undefined) patch.apiUser = String(req.body.apiUser).trim();
    if (req.body.playbackDomain !== undefined) patch.playbackDomain = String(req.body.playbackDomain).trim();
    if (req.body.enabled !== undefined) patch.enabled = Boolean(req.body.enabled);
    // Empty string means "keep the existing password".
    if (req.body.apiPassword) patch.apiPasswordEnc = encrypt(String(req.body.apiPassword));

    const updated = await db.servers.updateById(req.params.id, patch);
    res.json({ data: present(updated) });
  })
);

router.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const db = getDb();
    const server = await db.servers.findById(req.params.id);
    if (!server) throw new HttpError(404, 'Server not found');

    const channelCount = await db.channels.count({ serverId: server.id });
    if (channelCount > 0 && req.query.force !== 'true') {
      throw new HttpError(
        409,
        `This server still has ${channelCount} channel(s). Delete them first, or repeat the request with ?force=true to remove the panel records too.`
      );
    }
    if (req.query.force === 'true') await db.channels.deleteMany({ serverId: server.id });
    await db.servers.deleteById(server.id);
    res.json({ ok: true, deletedChannels: req.query.force === 'true' ? channelCount : 0 });
  })
);

/** Live probe: contacts the Flussonic box and stores the result. */
router.post(
  '/:id/check',
  asyncRoute(async (req, res) => {
    const db = getDb();
    const server = await db.servers.findById(req.params.id);
    if (!server) throw new HttpError(404, 'Server not found');

    try {
      const { stats, statusPath } = await fetchServerStatus(server, { force: true });
      const updated = await db.servers.updateById(server.id, {
        status: 'online',
        lastError: '',
        failCount: 0,
        stats,
        ...(statusPath ? { statusPath } : {}),
      });
      res.json({ data: present(updated), status: 'online' });
    } catch (err) {
      const message = describeError(err);
      const fails = (server.failCount || 0) + 1;
      const givenUp = fails >= 3;
      // Keep the previous readings on screen — a blip should not blank the card.
      const updated = await db.servers.updateById(server.id, {
        failCount: fails,
        lastError: message,
        ...(givenUp ? { status: 'offline' } : {}),
      });
      res.status(200).json({
        data: present(updated),
        status: givenUp ? 'offline' : 'degraded',
        error: message,
        attempt: fails,
      });
    }
  })
);

/** Every stream on the box, live — including ones not managed by this panel. */
router.get(
  '/:id/streams',
  asyncRoute(async (req, res) => {
    const server = await getDb().servers.findById(req.params.id);
    if (!server) throw new HttpError(404, 'Server not found');
    try {
      const streams = await listStreams(server);
      res.json({
        count: streams.length,
        alive: streams.filter((s) => s.alive).length,
        data: streams.sort((a, b) => (b.clients || 0) - (a.clients || 0)),
      });
    } catch (err) {
      throw new HttpError(502, describeError(err));
    }
  })
);

/** Restart one stream. */
router.post(
  '/:id/streams/:name/restart',
  asyncRoute(async (req, res) => {
    const server = await getDb().servers.findById(req.params.id);
    if (!server) throw new HttpError(404, 'Server not found');
    try {
      await restartStream(server, req.params.name);
      res.json({ ok: true, restarted: req.params.name });
    } catch (err) {
      throw new HttpError(502, err.message);
    }
  })
);

/** Restart everything that is currently dead on this server. */
router.post(
  '/:id/restart-dead',
  asyncRoute(async (req, res) => {
    const server = await getDb().servers.findById(req.params.id);
    if (!server) throw new HttpError(404, 'Server not found');
    try {
      res.json({ ok: true, ...(await restartDeadStreams(server)) });
    } catch (err) {
      throw new HttpError(502, err.message);
    }
  })
);

/** Ask Flussonic to re-read its config. Playback is not interrupted. */
router.post(
  '/:id/reload',
  asyncRoute(async (req, res) => {
    const server = await getDb().servers.findById(req.params.id);
    if (!server) throw new HttpError(404, 'Server not found');
    try {
      const result = await reloadConfig(server);
      res.json({ ok: true, endpoint: result.path });
    } catch (err) {
      throw new HttpError(502, err.message);
    }
  })
);

/** Diagnostic: which endpoints this server answers, and a sample payload. */
router.get(
  '/:id/inspect',
  asyncRoute(async (req, res) => {
    const server = await getDb().servers.findById(req.params.id);
    if (!server) throw new HttpError(404, 'Server not found');
    res.json(await inspect(server));
  })
);

export default router;
