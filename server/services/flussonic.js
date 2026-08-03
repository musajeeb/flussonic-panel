import axios from 'axios';
import { env } from '../config/env.js';
import { decrypt } from './crypto.js';

/**
 * Thin client for the Flussonic Media Server HTTP API.
 *
 * Primary endpoints are API v3 (`/streamer/api/v3/...`, Flussonic 21.x and newer).
 * Where an older path is still widely deployed we fall back to it, so the panel
 * keeps working on mixed-version fleets.
 *
 * Auth is HTTP Basic with the Flussonic admin user (Config -> Settings -> Access).
 */

export function baseUrl(server) {
  const protocol = server.protocol || 'http';
  const port = server.port ? `:${server.port}` : '';
  return `${protocol}://${server.host}${port}`;
}

export function serverCredentials(server) {
  return {
    username: server.apiUser,
    password: decrypt(server.apiPasswordEnc),
  };
}

function client(server) {
  return axios.create({
    baseURL: baseUrl(server),
    auth: serverCredentials(server),
    timeout: env.FLUSSONIC_TIMEOUT_MS,
    // We inspect status codes ourselves so a 404 on a probe does not throw.
    validateStatus: () => true,
    headers: { Accept: 'application/json' },
  });
}

export function describeError(err) {
  if (!err) return 'Unknown error';
  if (err.response) {
    const { status } = err.response;
    if (status === 401 || status === 403) return 'Authentication failed — check the API user and password';
    return `Flussonic replied with HTTP ${status}`;
  }
  if (err.code === 'ECONNABORTED') return 'Connection timed out';
  if (err.code === 'ECONNREFUSED') return 'Connection refused — is the port correct and open?';
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return 'Host not found — check the address';
  return err.message || 'Unknown error';
}

/** Runs GET against each candidate path and returns the first 2xx JSON body. */
async function probeGet(http, paths) {
  const errors = [];
  for (const path of paths) {
    let res;
    try {
      res = await http.get(path);
    } catch (err) {
      errors.push(`${path}: ${describeError(err)}`);
      continue;
    }
    if (res.status >= 200 && res.status < 300) return { path, data: res.data };
    if (res.status === 401 || res.status === 403) {
      const e = new Error('Authentication failed — check the API user and password');
      e.status = res.status;
      throw e;
    }
    errors.push(`${path}: HTTP ${res.status}`);
  }
  const err = new Error(`No supported endpoint responded (${errors.join('; ')})`);
  err.probeErrors = errors;
  throw err;
}

