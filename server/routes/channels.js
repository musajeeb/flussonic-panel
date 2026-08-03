import express from 'express';
import { getDb } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import {
  asyncRoute,
  requireFields,
  assertStreamName,
  assertUrl,
  HttpError,
} from '../middleware/validate.js';
import { upsertStream, deleteStream, playbackUrls, describeError, getStream } from '../services/flussonic.js';
import { getAllStreams, invalidate } from '../services/streamCache.js';

const router = express.Router();
router.use(requireAuth);

function decorate(channel, serverMap) {
  const server = serverMap.get(String(channel.serverId)) || null;
  return {
    ...channel,
    serverName: server?.name || '(deleted server)',
    serverCategory: server?.category || '',
    urls: server ? playbackUrls(server, channel.name) : null,
  };
}

/**
 * Lists channels from two sources at once:
 *
 *  - rows this panel created, and
 *  - streams that already exist on the Flussonic servers.
 *
 * Servers usually have hundreds of channels configured long before this panel
 * existed. Making the operator re-enter them would be absurd, so they simply
 * appear, tagged `onServer`, and can be adopted into the panel with one click
 * when they need to belong to a subscriber package.
 */
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const db = getDb();
    const wantLive = req.query.live !== 'false';
    const refresh = req.query.refresh === 'true';

    const [channels, servers] = await Promise.all([db.channels.find({}, { sort: { name: 1 } }), db.servers.find({})]);
    const serverMap = new Map(servers.map((s) => [s.id, s]));

    const rows = channels.map((c) => ({ ...decorate(c, serverMap), source: c.origin === 'imported' ? 'imported' : 'panel', onServer: null }));
    const byKey = new Map(rows.map((r) => [`${r.serverId}::${r.name}`, r]));

    const serverErrors = [];
    if (wantLive && servers.length) {
      const live = await getAllStreams(servers, { refresh });

      for (const { server, streams, error } of live) {
        if (error) serverErrors.push({ serverId: server.id, serverName: server.name, error });

        for (const stream of streams) {
          const key = `${server.id}::${stream.name}`;
          const existing = byKey.get(key);

          if (existing) {
            // Known to the panel: attach what the server reports right now.
            existing.onServer = { alive: stream.alive, clients: stream.clients, bitrateBps: stream.inputBitrateBps };
            continue;
          }

          // Only on the server — show it without storing anything.
          byKey.set(key, {
            id: `live:${server.id}:${stream.name}`,
            name: stream.name,
            title: stream.title || '',
            serverId: server.id,
            serverName: server.name,
            serverCategory: server.category || '',
            sourceUrl: stream.sourceUrl || '',
            category: server.category || 'Uncategorised',
            logo: stream.logo || '',
            enabled: !stream.disabled,
            syncState: 'synced',
            syncError: '',
            source: 'server',
            urls: playbackUrls(server, stream.name),
            onServer: { alive: stream.alive, clients: stream.clients, bitrateBps: stream.inputBitrateBps },
          });
        }
      }
    }

    let data = [...byKey.values()];
    if (req.query.serverId) data = data.filter((c) => String(c.serverId) === String(req.query.serverId));
    if (req.query.category) data = data.filter((c) => c.category === req.query.category);
    if (req.query.source) data = data.filter((c) => c.source === req.query.source);
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      data = data.filter((c) => c.name.toLowerCase().includes(q) || (c.title || '').toLowerCase().includes(q));
    }
    data.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      data,
      counts: {
        total: byKey.size,
        managed: rows.length,
        serverOnly: [...byKey.values()].filter((c) => c.source === 'server').length,
      },
      serverErrors,
    });
  })
);

/**
 * Adopts streams that exist on a server into the panel, so they can be put into
 * subscriber packages. Nothing is pushed to Flussonic — the stream is already
 * there and its configuration is left exactly as it is.
 */
router.post(
  '/import',
  asyncRoute(async (req, res) => {
    const db = getDb();
    const serverId = String(req.body.serverId || '');
    const server = await db.servers.findById(serverId);
    if (!server) throw new HttpError(404, 'Server not found');

    const [{ streams, error }] = await getAllStreams([server], { refresh: true });
    if (error && streams.length === 0) throw new HttpError(502, `Could not read streams: ${error}`);

    const wanted = Array.isArray(req.body.names) && req.body.names.length ? new Set(req.body.names.map(String)) : null;
    const category = String(req.body.category || '').trim();

    const existing = await db.channels.find({ serverId: server.id });
    const known = new Set(existing.map((c) => c.name));

    const created = [];
    const skipped = [];
    for (const stream of streams) {
      if (wanted && !wanted.has(stream.name)) continue;
      if (known.has(stream.name)) {
        skipped.push(stream.name);
        continue;
      }
      created.push(
        await db.channels.create({
          name: stream.name,
          title: stream.title || '',
          serverId: server.id,
          sourceUrl: stream.sourceUrl || '',
          category: category || server.category || 'Uncategorised',
          logo: stream.logo || '',
          epgId: '',
          enabled: !stream.disabled,
          origin: 'imported',
          syncState: 'synced',
          syncError: '',
          lastSyncedAt: new Date(),
        })
      );
    }

    res.status(201).json({ imported: created.length, skipped: skipped.length, total: streams.length });
  })
);

