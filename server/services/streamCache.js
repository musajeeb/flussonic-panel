import { listStreams } from './flussonic.js';

/**
 * Reading every stream from every server on each page load would be slow and
 * would hammer the Flussonic boxes, so results are cached briefly. The Channels
 * page can force a refresh when the operator asks for one.
 */
const TTL_MS = 12_000;
const cache = new Map(); // serverId -> { at, streams, error }
const inflight = new Map(); // serverId -> Promise, so parallel requests share one fetch

export function invalidate(serverId) {
  if (serverId) cache.delete(String(serverId));
  else cache.clear();
}

export async function getStreams(server, { refresh = false } = {}) {
  const key = String(server.id);
  const hit = cache.get(key);

  if (!refresh && hit && Date.now() - hit.at < TTL_MS) return hit;

  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    let entry;
    try {
      entry = { at: Date.now(), streams: await listStreams(server), error: null };
    } catch (err) {
      // Keep serving the previous list if we have one — a momentary blip should
      // not empty the operator's channel list.
      entry = hit
        ? { ...hit, error: err.message }
        : { at: Date.now(), streams: [], error: err.message };
    }
    cache.set(key, entry);
    inflight.delete(key);
    return entry;
  })();

  inflight.set(key, promise);
  return promise;
}

/** Fetches every enabled server's streams in parallel. */
export async function getAllStreams(servers, { refresh = false } = {}) {
  const results = await Promise.all(
    servers
      .filter((s) => s.enabled !== false)
      .map(async (server) => ({ server, ...(await getStreams(server, { refresh })) }))
  );
  return results;
}