function num(...candidates) {
  for (const c of candidates) {
    // Number(null) and Number('') are 0, which would turn "not reported" into a
    // confident 0% on the dashboard. Skip empties before coercing.
    if (c === null || c === undefined || c === '') continue;
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Flussonic reports stream bitrate in kbit/s — its own UI prints "2192kbit/s".
 * We store bits per second, so small values have to be scaled up. A real video
 * stream is never a few hundred bits per second, so a value below 100000 can
 * only be kbit/s; anything larger is already bps and is left alone.
 *
 * Verified against a live server: 115 streams summed to 332 (kbit/s), while
 * Flussonic's own header showed 338 MBPS for the same box.
 */
export function bitrateToBps(value) {
  const n = num(value);
  if (n === null || n <= 0) return null;
  return n < 100_000 ? Math.round(n * 1000) : n;
}

function pct(used, total) {
  const u = Number(used);
  const t = Number(total);
  if (!Number.isFinite(u) || !Number.isFinite(t) || t <= 0) return null;
  return Math.round((u / t) * 1000) / 10;
}

/**
 * Normalises the very different shapes Flussonic versions return for server health.
 * Anything we cannot find stays null rather than being invented.
 */
export function normalizeStatus(raw = {}) {
  const d = raw || {};
  const memTotal = num(d.total_memory, d.memory_total, d.memory?.total, d.system?.memory_total);
  const memFree = num(d.free_memory, d.memory_free, d.memory?.free, d.system?.memory_free);
  const memUsed = num(d.used_memory, d.memory?.used, memTotal !== null && memFree !== null ? memTotal - memFree : null);

  const diskTotal = num(d.total_disk, d.disk_total, d.disk?.total);
  const diskFree = num(d.free_disk, d.disk_free, d.disk?.free);
  const diskUsed = num(d.used_disk, d.disk?.used, diskTotal !== null && diskFree !== null ? diskTotal - diskFree : null);

  const cpu = num(
    d.cpu_usage,
    d.cpu?.usage,
    d.cpu_percent,
    Number.isFinite(Number(d.cpu?.idle)) ? 100 - Number(d.cpu.idle) : null
  );

  return {
    cpuPercent: cpu === null ? null : Math.round(cpu * 10) / 10,
    memoryTotalBytes: memTotal,
    memoryUsedBytes: memUsed,
    memoryPercent: num(d.memory_usage, d.memory?.usage) ?? pct(memUsed, memTotal),
    diskTotalBytes: diskTotal,
    diskUsedBytes: diskUsed,
    diskPercent: num(d.disk_usage) ?? pct(diskUsed, diskTotal),
    inputBitrateBps: bitrateToBps(num(d.total_input_bitrate, d.input_bitrate, d.bitrate_in)),
    outputBitrateBps: bitrateToBps(num(d.total_output_bitrate, d.output_bitrate, d.bitrate_out)),
    clients: num(d.total_clients, d.clients, d.online_clients),
    streamsTotal: num(d.streams_count, d.total_streams, d.streams),
    uptimeSec: num(d.uptime, d.system?.uptime),
    version: d.version || d.flussonic_version || '',
  };
}

/** Normalises the stream list across `{streams:[...]}`, `[...]` and `{name:{...}}` shapes. */
export function normalizeStreamList(raw) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (Array.isArray(raw?.streams)) list = raw.streams;
  else if (raw && typeof raw === 'object') {
    list = Object.entries(raw)
      .filter(([, v]) => v && typeof v === 'object')
      .map(([name, value]) => ({ name, ...value }));
  }
  return list
    .filter((s) => s && (s.name || s.stream))
    .map((s) => {
      const st = s.stats || {};
      return {
        name: s.name || s.stream,
        alive: Boolean(s.alive ?? st.alive ?? s.running ?? s.status === 'online'),
        clients: num(s.clients, st.clients, st.online_clients, s.client_count, st.client_count) ?? 0,
        // `inputs_bandwidth` / `output_bandwidth` are already bits per second.
        // `input_bitrate` is kbit/s. Prefer the former: no unit guessing.
        inputBitrateBps:
          num(st.inputs_bandwidth, s.inputs_bandwidth) ??
          bitrateToBps(num(st.input_bitrate, s.input_bitrate, st.bitrate, s.bitrate)),
        outputBitrateBps:
          num(st.output_bandwidth, st.out_bandwidth, s.output_bandwidth) ??
          bitrateToBps(num(st.output_bitrate, s.output_bitrate)),
        openedAt: num(st.opened_at, s.opened_at),
        title: s.title || s.meta?.title || '',
        // Where the stream pulls from. Needed to import channels that already
        // exist on the box; absent in some list responses, hence the fallbacks.
        sourceUrl:
          s.inputs?.[0]?.url || s.input?.url || s.source || s.url || (Array.isArray(s.urls) ? s.urls[0] : '') || '',
        logo: s.meta?.logo || '',
      };
    });
}

const API_BASE = '/streamer/api/v3';
const STATUS_PATHS = [
  // Confirmed present in the schema of Flussonic 24.03.
  '/streamer/api/v3/config/stats',
  '/streamer/api/v3/chassis',
  '/streamer/api/v3/system/status',
  '/streamer/api/v3/system_status',
  '/streamer/api/v3/server',
  '/streamer/api/v3/status',
  '/flussonic/api/server',
  '/streamer/api/v3/config/system',
];
const STREAM_LIST_PATHS = ['/streamer/api/v3/streams', '/flussonic/api/streams'];
const SCHEMA_PATH = '/streamer/api/v3/schema';
const SESSION_PATHS = ['/streamer/api/v3/sessions', '/flussonic/api/sessions'];

// Prometheus-format metrics. Flussonic exposes these on several paths depending
// on version and licence, and they carry the process figures the REST status
// endpoints do not: resident memory, CPU seconds and uptime.
const METRICS_PATHS = [
  '/streamer/api/v3/metrics',
  '/streamer/api-v4/runtime/metrics',
  '/streamer/metrics',
  '/metrics',
  '/flussonic/api/metrics',
  '/streamer/api/v3/monitoring/metrics',
];

/** Does this payload look like server health data? Higher score = better match. */
export function healthScore(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 0;
  const flat = JSON.stringify(data).toLowerCase();
  const signals = [
    'uptime',
    'memory',
    'total_memory',
    'cpu',
    'disk',
    'total_clients',
    'input_bitrate',
    'output_bitrate',
    'streams_count',
    'version',
  ];
  return signals.reduce((n, key) => n + (flat.includes(`"${key}`) || flat.includes(key) ? 1 : 0), 0);
}

/**
 * Flussonic publishes an OpenAPI schema describing its own endpoints, and its
 * Admin UI reads the header figures (uptime, clients, traffic) through that same
 * API. So when none of the known paths work we ask the server what it offers and
 * pick whichever response actually looks like health data — matching on content
 * rather than on a path name we would otherwise be guessing at.
 */
export async function discoverStatusPaths(http) {
  let res;
  try {
    res = await http.get(SCHEMA_PATH);
  } catch {
    return [];
  }
  if (res.status < 200 || res.status >= 300) return [];

  const paths = res.data?.paths;
  if (!paths || typeof paths !== 'object') return [];

  // The schema lists paths RELATIVE to the API base: it says "/config/stats",
  // not "/streamer/api/v3/config/stats". Using them verbatim produced a 404 on
  // every single candidate, which is why discovery never found anything.
  const base = (() => {
    const declared = res.data?.servers?.[0]?.url;
    if (typeof declared === 'string' && declared.includes('/api/')) {
      return declared.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '');
    }
    return API_BASE;
  })();

  const usable = Object.keys(paths)
    .filter((p) => !p.includes('{')) // templated paths need an id we do not have
    .filter((p) => paths[p]?.get)
    // Skip collections that are large or irrelevant — we want a small summary object.
    .filter((p) => !/(streams|sessions|vods|files|dvr|episodes|media_info|schema|events|logs|pushes|auth|subscribers|packages)/i.test(p))
    .map((p) => {
      const clean = p.startsWith('/') ? p : `/${p}`;
      return clean.startsWith(base) || clean.startsWith('/streamer') || clean.startsWith('/flussonic')
        ? clean
        : `${base}${clean}`;
    });

  // Name-matched candidates first, everything else after, so the common case
  // costs one request and the unusual case still resolves.
  const named = usable.filter((p) => /(status|system|server|node|health|stat|monitor|info|chassis|config)/i.test(p));
  const rest = usable.filter((p) => !named.includes(p));
  return [...named, ...rest].slice(0, 20);
}

