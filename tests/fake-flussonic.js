import express from 'express';

/**
 * Stand-in for a real Flussonic Media Server. Implements the subset of the
 * API v3 surface the panel uses, with the same auth model (HTTP Basic).
 */
export function startFakeFlussonic({ user = 'admin', password = 'secret' } = {}) {
  const app = express();
  app.use(express.json());

  const streams = new Map();
  const calls = [];

  app.use((req, res, next) => {
    calls.push({ method: req.method, path: req.path });
    const header = req.headers.authorization || '';
    if (!header.startsWith('Basic ')) return res.status(401).json({ error: 'unauthorized' });
    const [u, p] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
    if (u !== user || p !== password) return res.status(401).json({ error: 'unauthorized' });
    return next();
  });

  app.get('/streamer/api/v3/system/status', (req, res) => {
    res.json({
      version: '24.09',
      uptime: 123456,
      cpu_usage: 41.5,
      total_memory: 8 * 1024 ** 3,
      free_memory: 3 * 1024 ** 3,
      total_disk: 500 * 1024 ** 3,
      free_disk: 200 * 1024 ** 3,
      total_input_bitrate: 78_000_000,
      total_output_bitrate: 50_000_000,
      total_clients: 21,
    });
  });

  app.get('/streamer/api/v3/streams', (req, res) => {
    res.json({
      streams: [...streams.entries()].map(([name, cfg]) => ({
        name,
        alive: !cfg.disabled,
        stats: { clients: 3, input_bitrate: 4_000_000 },
      })),
    });
  });

  // Real viewer sessions, as Flussonic reports them (bitrate in kbit/s).
  app.get('/streamer/api/v3/sessions', (req, res) => {
    res.json({
      sessions: [
        { name: 'btv_hd', ip: '10.0.0.1', proto: 'hls', bitrate: 2200, type: 'client' },
        { name: 'btv_hd', ip: '10.0.0.2', proto: 'hls', bitrate: 2200, type: 'client' },
        { name: 'btv_hd', ip: '10.0.0.9', proto: 'rtmp', bitrate: 9000, type: 'publish' },
      ],
    });
  });

  app.put('/streamer/api/v3/streams/:name', (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.inputs) || body.inputs.length === 0 || !body.inputs[0].url) {
      return res.status(400).json({ error: 'inputs[0].url is required' });
    }
    if (body.inputs[0].url.includes('bad-source')) {
      return res.status(422).json({ error: 'unsupported source' });
    }
    streams.set(req.params.name, body);
    return res.status(200).json({ name: req.params.name, ...body });
  });

  app.delete('/streamer/api/v3/streams/:name', (req, res) => {
    if (!streams.has(req.params.name)) return res.status(404).json({ error: 'not found' });
    streams.delete(req.params.name);
    return res.status(204).end();
  });

  app.use((req, res) => res.status(404).json({ error: 'no such endpoint' }));

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        host: '127.0.0.1',
        streams,
        calls,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/** A server that only speaks the legacy endpoint, to exercise the fallback probe. */
/**
 * A server where every known status path 404s, but which publishes an OpenAPI
 * schema pointing at an unusual one. Exercises schema-based discovery.
 */
export function startSchemaOnlyFlussonic({ user = 'admin', password = 'secret' } = {}) {
  const app = express();
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [u, p] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
    if (u !== user || p !== password) return res.status(401).json({ error: 'unauthorized' });
    return next();
  });
  app.get('/streamer/api/v3/streams', (req, res) => res.json({ streams: [{ name: 'x', alive: true }] }));
  app.get('/streamer/api/v3/schema', (req, res) =>
    res.json({
      paths: {
        '/streamer/api/v3/streams': { get: {} },
        '/streamer/api/v3/streams/{name}': { get: {} },
        '/streamer/api/v3/weird_system_stats': { get: {} },
      },
    })
  );
  app.get('/streamer/api/v3/weird_system_stats', (req, res) =>
    res.json({ cpu_usage: 12, total_memory: 100, free_memory: 40, total_clients: 7 })
  );
  app.use((req, res) => res.status(404).json({ error: 'no such endpoint' }));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () =>
      resolve({ port: server.address().port, host: '127.0.0.1', close: () => new Promise((r) => server.close(r)) })
    );
  });
}

/** A server that answers ONLY the stream list — no health metrics at all. */
export function startStreamsOnlyFlussonic({ user = 'admin', password = 'secret' } = {}) {
  const app = express();
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [u, p] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
    if (u !== user || p !== password) return res.status(401).json({ error: 'unauthorized' });
    return next();
  });
  app.get('/streamer/api/v3/streams', (req, res) =>
    res.json({ streams: [{ name: 'a', alive: true, stats: { clients: 2 } }, { name: 'b', alive: false }] })
  );
  app.use((req, res) => res.status(404).json({ error: 'no such endpoint' }));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () =>
      resolve({ port: server.address().port, host: '127.0.0.1', close: () => new Promise((r) => server.close(r)) })
    );
  });
}

/**
 * A big server: 450 streams, real pagination with a 100-item cap, viewer counts
 * and bitrates. Mirrors a production box with hundreds of channels.
 */
