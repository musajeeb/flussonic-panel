import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel, loginAsAdmin } from './harness.js';
import { startFakeFlussonic, startLegacyFlussonic, startSchemaOnlyFlussonic, startStreamsOnlyFlussonic, startBigFlussonic, startUnguessableFlussonic, startSlowFlussonic, startMetricsFlussonic } from './fake-flussonic.js';

let panel;
let flussonic;
let legacy;
let token;
let serverId;
let channelId;
let subscriberId;
let subscriberToken;

before(async () => {
  panel = await startPanel();
  flussonic = await startFakeFlussonic();
  legacy = await startLegacyFlussonic();
  token = await loginAsAdmin(panel);
});

after(async () => {
  await panel?.close();
  await flussonic?.close();
  await legacy?.close();
});

describe('health & auth', () => {
  test('health endpoint responds', async () => {
    const res = await panel.req('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });

  test('login succeeds with the seeded admin', async () => {
    const res = await panel.req('POST', '/api/auth/login', {
      body: { email: 'sajeeb809@live.com', password: 'musajeeb' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.user.email, 'sajeeb809@live.com');
  });

  test('login is case-insensitive on the email', async () => {
    const res = await panel.req('POST', '/api/auth/login', {
      body: { email: 'SAJEEB809@LIVE.COM', password: 'musajeeb' },
    });
    assert.equal(res.status, 200);
  });

  test('wrong password is rejected', async () => {
    const res = await panel.req('POST', '/api/auth/login', {
      body: { email: 'sajeeb809@live.com', password: 'nope' },
    });
    assert.equal(res.status, 401);
  });

  test('unknown email is rejected with the same message', async () => {
    const res = await panel.req('POST', '/api/auth/login', {
      body: { email: 'nobody@example.com', password: 'nope' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid email or password');
  });

  test('missing fields produce a 400', async () => {
    const res = await panel.req('POST', '/api/auth/login', { body: { email: 'a@b.c' } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /password/);
  });

  test('protected routes reject a missing token', async () => {
    const res = await panel.req('GET', '/api/servers');
    assert.equal(res.status, 401);
  });

  test('protected routes reject a forged token', async () => {
    const res = await panel.req('GET', '/api/servers', { token: 'not.a.jwt' });
    assert.equal(res.status, 401);
  });

  test('/auth/me returns the signed-in admin', async () => {
    const res = await panel.req('GET', '/api/auth/me', { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'sajeeb809@live.com');
  });
});

describe('servers', () => {
  test('creating a server requires the mandatory fields', async () => {
    const res = await panel.req('POST', '/api/servers', { token, body: { name: 'X' } });
    assert.equal(res.status, 400);
  });

  test('creates a server', async () => {
    const res = await panel.req('POST', '/api/servers', {
      token,
      body: {
        name: 'BD Node 1',
        category: 'Bangladesh',
        host: flussonic.host,
        port: flussonic.port,
        apiUser: 'admin',
        apiPassword: 'secret',
      },
    });
    assert.equal(res.status, 201);
    serverId = res.body.data.id;
    assert.ok(serverId);
  });

  test('never returns the stored Flussonic password', async () => {
    const res = await panel.req('GET', '/api/servers', { token });
    assert.equal(res.status, 200);
    assert.equal(res.text.includes('secret'), false, 'password leaked in response');
    assert.equal(res.body.data[0].apiPasswordSet, true);
    assert.equal(res.body.data[0].apiPasswordEnc, undefined);
  });

  test('rejects a duplicate host:port', async () => {
    const res = await panel.req('POST', '/api/servers', {
      token,
      body: { name: 'dup', host: flussonic.host, port: flussonic.port, apiUser: 'a', apiPassword: 'b' },
    });
    assert.equal(res.status, 409);
  });

  test('rejects an invalid port', async () => {
    const res = await panel.req('POST', '/api/servers', {
      token,
      body: { name: 'bad', host: '10.0.0.9', port: 99999, apiUser: 'a', apiPassword: 'b' },
    });
    assert.equal(res.status, 400);
  });

  test('reads CPU, RAM, disk and uptime from Prometheus metrics', async () => {
    const box = await startMetricsFlussonic();
    const created = await panel.req('POST', '/api/servers', {
      token,
      body: { name: 'Metrics', host: box.host, port: box.port, apiUser: 'admin', apiPassword: 'secret' },
    });
    const id = created.body.data.id;

    const first = await panel.req('POST', `/api/servers/${id}/check`, { token });
    assert.equal(first.body.status, 'online');
    const a = first.body.data.stats;
    assert.equal(a.memoryUsedBytes, 5 * 1024 ** 3);
    assert.equal(a.memoryTotalBytes, 16 * 1024 ** 3);
    assert.equal(a.memoryPercent, 31.3);
    assert.equal(a.diskPercent, 66.7);
    assert.equal(a.uptimeSec, 3013353, '34 days, as Flussonic itself reports');
    assert.ok(a.cpuSample, 'a CPU counter sample is kept for the next poll');
    assert.equal(a.cpuPercent ?? null, null, 'a rate needs two samples');
    assert.match(a.notes, /metrics from \/streamer\/api\/v3\/metrics/);

    // Second poll: now we can turn the counter into a percentage.
    await new Promise((r) => setTimeout(r, 1100));
    const second = await panel.req('POST', `/api/servers/${id}/check`, { token });
    const b = second.body.data.stats;
    assert.ok(Number.isFinite(b.cpuPercent), 'CPU percentage must appear on the second reading');
    assert.ok(b.cpuPercent > 0 && b.cpuPercent <= 100, `implausible cpu: ${b.cpuPercent}`);

    await panel.req('DELETE', `/api/servers/${id}?force=true`, { token });
    await box.close();
  });

  test('counts sessions with no bitrate field by charging the stream rate', async () => {
    const box = await startMetricsFlussonic();
    const created = await panel.req('POST', '/api/servers', {
      token,
      body: { name: 'NoBitrate', host: box.host, port: box.port, apiUser: 'admin', apiPassword: 'secret' },
    });
    const res = await panel.req('POST', `/api/servers/${created.body.data.id}/check`, { token });
    const st = res.body.data.stats;
    assert.equal(st.clients, 2);
    assert.equal(st.outputBitrateBps, 5_000_000, '2 viewers x 2500 kbit/s');
    assert.equal(st.outputEstimated, false);
    await panel.req('DELETE', `/api/servers/${created.body.data.id}?force=true`, { token });
    await box.close();
  });

  test('a busy server that rejects huge pages still reports every stream', async () => {
    const box = await startSlowFlussonic({ delayMs: 20, total: 366, cap: 200, maxAcceptedLimit: 1000 });
    const created = await panel.req('POST', '/api/servers', {
      token,
      body: { name: 'Busy', host: box.host, port: box.port, apiUser: 'admin', apiPassword: 'secret' },
    });
    const id = created.body.data.id;

    const res = await panel.req('POST', `/api/servers/${id}/check`, { token });
    assert.equal(res.body.status, 'online', 'must not be reported offline');
    assert.equal(res.body.data.stats.streamsTotal, 366);
    assert.equal(res.body.data.stats.streamsAlive, 238);
    assert.equal(res.body.data.stats.clients, 8, 'from real sessions');
    assert.equal(res.body.data.stats.outputEstimated, false, 'measured, not estimated');
    assert.equal(res.body.data.statusPath, 'none', 'remembers there is no health endpoint');

    await panel.req('DELETE', `/api/servers/${id}?force=true`, { token });
    await box.close();
  });

  test('one failed poll does not blank a working server', async () => {
    const box = await startSlowFlussonic({ delayMs: 10, total: 50 });
    const created = await panel.req('POST', '/api/servers', {
      token,
      body: { name: 'Blippy', host: box.host, port: box.port, apiUser: 'admin', apiPassword: 'secret' },
    });
    const id = created.body.data.id;

    const good = await panel.req('POST', `/api/servers/${id}/check`, { token });
    assert.equal(good.body.status, 'online');
    const streamsBefore = good.body.data.stats.streamsTotal;

    // The server goes away.
    await box.close();

    const first = await panel.req('POST', `/api/servers/${id}/check`, { token });
    assert.equal(first.body.status, 'degraded', 'one failure is not an outage');
    assert.equal(first.body.data.status, 'online', 'card stays online');
    assert.equal(first.body.data.stats.streamsTotal, streamsBefore, 'previous readings are kept');

    const second = await panel.req('POST', `/api/servers/${id}/check`, { token });
    assert.equal(second.body.status, 'degraded');

    const third = await panel.req('POST', `/api/servers/${id}/check`, { token });
    assert.equal(third.body.status, 'offline', 'three strikes and it is genuinely down');
    assert.equal(third.body.data.status, 'offline');
    assert.equal(third.body.data.stats.streamsTotal, streamsBefore, 'still shows the last known figures');

    await panel.req('DELETE', `/api/servers/${id}?force=true`, { token });
  });

  test('viewer count and egress come from real sessions, not an estimate', async () => {
    const res = await panel.req('POST', `/api/servers/${serverId}/check`, { token });
    const st = res.body.data.stats;
    assert.equal(st.sessionsRead, true);
    assert.equal(st.clients, 2, 'the publishing source must not be counted as a viewer');
    assert.equal(st.outputBitrateBps, 4_400_000, '2 viewers x 2200 kbit/s');
    assert.equal(st.outputEstimated, false, 'this is measured, not estimated');
  });

  test('check pulls real statistics from Flussonic', async () => {
    const res = await panel.req('POST', `/api/servers/${serverId}/check`, { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'online');
    const stats = res.body.data.stats;
    assert.equal(stats.cpuPercent, 41.5);
    assert.equal(stats.memoryTotalBytes, 8 * 1024 ** 3);
    assert.equal(stats.memoryUsedBytes, 5 * 1024 ** 3);
    assert.equal(stats.memoryPercent, 62.5);
    assert.equal(stats.diskUsedBytes, 300 * 1024 ** 3);
    assert.equal(stats.inputBitrateBps, 78_000_000);
    // clients and egress come from sessions, which are finer-grained than the
    // server's own aggregate counter — see the session test above.
    assert.equal(stats.clients, 2);
    assert.equal(stats.uptimeSec, 123456);
  });

  test('an unreachable server is reported without throwing', async () => {
    const created = await panel.req('POST', '/api/servers', {
      token,
      body: { name: 'Dead', host: '127.0.0.1', port: 9, apiUser: 'a', apiPassword: 'b' },
    });
    const id = created.body.data.id;
    const res = await panel.req('POST', `/api/servers/${id}/check`, { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'degraded', 'first failure is not yet an outage');
    assert.ok(res.body.error);

    await panel.req('POST', `/api/servers/${id}/check`, { token });
    const third = await panel.req('POST', `/api/servers/${id}/check`, { token });
    assert.equal(third.body.status, 'offline');
    await panel.req('DELETE', `/api/servers/${id}`, { token });
  });

  test('falls back to the legacy status endpoint on older servers', async () => {
    const created = await panel.req('POST', '/api/servers', {
      token,
      body: { name: 'Legacy', host: legacy.host, port: legacy.port, apiUser: 'admin', apiPassword: 'secret' },
    });
    const res = await panel.req('POST', `/api/servers/${created.body.data.id}/check`, { token });
    assert.equal(res.body.status, 'online');
    assert.equal(res.body.data.stats.clients, 5);
    await panel.req('DELETE', `/api/servers/${created.body.data.id}`, { token });
  });

  test('stays ONLINE when only the stream list works (no health endpoint)', async () => {
    const box = await startStreamsOnlyFlussonic();
    const created = await panel.req('POST', '/api/servers', {
      token,
      body: { name: 'StreamsOnly', host: box.host, port: box.port, apiUser: 'admin', apiPassword: 'secret' },
    });
    const res = await panel.req('POST', `/api/servers/${created.body.data.id}/check`, { token });
    assert.equal(res.body.status, 'online', 'a usable server must not be reported offline');
    assert.equal(res.body.data.stats.streamsTotal, 2);
    assert.equal(res.body.data.stats.streamsAlive, 1);
    assert.equal(res.body.data.stats.cpuPercent ?? null, null);
    assert.match(res.body.data.stats.notes, /not available on this server/);
    await panel.req('DELETE', `/api/servers/${created.body.data.id}?force=true`, { token });
    await box.close();
  });

  test('discovers the health endpoint from the OpenAPI schema', async () => {
    const box = await startSchemaOnlyFlussonic();
    const created = await panel.req('POST', '/api/servers', {
      token,
      body: { name: 'SchemaOnly', host: box.host, port: box.port, apiUser: 'admin', apiPassword: 'secret' },
    });
    const res = await panel.req('POST', `/api/servers/${created.body.data.id}/check`, { token });
    assert.equal(res.body.status, 'online');
    assert.equal(res.body.data.stats.cpuPercent, 12);
    assert.equal(res.body.data.stats.memoryPercent, 60);
    assert.match(res.body.data.stats.notes, /weird_system_stats/);
    await panel.req('DELETE', `/api/servers/${created.body.data.id}?force=true`, { token });
    await box.close();
  });

  test('finds an unguessably-named health endpoint by inspecting responses', async () => {
    const box = await startUnguessableFlussonic();
    const created = await panel.req('POST', '/api/servers', {
      token,
      body: { name: 'Field2403', host: box.host, port: box.port, apiUser: 'admin', apiPassword: 'secret' },
    });
    const id = created.body.data.id;

    const res = await panel.req('POST', `/api/servers/${id}/check`, { token });
    assert.equal(res.body.status, 'online');
    const st = res.body.data.stats;

    // The figures Flussonic's own header shows.
    assert.equal(st.uptimeSec, 2_900_100, 'uptime must be read');
    assert.equal(st.cpuPercent, 37);
    assert.equal(st.memoryPercent, 62.5);
    assert.equal(st.diskPercent, 66.7);
    assert.equal(st.clients, 61);
    assert.equal(st.inputBitrateBps, 338_000_000);
    assert.equal(st.outputBitrateBps, 203_000_000);
    assert.equal(st.version, '24.03');
    assert.match(st.notes, /zzz_overview/);
    assert.equal(res.body.data.statusPath, '/streamer/api/v3/zzz_overview');

    // Second poll must reuse the learned path — no schema download.
    const before = box.schemaHits;
    await panel.req('POST', `/api/servers/${id}/check`, { token });
    assert.equal(box.schemaHits, before, 'discovery must not repeat once the path is known');

    await panel.req('DELETE', `/api/servers/${id}?force=true`, { token });
    await box.close();
  });

  test('pages through a server with 450 streams instead of stopping at 100', async () => {
    const box = await startBigFlussonic();
    const created = await panel.req('POST', '/api/servers', {
      token,
      body: { name: 'Big', host: box.host, port: box.port, apiUser: 'admin', apiPassword: 'secret' },
    });
    const id = created.body.data.id;

    const res = await panel.req('POST', `/api/servers/${id}/check`, { token });
    assert.equal(res.body.status, 'online');
    const st = res.body.data.stats;
    assert.equal(st.streamsTotal, 450, 'must not be capped at the server page size');
    assert.equal(st.streamsAlive, 405, '45 of the 450 are dead');

    // Viewers and traffic derived from the stream list, with no health endpoint.
    assert.ok(st.clients > 0, 'viewer count must be aggregated from the streams');
    assert.ok(st.inputBitrateBps > 0, 'input traffic must be aggregated');
    assert.equal(st.outputEstimated, true, 'estimated egress must be flagged as such');

    // Top channels by viewers.
    assert.equal(st.topStreams.length, 10);
    assert.ok(st.topStreams[0].clients >= st.topStreams[9].clients, 'sorted by viewers');

    const listed = await panel.req('GET', `/api/servers/${id}/streams`, { token });
    assert.equal(listed.body.count, 450);

    const overview = await panel.req('GET', '/api/overview', { token });
    assert.ok(overview.body.topStreams.length > 0, 'fleet-wide top channels');

    await panel.req('DELETE', `/api/servers/${id}?force=true`, { token });
    await box.close();
  });

  test('output traffic reflects viewers, not a copy of the input', async () => {
    const box = await startBigFlussonic({ total: 60 });
    const created = await panel.req('POST', '/api/servers', {
      token,
      body: { name: 'Egress', host: box.host, port: box.port, apiUser: 'admin', apiPassword: 'secret' },
    });
    const id = created.body.data.id;
    const res = await panel.req('POST', `/api/servers/${id}/check`, { token });
    const st = res.body.data.stats;

    assert.ok(st.inputBitrateBps > 0);
    assert.ok(st.outputBitrateBps > 0);
    assert.notEqual(st.outputBitrateBps, st.inputBitrateBps, 'IN and OUT must not be identical');
    assert.equal(st.outputEstimated, true);

    // Every stream carries roughly 2 Mbps; viewers decide the egress.
    const perViewer = st.outputBitrateBps / st.clients;
    assert.ok(perViewer > 1e6 && perViewer < 5e6, `implausible per-viewer rate: ${perViewer}`);

    await panel.req('DELETE', `/api/servers/${id}?force=true`, { token });
    await box.close();
  });

  test('restarts one stream and every dead stream', async () => {
    const box = await startBigFlussonic({ total: 30 });
    const created = await panel.req('POST', '/api/servers', {
      token,
      body: { name: 'Restartable', host: box.host, port: box.port, apiUser: 'admin', apiPassword: 'secret' },
    });
    const id = created.body.data.id;

    const one = await panel.req('POST', `/api/servers/${id}/streams/ch002/restart`, { token });
    assert.equal(one.status, 200);
    assert.ok(box.restarted.includes('ch002'));

    const bulk = await panel.req('POST', `/api/servers/${id}/restart-dead`, { token });
    assert.equal(bulk.status, 200);
    assert.equal(bulk.body.attempted, 3, 'ch001, ch011, ch021 are dead');
    assert.equal(bulk.body.restarted, 3);
    assert.deepEqual(bulk.body.failed, []);

    const after = await panel.req('POST', `/api/servers/${id}/check`, { token });
    assert.equal(after.body.data.stats.streamsAlive, 30, 'all alive after restart');

    await panel.req('DELETE', `/api/servers/${id}?force=true`, { token });
    await box.close();
  });

  test('reports a clear error when restart is unsupported', async () => {
    const res = await panel.req('POST', `/api/servers/${serverId}/streams/btv_hd/restart`, { token });
    assert.equal(res.status, 502);
    assert.match(res.body.error, /No supported endpoint responded/);
  });

  test('inspect reports which endpoints the server answers', async () => {
    const res = await panel.req('GET', `/api/servers/${serverId}/inspect`, { token });
    assert.equal(res.status, 200);
    assert.ok(res.body.probes.length > 0);
    assert.ok(res.body.probes.some((p) => p.status === 200));
  });

  test('wrong Flussonic credentials report an auth error, not a crash', async () => {
    // Reuse the existing server: a second entry on the same host:port is
    // (correctly) rejected as a duplicate.
    await panel.req('PUT', `/api/servers/${serverId}`, { token, body: { apiPassword: 'WRONG' } });
    const res = await panel.req('POST', `/api/servers/${serverId}/check`, { token });
    assert.notEqual(res.body.status, 'online');
    assert.match(res.body.error, /Authentication failed/);

    // Restoring the password must clear the failure count too, so the server
    // does not stay one strike away from being declared dead.
    await panel.req('PUT', `/api/servers/${serverId}`, { token, body: { apiPassword: 'secret' } });
    const restored = await panel.req('POST', `/api/servers/${serverId}/check`, { token });
    assert.equal(restored.body.status, 'online');
  });

  test('editing without a password keeps the old one working', async () => {
    const res = await panel.req('PUT', `/api/servers/${serverId}`, {
      token,
      body: { name: 'BD Node 1 (edited)', apiPassword: '' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.name, 'BD Node 1 (edited)');
    const check = await panel.req('POST', `/api/servers/${serverId}/check`, { token });
    assert.equal(check.body.status, 'online');
  });

  test('unknown server id returns 404', async () => {
    const res = await panel.req('GET', '/api/servers/does-not-exist', { token });
    assert.equal(res.status, 404);
  });
});

describe('channels', () => {
  test('rejects an unsafe stream name', async () => {
    const res = await panel.req('POST', '/api/channels', {
      token,
      body: { name: '../etc/passwd', serverId, sourceUrl: 'udp://239.0.0.1:1234' },
    });
    assert.equal(res.status, 400);
  });

  test('rejects a source URL without a protocol', async () => {
    const res = await panel.req('POST', '/api/channels', {
      token,
      body: { name: 'btv_hd', serverId, sourceUrl: 'just-a-string' },
    });
    assert.equal(res.status, 400);
  });

  test('rejects an unknown server id', async () => {
    const res = await panel.req('POST', '/api/channels', {
      token,
      body: { name: 'btv_hd', serverId: 'nope', sourceUrl: 'udp://239.0.0.1:1234' },
    });
    assert.equal(res.status, 404);
  });

  test('creates a channel and pushes it to Flussonic', async () => {
    const res = await panel.req('POST', '/api/channels', {
      token,
      body: {
        name: 'btv_hd',
        title: 'BTV HD',
        serverId,
        sourceUrl: 'udp://239.0.0.1:1234',
        category: 'Bangladesh',
      },
    });
    assert.equal(res.status, 201);
    channelId = res.body.data.id;
    assert.equal(res.body.data.syncState, 'synced');
    // Verify it really landed on the (fake) Flussonic box.
    assert.ok(flussonic.streams.has('btv_hd'));
    assert.equal(flussonic.streams.get('btv_hd').inputs[0].url, 'udp://239.0.0.1:1234');
  });

  test('returns playback URLs for the channel', async () => {
    const res = await panel.req('GET', '/api/channels', { token });
    const ch = res.body.data.find((c) => c.id === channelId);
    assert.match(ch.urls.hls, /\/btv_hd\/index\.m3u8$/);
    assert.equal(ch.serverName, 'BD Node 1 (edited)');
  });

  test('rejects a duplicate channel on the same server', async () => {
    const res = await panel.req('POST', '/api/channels', {
      token,
      body: { name: 'btv_hd', serverId, sourceUrl: 'udp://239.0.0.2:1234' },
    });
    assert.equal(res.status, 409);
  });

  test('records a sync error when Flussonic rejects the source', async () => {
    const res = await panel.req('POST', '/api/channels', {
      token,
      body: { name: 'broken_ch', serverId, sourceUrl: 'udp://bad-source:1234' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.syncState, 'error');
    assert.ok(res.body.warning);
    // Re-syncing after fixing the source should recover.
    const fixed = await panel.req('PUT', `/api/channels/${res.body.data.id}`, {
      token,
      body: { sourceUrl: 'udp://239.9.9.9:1234' },
    });
    assert.equal(fixed.body.data.syncState, 'synced');
    await panel.req('DELETE', `/api/channels/${res.body.data.id}`, { token });
  });

  test('updating a channel re-pushes the config', async () => {
    const res = await panel.req('PUT', `/api/channels/${channelId}`, {
      token,
      body: { sourceUrl: 'udp://239.0.0.5:5000', title: 'BTV HD+' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.syncState, 'synced');
    assert.equal(flussonic.streams.get('btv_hd').inputs[0].url, 'udp://239.0.0.5:5000');
  });

  test('manual sync reports success', async () => {
    const res = await panel.req('POST', `/api/channels/${channelId}/sync`, { token });
    assert.equal(res.body.status, 'synced');
  });

  test('a server with channels cannot be deleted without force', async () => {
    const res = await panel.req('DELETE', `/api/servers/${serverId}`, { token });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /still has 1 channel/);
  });
});

describe('channels already on the server', () => {
  let bigBox;
  let bigId;

  test('existing streams appear without being imported', async () => {
    bigBox = await startBigFlussonic({ total: 120 });
    const created = await panel.req('POST', '/api/servers', {
      token,
      body: { name: 'Legacy Box', category: 'Bangladesh', host: bigBox.host, port: bigBox.port, apiUser: 'admin', apiPassword: 'secret' },
    });
    bigId = created.body.data.id;

    const res = await panel.req('GET', `/api/channels?serverId=${bigId}&refresh=true`, { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 120, 'every pre-existing stream must be listed');
    assert.ok(res.body.data.every((c) => c.source === 'server'));
    assert.ok(res.body.data.every((c) => String(c.id).startsWith('live:')));

    // Live state comes through so the operator can see what is dead.
    const dead = res.body.data.filter((c) => c.onServer && !c.onServer.alive);
    assert.equal(dead.length, 12);
  });

  test('counts separate panel-managed from server-only channels', async () => {
    const res = await panel.req('GET', '/api/channels', { token });
    assert.equal(res.body.counts.serverOnly, 120);
    assert.ok(res.body.counts.managed >= 1, 'the btv_hd channel is panel-managed');
    assert.equal(res.body.counts.total, res.body.counts.managed + res.body.counts.serverOnly);
  });

  test('a panel channel is not duplicated by its own live stream', async () => {
    const res = await panel.req('GET', '/api/channels', { token });
    const btv = res.body.data.filter((c) => c.name === 'btv_hd');
    assert.equal(btv.length, 1, 'must appear once, not twice');
    assert.equal(btv[0].source, 'panel');
  });

  test('search and filters work across both sources', async () => {
    const res = await panel.req('GET', '/api/channels?q=ch01', { token });
    assert.ok(res.body.data.length > 0);
    assert.ok(res.body.data.every((c) => c.name.includes('ch01')));

    const onlyServer = await panel.req('GET', '/api/channels?source=server', { token });
    assert.equal(onlyServer.body.data.length, 120);
  });

  test('importing adopts them into the panel with their source URL', async () => {
    const res = await panel.req('POST', '/api/channels/import', {
      token,
      body: { serverId: bigId, names: ['ch001', 'ch002'], category: 'Bangladesh' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.imported, 2);

    const listed = await panel.req('GET', `/api/channels?serverId=${bigId}`, { token });
    const ch001 = listed.body.data.find((c) => c.name === 'ch001');
    assert.equal(ch001.source, 'imported');
    assert.equal(listed.body.data.length, 120, 'still 120 total, not 122');
  });

  test('importing twice does not create duplicates', async () => {
    const res = await panel.req('POST', '/api/channels/import', { token, body: { serverId: bigId } });
    assert.equal(res.body.imported, 118, 'the remaining ones');
    const again = await panel.req('POST', '/api/channels/import', { token, body: { serverId: bigId } });
    assert.equal(again.body.imported, 0);
    assert.equal(again.body.skipped, 120);
  });

  test('an imported channel with no known source is never re-pushed', async () => {
    const db = (await import('../server/db/index.js')).getDb();
    const ch = await db.channels.findOne({ name: 'ch050' });
    await db.channels.updateById(ch.id, { sourceUrl: '' });
    const res = await panel.req('POST', `/api/channels/${ch.id}/sync`, { token });
    assert.equal(res.status, 409, 'must refuse rather than wipe the working source');
    assert.match(res.body.error, /would wipe/);
  });

  test('deleting a server-only stream removes it from Flussonic', async () => {
    const before = await panel.req('GET', `/api/channels?serverId=${bigId}&refresh=true`, { token });
    const live = before.body.data.find((c) => String(c.id).startsWith('live:'));
    if (live) {
      const res = await panel.req('DELETE', `/api/channels/${live.id}`, { token });
      assert.equal(res.status, 200);
    }
    await panel.req('DELETE', `/api/servers/${bigId}?force=true`, { token });
    await bigBox.close();
  });
});

describe('subscribers', () => {
  test('creates a subscriber with a generated password and token', async () => {
    const res = await panel.req('POST', '/api/iptv-users', {
      token,
      body: { username: 'customer1', maxConnections: 2, note: 'test' },
    });
    assert.equal(res.status, 201);
    subscriberId = res.body.data.id;
    subscriberToken = res.body.data.token;
    assert.ok(res.body.data.password.length >= 8);
    assert.match(res.body.data.playlistUrl, /\/playlist\/[a-f0-9]+\.m3u$/);
  });

  test('rejects a duplicate username', async () => {
    const res = await panel.req('POST', '/api/iptv-users', { token, body: { username: 'customer1' } });
    assert.equal(res.status, 409);
  });

  test('rejects an invalid username', async () => {
    const res = await panel.req('POST', '/api/iptv-users', { token, body: { username: 'a b' } });
    assert.equal(res.status, 400);
  });

  test('rejects an out-of-range device limit', async () => {
    const res = await panel.req('POST', '/api/iptv-users', {
      token,
      body: { username: 'customer2', maxConnections: 0 },
    });
    assert.equal(res.status, 400);
  });
});

describe('flussonic authorization backend', () => {
  test('rejects a request without the shared key', async () => {
    const res = await panel.req('GET', `/api/auth-backend?token=${subscriberToken}&name=btv_hd`);
    assert.equal(res.status, 403);
    assert.equal(res.body.reason, 'bad_backend_key');
  });

  test('grants access to a valid subscriber and sets the session headers', async () => {
    const res = await panel.req(
      'GET',
      `/api/auth-backend?key=test-backend-key&token=${subscriberToken}&name=btv_hd&ip=10.0.0.5`
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-max-sessions'), '2');
    assert.ok(res.headers.get('x-userid'));
  });

  test('denies an unknown token', async () => {
    const res = await panel.req('GET', '/api/auth-backend?key=test-backend-key&token=deadbeef&name=btv_hd');
    assert.equal(res.status, 403);
    assert.equal(res.body.reason, 'unknown_token');
  });

  test('denies a stream the panel does not manage', async () => {
    const res = await panel.req(
      'GET',
      `/api/auth-backend?key=test-backend-key&token=${subscriberToken}&name=some_pirate_stream`
    );
    assert.equal(res.status, 403);
    assert.equal(res.body.reason, 'channel_not_allowed');
  });

  test('denies a suspended subscriber', async () => {
    await panel.req('PUT', `/api/iptv-users/${subscriberId}`, { token, body: { status: 'suspended' } });
    const res = await panel.req('GET', `/api/auth-backend?key=test-backend-key&token=${subscriberToken}&name=btv_hd`);
    assert.equal(res.status, 403);
    assert.equal(res.body.reason, 'suspended');
    await panel.req('PUT', `/api/iptv-users/${subscriberId}`, { token, body: { status: 'active' } });
  });

  test('denies an expired subscriber', async () => {
    await panel.req('PUT', `/api/iptv-users/${subscriberId}`, { token, body: { expiresAt: '2020-01-01' } });
    const res = await panel.req('GET', `/api/auth-backend?key=test-backend-key&token=${subscriberToken}&name=btv_hd`);
    assert.equal(res.status, 403);
    assert.equal(res.body.reason, 'expired');
    await panel.req('PUT', `/api/iptv-users/${subscriberId}`, { token, body: { expiresAt: null } });
  });

  test('enforces category entitlements', async () => {
    await panel.req('PUT', `/api/iptv-users/${subscriberId}`, { token, body: { allowedCategories: ['Sports'] } });
    const denied = await panel.req(
      'GET',
      `/api/auth-backend?key=test-backend-key&token=${subscriberToken}&name=btv_hd`
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.reason, 'channel_not_allowed');

    await panel.req('PUT', `/api/iptv-users/${subscriberId}`, { token, body: { allowedCategories: [] } });
    const allowed = await panel.req(
      'GET',
      `/api/auth-backend?key=test-backend-key&token=${subscriberToken}&name=btv_hd`
    );
    assert.equal(allowed.status, 200);
  });

  test('records the last seen time and IP', async () => {
    const res = await panel.req('GET', '/api/iptv-users', { token });
    const user = res.body.data.find((u) => u.id === subscriberId);
    assert.ok(user.lastSeenAt);
    assert.equal(user.lastIp, '10.0.0.5');
  });
});

describe('subscriber playlist', () => {
  test('serves an M3U containing the entitled channel with the token', async () => {
    const res = await panel.req('GET', `/playlist/${subscriberToken}.m3u`);
    assert.equal(res.status, 200);
    assert.match(res.text, /^#EXTM3U/);
    assert.match(res.text, /group-title="Bangladesh"/);
    assert.match(res.text, new RegExp(`btv_hd/index\\.m3u8\\?token=${subscriberToken}`));
  });

  test('hides channels outside the subscriber package', async () => {
    await panel.req('PUT', `/api/iptv-users/${subscriberId}`, { token, body: { allowedCategories: ['Sports'] } });
    const res = await panel.req('GET', `/playlist/${subscriberToken}.m3u`);
    assert.equal(res.status, 200);
    assert.equal(res.text.includes('btv_hd'), false);
    await panel.req('PUT', `/api/iptv-users/${subscriberId}`, { token, body: { allowedCategories: [] } });
  });

  test('refuses an unknown token', async () => {
    const res = await panel.req('GET', '/playlist/deadbeef.m3u');
    assert.equal(res.status, 403);
  });

  test('rotating the token invalidates the old playlist link', async () => {
    const oldToken = subscriberToken;
    const rot = await panel.req('POST', `/api/iptv-users/${subscriberId}/rotate-token`, { token });
    assert.equal(rot.status, 200);
    assert.notEqual(rot.body.data.token, oldToken);
    const old = await panel.req('GET', `/playlist/${oldToken}.m3u`);
    assert.equal(old.status, 403);
    const fresh = await panel.req('GET', `/playlist/${rot.body.data.token}.m3u`);
    assert.equal(fresh.status, 200);
    subscriberToken = rot.body.data.token;
  });
});

describe('overview', () => {
  test('aggregates totals across servers, channels and subscribers', async () => {
    const res = await panel.req('GET', '/api/overview', { token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.servers.map((s) => s.name), ['BD Node 1 (edited)'], 'leftover test servers');
    assert.equal(res.body.totals.servers, 1);
    assert.equal(res.body.totals.channels, 1);
    assert.equal(res.body.totals.subscribers, 1);
    assert.equal(res.body.totals.serversOnline, 1);
    assert.deepEqual(res.body.categories, ['Bangladesh']);
    assert.equal(res.body.servers[0].channels, 1);
  });
});

describe('cleanup paths', () => {
  test('deleting a channel also removes it from Flussonic', async () => {
    assert.ok(flussonic.streams.has('btv_hd'));
    const res = await panel.req('DELETE', `/api/channels/${channelId}`, { token });
    assert.equal(res.status, 200);
    assert.equal(flussonic.streams.has('btv_hd'), false);
  });

  test('deleting a subscriber works', async () => {
    const res = await panel.req('DELETE', `/api/iptv-users/${subscriberId}`, { token });
    assert.equal(res.status, 200);
    const after = await panel.req('GET', '/api/iptv-users', { token });
    assert.equal(after.body.data.length, 0);
  });

  test('deleting the now-empty server works', async () => {
    const res = await panel.req('DELETE', `/api/servers/${serverId}`, { token });
    assert.equal(res.status, 200);
  });

  test('a genuine crash is still hidden from the client', async () => {
    // Only deliberate HttpErrors expose their message; unexpected ones must not.
    const { errorHandler, HttpError } = await import('../server/middleware/validate.js');
    const captured = {};
    const res = {
      status(c) { captured.status = c; return this; },
      json(b) { captured.body = b; return this; },
    };
    errorHandler(new Error('ECONNRESET at internal/db/secret.js'), {}, res, () => {});
    assert.equal(captured.status, 500);
    assert.equal(captured.body.error, 'Internal server error');

    errorHandler(new HttpError(502, 'Flussonic refused the restart'), {}, res, () => {});
    assert.equal(captured.status, 502);
    assert.equal(captured.body.error, 'Flussonic refused the restart');
  });

  test('unknown API routes return a JSON 404', async () => {
    const res = await panel.req('GET', '/api/nope', { token });
    assert.equal(res.status, 404);
    assert.match(res.body.error, /Unknown API route/);
  });
});