/** Tries candidates and returns the one whose body most looks like health data. */
async function findHealthEndpoint(http, candidates) {
  let best = null;
  for (const path of candidates) {
    let res;
    try {
      res = await http.get(path);
    } catch {
      continue;
    }
    if (res.status < 200 || res.status >= 300) continue;
    const score = healthScore(res.data);
    if (score > (best?.score ?? 0)) best = { path, data: res.data, score };
    if (best && best.score >= 4) break; // good enough, stop hammering the server
  }
  return best;
}

/**
 * Fetches health + traffic + stream counts.
 *
 * The stream list is checked first: it is what channel management depends on, and
 * it also carries the numbers Flussonic's own header shows — viewer count and
 * per-stream bitrate. A server whose streams we can read is usable even when no
 * health endpoint exists, so only a server that fails both is reported offline.
 */
export async function fetchServerStatus(server, { force = false } = {}) {
  const http = client(server);
  const stats = {};
  const notes = [];
  let reachable = false;
  let sessionStats = null;

  // 1 — full (paginated) stream list, plus the traffic totals we can derive
  try {
    const streams = await listStreams(server);
    stats.streamsTotal = streams.length;
    stats.streamsAlive = streams.filter((s) => s.alive).length;

    const clientTotal = streams.reduce((n, s) => n + (s.clients || 0), 0);
    stats.clients = clientTotal;

    const inSum = streams.reduce((n, s) => n + (s.inputBitrateBps || 0), 0);
    if (inSum > 0) stats.inputBitrateBps = inSum;

    // Egress: prefer real viewer sessions, which carry their own bitrate.
    //
    // Flussonic's per-stream `output_bitrate` is the rate a stream *produces*,
    // which equals its input — summing that made IN and OUT identical, which is
    // meaningless. Sessions are the actual traffic leaving the box.
    try {
      const sessions = await listSessions(server);
      // Not every version reports a per-session bitrate. When it is missing we
      // charge each viewer the bitrate of the stream they are actually watching,
      // which is the same arithmetic Flussonic does — not a guess at the total.
      const rateByStream = new Map(streams.map((x) => [x.name, x.inputBitrateBps || 0]));
      const egress = sessions.reduce((n, x) => n + (x.bitrateBps || rateByStream.get(x.name) || 0), 0);
      sessionStats = { clients: sessions.length, egress };
      stats.clients = sessionStats.clients;
      if (sessionStats.egress > 0) {
        stats.outputBitrateBps = sessionStats.egress;
        stats.outputEstimated = false;
      }
      stats.sessionsRead = true;
    } catch {
      stats.sessionsRead = false;
    }

    if (stats.outputBitrateBps === undefined) {
      // No usable session data — fall back to viewers x bitrate, clearly labelled.
      const estimated = streams.reduce((n, s) => n + (s.clients || 0) * (s.inputBitrateBps || 0), 0);
      stats.outputBitrateBps = estimated;
      stats.outputEstimated = estimated > 0;
    }

    // What people are actually watching right now.
    stats.topStreams = streams
      .filter((s) => (s.clients || 0) > 0)
      .sort((a, b) => b.clients - a.clients)
      .slice(0, 10)
      .map((s) => ({ name: s.name, title: s.title || '', clients: s.clients, bitrateBps: s.inputBitrateBps ?? null }));

    reachable = true;
  } catch (err) {
    if (err.status === 401 || err.status === 403) throw err;
    notes.push(`stream list unavailable (${err.message})`);
  }

  // 2 — health metrics. A path we found previously is tried first, so the normal
  //     poll is a single request; discovery only runs when that fails.
  let health = null;
  let healthPath = server.statusPath || null;

  // Once we have established a server has no health endpoint, re-probing eight
  // dead paths on every poll costs ten seconds and finds nothing. Remember the
  // answer; "Check" and "Diagnose" still force a fresh look.
  // Prometheus metrics carry process memory, CPU and uptime even when the REST
  // status endpoints are absent, so they are tried before giving up.
  let metricsInfo = null;
  try {
    metricsInfo = await fetchMetrics(server);
  } catch {
    metricsInfo = null;
  }
  if (metricsInfo) {
    Object.assign(stats, statusFromMetrics(metricsInfo.metrics, server.stats?.cpuSample ?? null));
    notes.push(`metrics from ${metricsInfo.path}`);
    reachable = true;
  }

  if (server.statusPath === 'none' && !force) {
    if (!metricsInfo) notes.push('CPU/RAM/disk/uptime not available on this server');
    if (!reachable) throw new Error(notes.join('; '));
    stats.checkedAt = new Date();
    stats.notes = notes.join('; ');
    return { stats, statusPath: 'none' };
  }

  const known = server.statusPath && server.statusPath !== 'none' ? [server.statusPath, ...STATUS_PATHS] : STATUS_PATHS;

  try {
    const { data, path } = await probeGet(http, known);
    health = data;
    healthPath = path;
  } catch (err) {
    if (err.status === 401 || err.status === 403) throw err;
    const candidates = await discoverStatusPaths(http);
    const found = candidates.length ? await findHealthEndpoint(http, candidates) : null;
    if (found) {
      health = found.data;
      healthPath = found.path;
      notes.push(`health read from ${found.path}`);
    } else {
      notes.push('CPU/RAM/disk/uptime not available on this server');
      healthPath = 'none';
    }
  }

  if (health) {
    // Anything the server reports itself beats a figure we derived.
    for (const [k, v] of Object.entries(normalizeStatus(health))) {
      if (v !== null && v !== '') stats[k] = v;
    }
    // ...except viewer figures, where per-session data is the finer measurement:
    // it excludes publishing sources and carries each viewer's own bitrate.
    if (stats.sessionsRead && sessionStats) {
      stats.clients = sessionStats.clients;
      if (sessionStats.egress > 0) {
        stats.outputBitrateBps = sessionStats.egress;
        stats.outputEstimated = false;
      }
    }
    reachable = true;
  }

  if (!reachable) {
    throw new Error(notes.join('; ') || 'Server did not respond to any known endpoint');
  }

  stats.checkedAt = new Date();
  stats.notes = notes.join('; ');
  return { stats, statusPath: healthPath };
}