/**
 * Mimics Flussonic 24.03 as reported in the field: every documented status path
 * 404s, but the Admin UI still shows uptime — so the data lives behind a path we
 * would never guess. Only content-based discovery can find it.
 */
export function startUnguessableFlussonic({ user = 'admin', password = 'secret' } = {}) {
  const app = express();
  let schemaHits = 0;
  let healthHits = 0;

  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [u, p] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
    if (u !== user || p !== password) return res.status(401).json({ error: 'unauthorized' });
    return next();
  });

  app.get('/streamer/api/v3/streams', (req, res) =>
    res.json({ streams: [{ name: 'a', alive: true, stats: { clients: 3, input_bitrate: 2_000_000 } }] })
  );

  app.get('/streamer/api/v3/schema', (req, res) => {
    schemaHits += 1;
    res.json({
      paths: {
        '/streamer/api/v3/streams': { get: {} },
        '/streamer/api/v3/sessions': { get: {} },
        '/streamer/api/v3/dvr/ranges': { get: {} },
        '/streamer/api/v3/qwerty': { get: {} },
        '/streamer/api/v3/zzz_overview': { get: {} },
      },
    });
  });

  // Decoy: valid JSON, no health signals.
  app.get('/streamer/api/v3/qwerty', (req, res) => res.json({ hello: 'world', items: [1, 2, 3] }));

  // The real one, behind a name nothing would guess.
  app.get('/streamer/api/v3/zzz_overview', (req, res) => {
    healthHits += 1;
    res.json({
      uptime: 2_900_100,
      cpu_usage: 37,
      total_memory: 16 * 1024 ** 3,
      free_memory: 6 * 1024 ** 3,
      total_disk: 900 * 1024 ** 3,
      free_disk: 300 * 1024 ** 3,
      total_clients: 61,
      total_input_bitrate: 338_000_000,
      total_output_bitrate: 203_000_000,
      version: '24.03',
    });
  });

  app.use((req, res) => res.status(404).json({ error: 'no such endpoint' }));

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () =>
      resolve({
        port: server.address().port,
        host: '127.0.0.1',
        get schemaHits() { return schemaHits; },
        get healthHits() { return healthHits; },
        close: () => new Promise((r) => server.close(r)),
      })
    );
  });
}

export function startBigFlussonic({ user = 'admin', password = 'secret', total = 450 } = {}) {
  const app = express();
  app.use(express.json());
  const restarted = [];
  const all = Array.from({ length: total }, (_, i) => ({
    name: `ch${String(i + 1).padStart(3, '0')}`,
    alive: i % 10 !== 0, // every 10th stream is dead
    stats: { clients: i % 7, input_bitrate: 2_000_000 + i * 1000 },
  }));

  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [u, p] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
    if (u !== user || p !== password) return res.status(401).json({ error: 'unauthorized' });
    return next();
  });

  app.get('/streamer/api/v3/streams', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 100); // server-side cap
    const offset = Number(req.query.offset) || 0;
    res.json({ streams: all.slice(offset, offset + limit), estimated_count: all.length });
  });

  app.post('/streamer/api/v3/streams/:name/restart', (req, res) => {
    const stream = all.find((s) => s.name === req.params.name);
    if (!stream) return res.status(404).json({ error: 'not found' });
    stream.alive = true;
    restarted.push(req.params.name);
    return res.status(200).json({ ok: true });
  });

  app.use((req, res) => res.status(404).json({ error: 'no such endpoint' }));

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () =>
      resolve({
        port: server.address().port,
        host: '127.0.0.1',
        total,
        restarted,
        close: () => new Promise((r) => server.close(r)),
      })
    );
  });
}

/**
 * Reproduces the Cs2 box: 365 streams, responses capped at 200, and the paging
 * parameter is configurable so we can prove the panel adapts instead of assuming.
 *
 *   paging: 'offset' | 'skip' | 'from' | 'page' | 'none'
 */
export function startCappedFlussonic({
  user = 'admin',
  password = 'secret',
  total = 365,
  cap = 200,
  paging = 'offset',
  advertiseTotal = true,
} = {}) {
  const app = express();
  const all = Array.from({ length: total }, (_, i) => ({
    name: `s${String(i + 1).padStart(4, '0')}`,
    alive: i < 232,
    stats: { clients: i < 7 ? 1 : 0, input_bitrate: 2887 },
  }));

  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [u, p] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
    if (u !== user || p !== password) return res.status(401).json({ error: 'unauthorized' });
    return next();
  });

  app.get('/streamer/api/v3/streams', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || cap, cap);
    let start = 0;
    if (paging === 'offset') start = Number(req.query.offset) || 0;
    else if (paging === 'skip') start = Number(req.query.skip) || 0;
    else if (paging === 'from') start = Number(req.query.from) || 0;
    else if (paging === 'page') start = ((Number(req.query.page) || 1) - 1) * limit;
    // 'none' -> always the first slice, whatever is asked

    res.json({
      streams: all.slice(start, start + limit),
      ...(advertiseTotal ? { estimated_count: total } : {}),
    });
  });

  app.use((req, res) => res.status(404).json({ error: 'no such endpoint' }));

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () =>
      resolve({ port: server.address().port, host: '127.0.0.1', total, close: () => new Promise((r) => server.close(r)) })
    );
  });
}

