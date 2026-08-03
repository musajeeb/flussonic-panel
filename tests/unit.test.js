process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, safeEqual, randomPassword, randomToken } from '../server/services/crypto.js';
import { normalizeStatus, normalizeStreamList, playbackUrls, baseUrl, bitrateToBps } from '../server/services/flussonic.js';
import { evaluateSubscriber, canAccessChannel, entitledChannels } from '../server/services/access.js';
import { listStreams } from '../server/services/flussonic.js';
import * as fakes from './fake-flussonic.js';

describe('crypto', () => {
  test('round-trips a value', () => {
    const secret = 'p@ssw0rd — ünicode ✓';
    const enc = encrypt(secret);
    assert.notEqual(enc, secret);
    assert.match(enc, /^enc:v1:/);
    assert.equal(decrypt(enc), secret);
  });

  test('produces a different ciphertext each time', () => {
    assert.notEqual(encrypt('same'), encrypt('same'));
  });

  test('does not double-encrypt', () => {
    const once = encrypt('abc');
    assert.equal(encrypt(once), once);
  });

  test('handles empty values', () => {
    assert.equal(encrypt(''), '');
    assert.equal(decrypt(''), '');
    assert.equal(decrypt(null), '');
  });

  test('returns empty string on a tampered ciphertext', () => {
    const enc = encrypt('abc');
    assert.equal(decrypt(`${enc}tampered`), '');
  });

  test('passes through legacy plaintext', () => {
    assert.equal(decrypt('plaintext-from-old-version'), 'plaintext-from-old-version');
  });

  test('safeEqual compares correctly', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual(undefined, 'abc'), false);
  });

  test('random helpers have the right shape', () => {
    assert.equal(randomToken(16).length, 32);
    assert.equal(randomPassword(10).length, 10);
    assert.notEqual(randomPassword(), randomPassword());
  });
});

describe('flussonic status normalization', () => {
  test('derives used memory and percentages', () => {
    const s = normalizeStatus({
      total_memory: 1000,
      free_memory: 250,
      total_disk: 2000,
      free_disk: 500,
      cpu_usage: 33.33,
    });
    assert.equal(s.memoryUsedBytes, 750);
    assert.equal(s.memoryPercent, 75);
    assert.equal(s.diskUsedBytes, 1500);
    assert.equal(s.diskPercent, 75);
    assert.equal(s.cpuPercent, 33.3);
  });

  test('accepts nested shapes from other versions', () => {
    const s = normalizeStatus({ memory: { total: 100, used: 40 }, cpu: { idle: 90 } });
    assert.equal(s.memoryPercent, 40);
    assert.equal(s.cpuPercent, 10);
  });

  test('returns nulls rather than guesses when data is absent', () => {
    const s = normalizeStatus({});
    assert.equal(s.cpuPercent, null);
    assert.equal(s.memoryPercent, null);
    assert.equal(s.outputBitrateBps, null);
  });

  test('never divides by zero', () => {
    const s = normalizeStatus({ total_memory: 0, free_memory: 0 });
    assert.equal(s.memoryPercent, null);
  });
});

describe('stream list normalization', () => {
  test('handles the {streams:[…]} shape', () => {
    const [s] = normalizeStreamList({ streams: [{ name: 'a', alive: true, stats: { clients: 4 } }] });
    assert.equal(s.name, 'a');
    assert.equal(s.alive, true);
    assert.equal(s.clients, 4);
    assert.equal(s.inputBitrateBps, null);
  });

  test('reads viewer counts and bitrates under their various names', () => {
    const [a] = normalizeStreamList([{ name: 'a', stats: { online_clients: 7, input_bitrate: 3_000_000 } }]);
    assert.equal(a.clients, 7);
    assert.equal(a.inputBitrateBps, 3_000_000);

    const [b] = normalizeStreamList([{ name: 'b', client_count: 2, bitrate: 1_500_000 }]);
    assert.equal(b.clients, 2);
    assert.equal(b.inputBitrateBps, 1_500_000);
  });

  test('treats a missing viewer count as zero, not null', () => {
    const [s] = normalizeStreamList([{ name: 'a' }]);
    assert.equal(s.clients, 0);
  });

  test('handles a bare array', () => {
    assert.equal(normalizeStreamList([{ name: 'a' }, { name: 'b' }]).length, 2);
  });

  test('handles the legacy keyed-object shape', () => {
    const list = normalizeStreamList({ ch1: { alive: true }, ch2: { alive: false } });
    assert.equal(list.length, 2);
    assert.equal(list.filter((s) => s.alive).length, 1);
  });

  test('drops entries with no name', () => {
    assert.equal(normalizeStreamList([{ alive: true }, { name: 'ok' }]).length, 1);
  });
});

describe('playback URLs', () => {
  const server = { protocol: 'http', host: '10.0.0.1', port: 8080, playbackDomain: '' };

  test('builds URLs from host and port', () => {
    const u = playbackUrls(server, 'btv_hd');
    assert.equal(u.hls, 'http://10.0.0.1:8080/btv_hd/index.m3u8');
    assert.equal(baseUrl(server), 'http://10.0.0.1:8080');
  });

  test('prefers the playback domain when set', () => {
    const u = playbackUrls({ ...server, playbackDomain: 'cdn.example.com' }, 'btv_hd');
    assert.equal(u.hls, 'http://cdn.example.com/btv_hd/index.m3u8');
  });

  test('appends and encodes the token', () => {
    const u = playbackUrls(server, 'btv_hd', 'a b+c');
    assert.match(u.hls, /\?token=a%20b%2Bc$/);
  });

  test('encodes the channel name', () => {
    const u = playbackUrls(server, 'ch name');
    assert.match(u.hls, /ch%20name/);
  });
});