/**
 * Parses Prometheus text format into a flat map of name -> value.
 * Labels are ignored; for labelled series we keep the largest value, which is
 * what you want for totals like memory across schedulers.
 */
export function parsePrometheus(text) {
  const out = {};
  if (typeof text !== 'string') return out;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([-+0-9.eE]+|NaN)$/);
    if (!match) continue;
    const [, name, , raw] = match;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out[name] = out[name] === undefined ? value : Math.max(out[name], value);
  }
  return out;
}

/**
 * Turns Prometheus metrics into the same shape as a status endpoint.
 *
 * CPU is published as a monotonically increasing counter of seconds used, so a
 * percentage only exists relative to a previous reading — we carry the last
 * sample forward and derive the rate.
 */
export function statusFromMetrics(metrics, previousSample = null, now = Date.now()) {
  const stats = {};
  const memUsed = num(
    metrics.process_resident_memory_bytes,
    metrics.erlang_vm_memory_bytes_total,
    metrics.flussonic_memory_used_bytes
  );
  const memTotal = num(metrics.node_memory_MemTotal_bytes, metrics.machine_memory_bytes, metrics.system_memory_total_bytes);
  if (memUsed !== null) stats.memoryUsedBytes = memUsed;
  if (memTotal !== null) stats.memoryTotalBytes = memTotal;
  if (memUsed !== null && memTotal) stats.memoryPercent = Math.round((memUsed / memTotal) * 1000) / 10;

  const diskTotal = num(metrics.node_filesystem_size_bytes, metrics.disk_total_bytes);
  const diskFree = num(metrics.node_filesystem_avail_bytes, metrics.disk_free_bytes);
  if (diskTotal !== null && diskFree !== null) {
    stats.diskTotalBytes = diskTotal;
    stats.diskUsedBytes = diskTotal - diskFree;
    stats.diskPercent = Math.round(((diskTotal - diskFree) / diskTotal) * 1000) / 10;
  }

  const uptime = num(metrics.process_uptime_seconds, metrics.flussonic_uptime_seconds);
  const startedAt = num(metrics.process_start_time_seconds);
  if (uptime !== null) stats.uptimeSec = Math.round(uptime);
  else if (startedAt !== null) stats.uptimeSec = Math.round(now / 1000 - startedAt);

  const cpuSeconds = num(metrics.process_cpu_seconds_total, metrics.flussonic_cpu_seconds_total);
  if (cpuSeconds !== null) {
    stats.cpuSample = { seconds: cpuSeconds, at: now };
    if (previousSample && Number.isFinite(previousSample.seconds) && previousSample.at < now) {
      const elapsed = (now - previousSample.at) / 1000;
      const used = cpuSeconds - previousSample.seconds;
      if (elapsed > 0 && used >= 0) {
        const cores = num(metrics.machine_cpu_cores, metrics.node_cpu_count) || 1;
        stats.cpuPercent = Math.min(100, Math.round(((used / elapsed / cores) * 100) * 10) / 10);
      }
    }
  }
  return stats;
}