export function startLegacyFlussonic({ user = 'admin', password = 'secret' } = {}) {
  const app = express();
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [u, p] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
    if (u !== user || p !== password) return res.status(401).json({ error: 'unauthorized' });
    return next();
  });
  app.get('/flussonic/api/server', (req, res) => {
    res.json({ total_clients: 5, streams_count: 2, uptime: 60 });
  });
  app.use((req, res) => res.status(404).json({ error: 'no such endpoint' }));

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        host: '127.0.0.1',
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/**
 * A busy production box: 366 streams, slow to answer, and it refuses to serve
 * enormous pages. Exactly the conditions that made a working panel report
 * "Connection timed out".
 */
export function startSlowFlussonic({
  user = 'admin',
  password = 'secret',
  total = 366,
  cap = 200,
  delayMs = 1200,
  maxAcceptedLimit = 1000,
  concurrencyLimit = 3,
} = {}) {
  const app = express();
  let inFlight = 0;
  let maxSeen = 0;
  let rejected = 0;
  const all = Array.from({ length: total }, (_, i) => ({
    name: `s${String(i + 1).padStart(4, '0')}`,
    alive: i < 238,
    stats: { clients: i < 8 ? 1 : 0, input_bitrate: 2887 },
  }));

  app.use(async (req, res, next) => {
    const header = req.headers.authorization || '';
    const [u, p] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
    if (u !== user || p !== password) return res.status(401).json({ error: 'unauthorized' });

    inFlight += 1;
    maxSeen = Math.max(maxSeen, inFlight);
    if (inFlight > concurrencyLimit) {
      rejected += 1;
      inFlight -= 1;
      return res.status(503).json({ error: 'too many requests' });
    }
    await new Promise((r) => setTimeout(r, delayMs));
    res.on('finish', () => {
      inFlight -= 1;
    });
    return next();
  });

  app.get('/streamer/api/v3/streams', (req, res) => {
    const asked = Number(req.query.limit) || cap;
    // A real server will not hand over an unbounded page.
    if (asked > maxAcceptedLimit) return res.status(400).json({ error: 'limit too large' });
    const limit = Math.min(asked, cap);
    const start = Number(req.query.offset) || 0;
    res.json({ streams: all.slice(start, start + limit), estimated_count: total });
  });

  app.get('/streamer/api/v3/sessions', (req, res) => {
    const asked = Number(req.query.limit) || 100;
    if (asked > maxAcceptedLimit) return res.status(400).json({ error: 'limit too large' });
    res.json({ sessions: Array.from({ length: 8 }, (_, i) => ({ name: `s000${i}`, bitrate: 2887, type: 'client' })) });
  });

  app.use((req, res) => res.status(404).json({ error: 'no such endpoint' }));

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () =>
      resolve({
        port: server.address().port,
        host: '127.0.0.1',
        total,
        get maxConcurrent() { return maxSeen; },
        get rejected() { return rejected; },
        close: () => new Promise((r) => server.close(r)),
      })
    );
  });
}

/**
 * A server with no REST status endpoint at all, but which publishes Prometheus
 * metrics — the shape we expect on Flussonic 24.x where CPU/RAM/uptime are
 * absent from the JSON API.
 */
export function startMetricsFlussonic({ user = 'admin', password = 'secret', cpuSeconds = 4000 } = {}) {
  const app = express();
  let cpu = cpuSeconds;

  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [u, p] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
    if (u !== user || p !== password) return res.status(401).json({ error: 'unauthorized' });
    return next();
  });

  app.get('/streamer/api/v3/streams', (req, res) =>
    res.json({ streams: [{ name: 'a', alive: true, stats: { clients: 2, input_bitrate: 2500 } }] })
  );
  app.get('/streamer/api/v3/sessions', (req, res) =>
    res.json({ sessions: [{ name: 'a', type: 'client' }, { name: 'a', type: 'client' }] })
  );

  app.get('/streamer/api/v3/metrics', (req, res) => {
    res
      .type('text/plain')
      .send(
        [
          '# HELP process_resident_memory_bytes Resident memory',
          '# TYPE process_resident_memory_bytes gauge',
          'process_resident_memory_bytes 5368709120',
          'node_memory_MemTotal_bytes 17179869184',
          'node_filesystem_size_bytes{mount="/"} 966367641600',
          'node_filesystem_avail_bytes{mount="/"} 322122547200',
          'process_uptime_seconds 3013353',
          `process_cpu_seconds_total ${cpu}`,
          'machine_cpu_cores 8',
          'flussonic_stream_alive{stream="a"} 1',
        ].join('\n')
      );
    cpu += 40; // 8 cores busy at 50% between polls
  });

  app.use((req, res) => res.status(404).json({ error: 'no such endpoint' }));

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () =>
      resolve({ port: server.address().port, host: '127.0.0.1', close: () => new Promise((r) => server.close(r)) })
    );
  });
}