describe('stream paging across Flussonic versions', () => {
  const connect = (box) => ({
    id: 'x',
    protocol: 'http',
    host: box.host,
    port: box.port,
    apiUser: 'admin',
    apiPasswordEnc: encrypt('secret'),
  });

  for (const paging of ['offset', 'skip', 'from', 'page']) {
    test(`collects all 365 streams when the server pages by "${paging}"`, async () => {
      const box = await fakes.startCappedFlussonic({ paging });
      const streams = await listStreams(connect(box));
      assert.equal(streams.length, 365, 'must not stop at the 200-item cap');
      assert.equal(streams.filter((s) => s.alive).length, 232);
      assert.equal(new Set(streams.map((s) => s.name)).size, 365, 'no duplicates');
      await box.close();
    });
  }

  test('gives up cleanly when the server ignores every paging parameter', async () => {
    const box = await fakes.startCappedFlussonic({ paging: 'none' });
    const streams = await listStreams(connect(box));
    // We cannot invent what the server will not send, but we must not hang or
    // duplicate — and what we do return has to be usable.
    assert.equal(streams.length, 200);
    assert.equal(new Set(streams.map((s) => s.name)).size, 200);
    await box.close();
  });

  test('works when the server does not advertise a total', async () => {
    const box = await fakes.startCappedFlussonic({ advertiseTotal: false, paging: 'offset' });
    const streams = await listStreams(connect(box));
    assert.equal(streams.length, 365);
    await box.close();
  });

  test('a small server still returns in one request', async () => {
    const box = await fakes.startCappedFlussonic({ total: 40, cap: 200 });
    const streams = await listStreams(connect(box));
    assert.equal(streams.length, 40);
    await box.close();
  });
});

describe('bitrate units', () => {
  test('scales Flussonic kbit/s values to bits per second', () => {
    // Flussonic's UI shows "2192kbit/s" for this stream.
    assert.equal(bitrateToBps(2192), 2_192_000);
    assert.equal(bitrateToBps(967), 967_000);
  });

  test('leaves values that are already bps alone', () => {
    assert.equal(bitrateToBps(4_000_000), 4_000_000);
    assert.equal(bitrateToBps(338_000_000), 338_000_000);
  });

  test('ignores zero and missing values', () => {
    assert.equal(bitrateToBps(0), null);
    assert.equal(bitrateToBps(null), null);
    assert.equal(bitrateToBps(undefined), null);
  });

  test('a whole server sums to the figure Flussonic itself reports', () => {
    // 115 streams that Flussonic listed in kbit/s; its header said 338 MBPS.
    const streams = Array.from({ length: 115 }, () => ({ name: 'x', stats: { input_bitrate: 2887 } }));
    const total = normalizeStreamList(streams).reduce((n, s) => n + s.inputBitrateBps, 0);
    const mbps = total / 1e6;
    assert.ok(mbps > 300 && mbps < 350, `expected roughly 338 Mbps, got ${mbps.toFixed(0)}`);
  });
});

describe('subscriber access rules', () => {
  const base = { status: 'active', expiresAt: null, allowedCategories: [], allowedServerIds: [] };

  test('active subscriber is allowed', () => {
    assert.equal(evaluateSubscriber(base).allowed, true);
  });

  test('missing subscriber is denied', () => {
    assert.equal(evaluateSubscriber(null).reason, 'unknown_token');
  });

  test('suspended subscriber is denied', () => {
    assert.equal(evaluateSubscriber({ ...base, status: 'suspended' }).reason, 'suspended');
  });

  test('expired subscriber is denied', () => {
    assert.equal(evaluateSubscriber({ ...base, expiresAt: '2020-01-01' }).reason, 'expired');
  });

  test('future expiry is still allowed', () => {
    assert.equal(evaluateSubscriber({ ...base, expiresAt: '2999-01-01' }).allowed, true);
  });

  test('empty allow-lists mean full access', () => {
    assert.equal(canAccessChannel(base, { category: 'Anything', serverId: 'x', enabled: true }), true);
  });

  test('category restriction is enforced', () => {
    const u = { ...base, allowedCategories: ['Sports'] };
    assert.equal(canAccessChannel(u, { category: 'Sports', serverId: 'x', enabled: true }), true);
    assert.equal(canAccessChannel(u, { category: 'News', serverId: 'x', enabled: true }), false);
  });

  test('server restriction is enforced', () => {
    const u = { ...base, allowedServerIds: ['s1'] };
    assert.equal(canAccessChannel(u, { category: 'x', serverId: 's1', enabled: true }), true);
    assert.equal(canAccessChannel(u, { category: 'x', serverId: 's2', enabled: true }), false);
  });

  test('disabled channels are never accessible', () => {
    assert.equal(canAccessChannel(base, { category: 'x', serverId: 'y', enabled: false }), false);
  });

  test('entitledChannels filters the list consistently', () => {
    const channels = [
      { name: 'a', category: 'Sports', serverId: 's1', enabled: true },
      { name: 'b', category: 'News', serverId: 's1', enabled: true },
      { name: 'c', category: 'Sports', serverId: 's2', enabled: true },
    ];
    const u = { ...base, allowedCategories: ['Sports'], allowedServerIds: ['s1'] };
    assert.deepEqual(entitledChannels(u, channels).map((c) => c.name), ['a']);
  });
});