/** Fetches Prometheus metrics, if this server publishes any. */
export async function fetchMetrics(server) {
  const http = client(server);
  for (const path of METRICS_PATHS) {
    let res;
    try {
      res = await http.get(path, { headers: { Accept: 'text/plain' }, responseType: 'text' });
    } catch {
      continue;
    }
    if (res.status < 200 || res.status >= 300) continue;
    const body = typeof res.data === 'string' ? res.data : '';
    const parsed = parsePrometheus(body);
    if (Object.keys(parsed).length > 0) return { path, metrics: parsed };
  }
  return null;
}

/** Normalises a viewer session. */
export function normalizeSessions(raw) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (Array.isArray(raw?.sessions)) list = raw.sessions;
  else if (raw && typeof raw === 'object') list = Object.values(raw).filter((v) => v && typeof v === 'object');

  return list
    // A publishing source is not a viewer; counting it would inflate the numbers.
    .filter((x) => !['publish', 'ingest', 'source'].includes(String(x.type || x.session_type || '').toLowerCase()))
    .map((x) => ({
      name: x.name || x.stream || x.media || '',
      ip: x.ip || x.remote_addr || '',
      userId: x.user_id ?? x.userId ?? null,
      proto: x.proto || x.protocol || '',
      bitrateBps: bitrateToBps(num(x.bitrate, x.stats?.bitrate, x.out_bitrate)),
      bytesSent: num(x.bytes_sent, x.bytes, x.stats?.bytes_sent),
      openedAt: num(x.opened_at, x.created_at),
    }));
}