/** Creates the stream on one server, or on every enabled server at once. */
async function createOnServer(db, server, draft) {
  const clash = await db.channels.findOne({ serverId: server.id, name: draft.name });
  if (clash) return { server, skipped: true, reason: `already exists on ${server.name}` };

  let syncState = 'pending';
  let syncError = '';
  let lastSyncedAt = null;
  try {
    await upsertStream(server, draft);
    syncState = 'synced';
    lastSyncedAt = new Date();
  } catch (err) {
    syncState = 'error';
    syncError = err.message;
  }

  const channel = await db.channels.create({
    ...draft,
    serverId: server.id,
    category: draft.category || server.category || 'General',
    syncState,
    syncError,
    lastSyncedAt,
  });
  invalidate(server.id);
  return { server, channel, syncState, syncError };
}

router.post(
  '/',
  asyncRoute(async (req, res) => {
    requireFields(req.body, ['name', 'serverId', 'sourceUrl']);
    const db = getDb();

    const name = assertStreamName(req.body.name);
    const sourceUrl = assertUrl(req.body.sourceUrl, 'Source URL');
    const wantsAll = String(req.body.serverId).toLowerCase() === 'all';

    let targets;
    if (wantsAll) {
      targets = (await db.servers.find({})).filter((s) => s.enabled !== false);
      if (targets.length === 0) throw new HttpError(400, 'No enabled servers to add this channel to');
    } else {
      const server = await db.servers.findById(String(req.body.serverId));
      if (!server) throw new HttpError(404, 'Selected server not found');
      targets = [server];
    }

    const draft = {
      name,
      title: String(req.body.title || '').trim(),
      sourceUrl,
      category: String(req.body.category || '').trim(),
      logo: String(req.body.logo || '').trim(),
      epgId: String(req.body.epgId || '').trim(),
      enabled: req.body.enabled !== false,
      origin: 'panel',
    };

    // Sequential: firing a config write at every server at once is how you take
    // a whole fleet down with one typo.
    const results = [];
    for (const server of targets) results.push(await createOnServer(db, server, draft));

    const created = results.filter((r) => r.channel);
    if (created.length === 0) {
      throw new HttpError(409, results.map((r) => r.reason).join('; ') || 'Nothing was created');
    }

    const failed = created.filter((r) => r.syncState === 'error');
    const skipped = results.filter((r) => r.skipped);

    res.status(201).json({
      data: created[0].channel,
      created: created.length,
      results: results.map((r) => ({
        serverId: r.server.id,
        serverName: r.server.name,
        status: r.skipped ? 'skipped' : r.syncState,
        error: r.syncError || r.reason || undefined,
      })),
      warning:
        failed.length || skipped.length
          ? [
              failed.length ? `${failed.length} server(s) rejected it: ${failed[0].syncError}` : '',
              skipped.length ? `${skipped.length} already had it` : '',
            ]
              .filter(Boolean)
              .join('. ')
          : undefined,
    });
  })
);

/**
 * Adopts a stream that lives only on the server into the panel, reading its real
 * configuration first so an edit cannot wipe the working source.
 */
async function adoptLiveChannel(db, liveId) {
  const [, serverId, ...rest] = String(liveId).split(':');
  const name = rest.join(':');
  const server = await db.servers.findById(serverId);
  if (!server) throw new HttpError(404, 'Server not found');

  const existing = await db.channels.findOne({ serverId: server.id, name });
  if (existing) return { server, channel: existing };

  let live = null;
  try {
    live = await getStream(server, name);
  } catch {
    live = null;
  }
  if (!live) {
    const [{ streams }] = await getAllStreams([server], { refresh: true });
    live = streams.find((x) => x.name === name) ?? null;
  }
  if (!live) throw new HttpError(404, `Stream "${name}" not found on ${server.name}`);

  const channel = await db.channels.create({
    name,
    title: live.title || '',
    serverId: server.id,
    sourceUrl: live.sourceUrl || '',
    category: server.category || 'Uncategorised',
    logo: live.logo || '',
    epgId: '',
    enabled: !live.disabled,
    origin: 'imported',
    syncState: 'synced',
    syncError: '',
    lastSyncedAt: new Date(),
  });
  invalidate(server.id);
  return { server, channel };
}

