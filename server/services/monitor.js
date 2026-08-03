import { getDb } from '../db/index.js';
import { env } from '../config/env.js';
import { fetchServerStatus, fetchQuickStatus, describeError } from './flussonic.js';

const FAILURES_BEFORE_OFFLINE = 3;

let fastTimer = null;
let fullTimer = null;
let fastRunning = false;
let fullRunning = false;

/**
 * Two cycles, because the data has two very different costs.
 *
 * Fast: one small request per server for CPU, RAM, disk, uptime, viewers and
 * traffic — cheap enough to run every second or two.
 *
 * Full: the entire stream list (which carries a media_info block per stream, so
 * megabytes on a large server) plus sessions. Runs on a slower cycle.
 */
export async function pollQuick() {
  if (fastRunning) return { skipped: true };
  fastRunning = true;
  const db = getDb();
  try {
    const servers = await db.servers.find({ enabled: true });
    await Promise.all(
      servers.map(async (server) => {
        // Nothing cheap to ask for until the full poll has found an endpoint.
        if (!server.statusPath || server.statusPath === 'none') return;
        try {
          const { stats } = await fetchQuickStatus(server);
          await db.servers.updateById(server.id, {
            status: 'online',
            failCount: 0,
            lastError: '',
            // Merge: the quick poll must not erase streamsTotal, topStreams etc.
            stats: { ...(server.stats || {}), ...stats },
          });
        } catch {
          // A missed quick poll is not news; the full cycle decides on outages.
        }
      })
    );
  } catch (err) {
    console.error('[monitor:quick]', err.message);
  } finally {
    fastRunning = false;
  }
  return { ok: true };
}

export async function pollAllServers() {
  if (fullRunning) return { skipped: true };
  fullRunning = true;
  const db = getDb();
  const results = [];
  try {
    const servers = await db.servers.find({ enabled: true });
    await Promise.all(
      servers.map(async (server) => {
        try {
          const { stats, statusPath } = await fetchServerStatus(server);
          await db.servers.updateById(server.id, {
            status: 'online',
            lastError: '',
            failCount: 0,
            stats,
            ...(statusPath ? { statusPath } : {}),
          });
          results.push({ id: server.id, status: 'online' });
        } catch (err) {
          // One slow response is not an outage. Flipping to Offline on the first
          // failure made healthy servers look dead and threw away good readings,
          // so we keep the last known figures until it fails repeatedly.
          const fails = (server.failCount || 0) + 1;
          const givenUp = fails >= FAILURES_BEFORE_OFFLINE;
          await db.servers.updateById(server.id, {
            failCount: fails,
            lastError: describeError(err),
            ...(givenUp ? { status: 'offline' } : {}),
          });
          results.push({ id: server.id, status: givenUp ? 'offline' : 'degraded', error: describeError(err) });
        }
      })
    );
  } catch (err) {
    console.error('[monitor] poll failed:', err.message);
  } finally {
    fullRunning = false;
  }
  return { results };
}

export function startMonitor() {
  if (!env.MONITOR_ENABLED || fullTimer) return;

  const fastMs = Math.max(1, env.MONITOR_FAST_SEC) * 1000;
  const fullMs = Math.max(5, env.MONITOR_INTERVAL_SEC) * 1000;

  fastTimer = setInterval(() => {
    pollQuick().catch((err) => console.error('[monitor:quick]', err.message));
  }, fastMs);
  fullTimer = setInterval(() => {
    pollAllServers().catch((err) => console.error('[monitor]', err.message));
  }, fullMs);

  fastTimer.unref?.();
  fullTimer.unref?.();

  // Populate the dashboard quickly after boot.
  setTimeout(() => pollAllServers().catch(() => {}), 1500).unref?.();
}

export function stopMonitor() {
  if (fastTimer) clearInterval(fastTimer);
  if (fullTimer) clearInterval(fullTimer);
  fastTimer = null;
  fullTimer = null;
}