/**
 * Live viewer sessions. This is the exact figure Flussonic shows as CLIENTS, and
 * summing each session's bitrate gives real egress instead of an estimate.
 */
export async function listSessions(server) {
  const http = client(server);
  const { path } = await probeGet(http, SESSION_PATHS.map((p) => `${p}?limit=1`));
  const basePath = path.split('?')[0];

  // Servers reject pages they consider too large, so we come down gracefully
  // rather than losing the data entirely.
  for (const limit of [500, 200, 100]) {
    const res = await http.get(`${basePath}?limit=${limit}`).catch(() => null);
    if (res && res.status >= 200 && res.status < 300) return normalizeSessions(res.data);
  }
  throw new Error('Could not read the session list');
}

/**
 * A single cheap request for the figures that change every second.
 *
 * The full stream list carries a `media_info` block per stream — on a 366-stream
 * box that is megabytes, far too heavy to fetch once a second. The status
 * endpoint returns one small object, so it can be polled continuously while the
 * expensive listing refreshes on a slower cycle.
 */
export async function fetchQuickStatus(server) {
  const http = client(server);
  const paths = server.statusPath && server.statusPath !== 'none' ? [server.statusPath] : STATUS_PATHS;
  const { data, path } = await probeGet(http, paths);

  const stats = normalizeStatus(data);
  const previous = server.stats?.cpuSample ?? null;
  if (stats.cpuPercent === null && previous) delete stats.cpuPercent;

  // Drop keys the status endpoint did not answer, so a quick poll never blanks
  // a value the full poll established.
  for (const [k, v] of Object.entries(stats)) {
    if (v === null || v === '') delete stats[k];
  }
  stats.checkedAt = new Date();
  return { stats, statusPath: path };
}

/** Total item count a collection response advertises, if it advertises one. */
function advertisedTotal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return num(raw.estimated_count, raw.total, raw.count, raw.total_count, raw.items_total);
}

/**
 * Lists every stream on the server.
 *
 * Harder than it should be: Flussonic caps how many streams one response carries,
 * and versions disagree about how to ask for the next slice. A server that
 * silently ignores the paging parameter returns the same first page again, which
 * leaves hundreds of channels invisible — exactly what happened on a 365-stream
 * box that reported only 200.
 *
 * So we do not assume. We ask for everything at once first, and if that comes
 * back capped we try each known paging style and keep whichever actually yields
 * stream names we have not seen.
 */