router.put(
  '/:id',
  asyncRoute(async (req, res) => {
    const db = getDb();

    // Editing a stream the panel has never stored: adopt it, then edit it.
    if (String(req.params.id).startsWith('live:')) {
      const { channel: adopted } = await adoptLiveChannel(db, req.params.id);
      req.params.id = adopted.id;
    }

    const channel = await db.channels.findById(req.params.id);
    if (!channel) throw new HttpError(404, 'Channel not found');
    const server = await db.servers.findById(channel.serverId);
    if (!server) throw new HttpError(409, 'The server this channel belongs to no longer exists');

    const patch = {};
    if (req.body.title !== undefined) patch.title = String(req.body.title).trim();
    if (req.body.sourceUrl !== undefined) patch.sourceUrl = assertUrl(req.body.sourceUrl, 'Source URL');
    if (req.body.category !== undefined) patch.category = String(req.body.category).trim();
    if (req.body.logo !== undefined) patch.logo = String(req.body.logo).trim();
    if (req.body.epgId !== undefined) patch.epgId = String(req.body.epgId).trim();
    if (req.body.enabled !== undefined) patch.enabled = Boolean(req.body.enabled);

    const merged = { ...channel, ...patch };
    if (!merged.sourceUrl) {
      // An imported stream whose input we never learned. Pushing a config with no
      // inputs would delete the working source on the server, so we do not push.
      patch.syncState = 'synced';
      patch.syncError = '';
    } else {
      try {
        await upsertStream(server, merged);
        patch.syncState = 'synced';
        patch.syncError = '';
        patch.lastSyncedAt = new Date();
      } catch (err) {
        patch.syncState = 'error';
        patch.syncError = err.message;
      }
    }

    const updated = await db.channels.updateById(channel.id, patch);
    invalidate(server.id);
    res.json({ data: { ...updated, serverName: server.name, urls: playbackUrls(server, updated.name) } });
  })
);

/** Re-push an existing channel, e.g. after the server was offline. */
router.post(
  '/:id/sync',
  asyncRoute(async (req, res) => {
    const db = getDb();
    const channel = await db.channels.findById(req.params.id);
    if (!channel) throw new HttpError(404, 'Channel not found');
    const server = await db.servers.findById(channel.serverId);
    if (!server) throw new HttpError(409, 'The server this channel belongs to no longer exists');

    if (!channel.sourceUrl) {
      throw new HttpError(
        409,
        'This channel was imported from the server and its source URL is unknown here, so re-pushing would wipe it. Set a source URL first if you want the panel to manage it.'
      );
    }
    try {
      await upsertStream(server, channel);
      const updated = await db.channels.updateById(channel.id, {
        syncState: 'synced',
        syncError: '',
        lastSyncedAt: new Date(),
      });
      res.json({ data: updated, status: 'synced' });
    } catch (err) {
      const updated = await db.channels.updateById(channel.id, { syncState: 'error', syncError: err.message });
      res.json({ data: updated, status: 'error', error: err.message });
    }
  })
);

router.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const db = getDb();

    // "live:<serverId>:<name>" refers to a stream that exists only on the server.
    if (String(req.params.id).startsWith('live:')) {
      const [, serverId, ...rest] = String(req.params.id).split(':');
      const name = rest.join(':');
      const target = await db.servers.findById(serverId);
      if (!target) throw new HttpError(404, 'Server not found');
      try {
        await deleteStream(target, name);
      } catch (err) {
        throw new HttpError(502, err.message);
      }
      invalidate(target.id);
      return res.json({ ok: true, deletedFromServer: name });
    }

    const channel = await db.channels.findById(req.params.id);
    if (!channel) throw new HttpError(404, 'Channel not found');
    const server = await db.servers.findById(channel.serverId);

    let remoteError = null;
    if (server) {
      try {
        await deleteStream(server, channel.name);
      } catch (err) {
        remoteError = err.message;
      }
    }

    // Deleting from Flussonic can fail (box offline) — we still remove our record,
    // but we tell the operator so they can clean up manually.
    await db.channels.deleteById(channel.id);
    if (server) invalidate(server.id);
    res.json({ ok: true, ...(remoteError ? { warning: `Removed locally, but Flussonic said: ${remoteError}` } : {}) });
  })
);

export default router;