export async function listStreams(server, { maxStreams = 20000 } = {}) {
  const http = client(server);

  const { path } = await probeGet(http, STREAM_LIST_PATHS.map((p) => `${p}?limit=1`));
  const basePath = path.split('?')[0];

  const get = async (query) => {
    const res = await http.get(`${basePath}?${query}`);
    if (res.status < 200 || res.status >= 300) return null;
    return { streams: normalizeStreamList(res.data), total: advertisedTotal(res.data) };
  };

  // 1 — negotiate a page size.
  //
  // Asking for everything at once (limit=20000) is rejected outright by busy
  // servers, and treating that as "server unreachable" is what turned working
  // boxes offline. So we step down until one is accepted.
  let first = null;
  for (const limit of [1000, 500, 200, 100, 50]) {
    first = await get(`limit=${limit}`);
    if (first) break;
  }
  if (!first) first = await get('');
  if (!first) throw new Error('Could not read the stream list');

  const collected = new Map(first.streams.map((s) => [s.name, s]));
  const total = first.total;
  const pageSize = first.streams.length;

  const complete = () => (total !== null ? collected.size >= total : false);

  if (pageSize === 0 || complete()) return [...collected.values()];

  // 2 — We cannot tell "only 200 exist" from "capped at 200" unless the server
  //     advertises a total, and assuming the former is what hid 165 channels on
  //     a real box. So we always probe once. On a small server the probe comes
  //     back empty and costs a single extra request.
  const styles = [
    { name: 'offset', query: (n) => `limit=${pageSize}&offset=${n}` },
    { name: 'skip', query: (n) => `limit=${pageSize}&skip=${n}` },
    { name: 'from', query: (n) => `limit=${pageSize}&from=${n}` },
    { name: 'page', query: (n) => `limit=${pageSize}&page=${Math.floor(n / pageSize) + 1}` },
  ];

  for (const style of styles) {
    const probe = await get(style.query(pageSize)).catch(() => null);
    if (!probe) continue;

    // An empty page means we already have the whole collection — no need to
    // try the remaining paging styles.
    if (probe.streams.length === 0) break;

    const fresh = probe.streams.filter((s) => !collected.has(s.name));
    if (fresh.length === 0) continue; // this server ignores that parameter

    for (const s of fresh) collected.set(s.name, s);

    let offset = pageSize * 2;
    for (let guard = 0; guard < Math.ceil(maxStreams / Math.max(pageSize, 1)); guard += 1) {
      if (complete() || collected.size >= maxStreams) break;
      const next = await get(style.query(offset)).catch(() => null);
      if (!next || next.streams.length === 0) break;

      let added = 0;
      for (const s of next.streams) {
        if (collected.has(s.name)) continue;
        collected.set(s.name, s);
        added += 1;
      }
      if (added === 0) break;
      offset += next.streams.length;
    }
    break;
  }

  return [...collected.values()];
}

/**
 * Creates or updates a stream. Flussonic treats PUT as an upsert of the stream config,
 * so this is safe to call repeatedly (it is how we re-sync a channel).
 */
export async function upsertStream(server, { name, sourceUrl, title, logo, enabled = true }) {
  const http = client(server);
  const body = {
    name,
    inputs: [{ url: sourceUrl }],
    disabled: !enabled,
  };
  if (title || logo) {
    body.meta = {};
    if (title) body.meta.title = title;
    if (logo) body.meta.logo = logo;
  }

  const res = await http.put(`/streamer/api/v3/streams/${encodeURIComponent(name)}`, body, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (res.status >= 200 && res.status < 300) return { ok: true, data: res.data };
  if (res.status === 401 || res.status === 403) {
    throw new Error('Authentication failed — check the API user and password');
  }
  if (res.status === 404) {
    throw new Error('Endpoint /streamer/api/v3/streams not found — this Flussonic is too old for API v3');
  }
  const detail = typeof res.data === 'string' ? res.data.slice(0, 200) : JSON.stringify(res.data ?? {}).slice(0, 200);
  throw new Error(`Flussonic rejected the stream config (HTTP ${res.status}): ${detail}`);
}

/** Full configuration of one stream, used when the list view omits the source. */
export async function getStream(server, name) {
  const http = client(server);
  const res = await http.get(`/streamer/api/v3/streams/${encodeURIComponent(name)}`);
  if (res.status < 200 || res.status >= 300) return null;
  const [normalized] = normalizeStreamList([{ name, ...(res.data || {}) }]);
  return normalized ?? null;
}

/** Removes a stream. A 404 is treated as success — the end state is what we wanted. */
export async function deleteStream(server, name) {
  const http = client(server);
  const res = await http.delete(`/streamer/api/v3/streams/${encodeURIComponent(name)}`);
  if ((res.status >= 200 && res.status < 300) || res.status === 404) return { ok: true };
  if (res.status === 401 || res.status === 403) {
    throw new Error('Authentication failed — check the API user and password');
  }
  throw new Error(`Failed to delete stream (HTTP ${res.status})`);
}

/** Playback URLs for a channel on a given server. */
export function playbackUrls(server, channelName, token) {
  const host = server.playbackDomain || `${server.host}${server.port ? `:${server.port}` : ''}`;
  const scheme = server.protocol || 'http';
  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  const name = encodeURIComponent(channelName);
  return {
    hls: `${scheme}://${host}/${name}/index.m3u8${qs}`,
    dash: `${scheme}://${host}/${name}/index.mpd${qs}`,
    mpegts: `${scheme}://${host}/${name}/mpegts${qs}`,
    embed: `${scheme}://${host}/${name}/embed.html${qs}`,
  };
}

/** Tries each candidate with the given method; returns the first 2xx. */
async function probeWrite(http, method, paths) {
  const errors = [];
  for (const path of paths) {
    let res;
    try {
      res = await http.request({ method, url: path });
    } catch (err) {
      errors.push(`${path}: ${describeError(err)}`);
      continue;
    }
    if (res.status >= 200 && res.status < 300) return { path, data: res.data };
    if (res.status === 401 || res.status === 403) {
      throw new Error('Authentication failed — check the API user and password');
    }
    errors.push(`${path}: HTTP ${res.status}`);
  }
  const err = new Error(`No supported endpoint responded (${errors.join('; ')})`);
  err.probeErrors = errors;
  throw err;
}

/**
 * Restarts a single stream — the safe, useful kind of restart. This is what you
 * want for a channel stuck on "tcp_closed" or a frozen input.
 */
export async function restartStream(server, name) {
  const http = client(server);
  const n = encodeURIComponent(name);
  return probeWrite(http, 'POST', [
    `/streamer/api/v3/streams/${n}/restart`,
    `/streamer/api/v3/streams/${n}/actions/restart`,
    `/flussonic/api/restart_stream/${n}`,
  ]);
}

/** Restarts every stream that is currently in a dead state. */
export async function restartDeadStreams(server) {
  const streams = await listStreams(server);
  const dead = streams.filter((s) => !s.alive);
  const results = { attempted: dead.length, restarted: 0, failed: [] };

  // Sequential on purpose: firing 100 restarts at once can knock a busy box over.
  for (const stream of dead) {
    try {
      await restartStream(server, stream.name);
      results.restarted += 1;
    } catch (err) {
      results.failed.push({ name: stream.name, error: err.message });
    }
  }
  return results;
}

/** Asks Flussonic to re-read its configuration. Does not interrupt playback. */
export async function reloadConfig(server) {
  const http = client(server);
  return probeWrite(http, 'POST', [
    '/streamer/api/v3/config/reload',
    '/streamer/api/v3/reload',
    '/flussonic/api/reload',
  ]);
}

/**
 * Raw diagnostic dump: which endpoints answer, and what one stream object
 * actually looks like. Used to map fields for a Flussonic version we have not
 * seen, without guessing.
 */
export async function inspect(server) {
  const http = client(server);
  const out = { baseUrl: baseUrl(server), probes: [], sampleStream: null, sampleHealth: null };

  const candidates = [
    ...STREAM_LIST_PATHS.map((p) => `${p}?limit=1`),
    ...STATUS_PATHS,
    ...METRICS_PATHS,
    '/streamer/api/v3/monitoring/readiness',
    '/streamer/api/v3/monitoring/liveness',
    '/streamer/api/v3/schema',
    '/streamer/api/v3/sessions?limit=1',
  ];

  for (const path of candidates) {
    try {
      const res = await http.get(path);
      out.probes.push({ path, status: res.status });
      if (path.includes('schema') && res.status === 200 && res.data?.paths) {
        out.schemaPaths = Object.keys(res.data.paths)
          .filter((p) => res.data.paths[p]?.get && !p.includes('{'))
          .sort();
      }
      if (res.status >= 200 && res.status < 300) {
        if (path.includes('/streams') && !out.sampleStream) {
          const list = Array.isArray(res.data?.streams) ? res.data.streams : Array.isArray(res.data) ? res.data : [];
          out.sampleStream = list[0] ?? null;
        } else if (path.includes('/sessions') && !out.sampleSession) {
          const list = Array.isArray(res.data?.sessions) ? res.data.sessions : Array.isArray(res.data) ? res.data : [];
          out.sampleSession = list[0] ?? null;
        } else if (path.includes('metrics') && !out.sampleMetrics) {
          out.sampleMetrics = typeof res.data === 'string' ? res.data.slice(0, 4000) : null;
        } else if (!path.includes('schema') && !path.includes('/streams') && !out.sampleHealth) {
          out.sampleHealth = res.data;
        }
      }
    } catch (err) {
      out.probes.push({ path, status: null, error: describeError(err) });
    }
  }
  return out;
}
