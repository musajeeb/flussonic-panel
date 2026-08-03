import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api, { errMsg } from '../lib/api';
import { StatusBadge, Empty, Alert, Meter } from '../components/ui';
import { bitrate, bytes, num, uptime, dateTime } from '../lib/format';

/** Shows a percentage, or a dash when the server does not report one. */
const pctLabel = (v) => (Number.isFinite(Number(v)) ? `${Number(v).toFixed(0)}%` : '—');
import { RefreshCw, Server as ServerIcon, Loader2, Eye, Stethoscope, Radio } from 'lucide-react';

export default function Dashboard({ onCounts }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(true);
  const [diag, setDiag] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/overview');
      setData(res.data);
      setError('');
      onCounts?.({
        servers: res.data.totals.servers,
        channels: res.data.totals.channels,
        subscribers: res.data.totals.subscribers,
      });
    } catch (err) {
      setError(errMsg(err));
    }
  }, [onCounts]);

  useEffect(() => {
    load();
    if (!live) return undefined;
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [load, live]);

  const diagnose = async (server) => {
    setDiag({ server, loading: true });
    try {
      const { data } = await api.get(`/servers/${server.id}/inspect`);
      setDiag({ server, loading: false, data });
    } catch (err) {
      setDiag({ server, loading: false, error: errMsg(err) });
    }
  };

  const refreshAll = async () => {
    if (!data) return;
    setBusy(true);
    // Probe every server, then reload the aggregate once.
    await Promise.all(data.servers.map((s) => api.post(`/servers/${s.id}/check`).catch(() => null)));
    await load();
    setBusy(false);
  };

  if (!data) {
    return (
      <>
        <Alert kind="error">{error}</Alert>
        {!error && <div className="empty"><Loader2 size={28} className="spin" /><div>Loading…</div></div>}
      </>
    );
  }

  const t = data.totals;

  return (
    <>
      <Alert kind="error">{error}</Alert>

      <div className="stat-grid">
        <div className="stat">
          <div className="label">Servers</div>
          <div className="value">{t.servers}</div>
          <div className="hint">
            {t.serversOnline} online · {t.serversOffline} offline
          </div>
        </div>
        <div className="stat">
          <div className="label">Channels</div>
          <div className="value">{t.channels}</div>
          <div className="hint">
            {t.channelsSynced} synced{t.channelsError > 0 ? ` · ${t.channelsError} failed` : ''}
          </div>
        </div>
        <div className="stat">
          <div className="label">Subscribers</div>
          <div className="value">{t.subscribers}</div>
          <div className="hint">{t.subscribersActive} active</div>
        </div>
        <div className="stat">
          <div className="label">Viewers now</div>
          <div className="value">{num(t.clients)}</div>
          <div className="hint">across all servers</div>
        </div>
        <div className="stat">
          <div className="label">Output traffic</div>
          <div className="value">{bitrate(t.outputBitrateBps)}</div>
          <div className="hint">In: {bitrate(t.inputBitrateBps)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>
            <Eye size={15} style={{ verticalAlign: '-2px', marginRight: 7 }} />
            What people are watching now
          </h3>
          <div className="spacer" />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {data.topStreams?.length || 0} channel(s) with viewers
          </span>
        </div>
        {(data.topStreams?.length || 0) === 0 ? (
          <div className="empty" style={{ padding: '28px 20px' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Nobody is watching right now</div>
            <div style={{ fontSize: 13 }}>
              Channels appear here as soon as your servers report viewers. Press “Refresh all” below to update.
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 42 }}>#</th>
                  <th>Channel</th>
                  <th>Server</th>
                  <th style={{ textAlign: 'right' }}>Viewers</th>
                  <th style={{ textAlign: 'right' }}>Bitrate</th>
                  <th style={{ width: '28%' }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {data.topStreams.map((s, i) => {
                  const max = data.topStreams[0].clients || 1;
                  return (
                    <tr key={`${s.serverId}-${s.name}`}>
                      <td style={{ color: 'var(--muted)' }}>{i + 1}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{s.title || s.name}</div>
                        {s.title && <div className="mono">{s.name}</div>}
                      </td>
                      <td>{s.serverName}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{num(s.clients)}</td>
                      <td style={{ textAlign: 'right' }} className="mono">
                        {bitrate(s.bitrateBps)}
                      </td>
                      <td>
                        <div className="meter-bar">
                          <div className="meter-fill" style={{ width: `${((s.clients || 0) / max) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {diag && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDiag(null)}>
          <div className="modal" style={{ maxWidth: 760 }}>
            <div className="modal-head">
              <h3>API check — {diag.server.name}</h3>
              <div className="spacer" />
              <button className="btn btn-icon" onClick={() => setDiag(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              {diag.loading && (
                <div className="empty">
                  <Loader2 size={26} className="spin" />
                  <div>Asking the server what it supports…</div>
                </div>
              )}
              {diag.error && <Alert kind="error">{diag.error}</Alert>}
              {diag.data && (
                <>
                  <Alert kind="info">
                    Send this list and the panel can be taught where CPU, RAM and uptime live on your Flussonic version.
                  </Alert>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Endpoint</th>
                          <th style={{ width: 90 }}>Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diag.data.probes.map((p) => (
                          <tr key={p.path}>
                            <td className="mono">{p.path}</td>
                            <td>
                              <span className={`badge ${p.status >= 200 && p.status < 300 ? 'badge-ok' : 'badge-bad'}`}>
                                {p.status ?? p.error}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {diag.data.schemaPaths?.length > 0 && (
                    <div className="field" style={{ marginTop: 16 }}>
                      <label>
                        Every GET endpoint your server publishes ({diag.data.schemaPaths.length}) — this is what tells
                        us where CPU, RAM and uptime live
                      </label>
                      <textarea
                        readOnly
                        style={{ minHeight: 200, fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}
                        value={diag.data.schemaPaths.join('\n')}
                        onFocus={(e) => e.target.select()}
                      />
                    </div>
                  )}

                  <div className="field" style={{ marginTop: 16 }}>
                    <label>One stream, exactly as your server describes it</label>
                    <textarea
                      readOnly
                      style={{ minHeight: 180, fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}
                      value={JSON.stringify(diag.data.sampleStream ?? {}, null, 2)}
                      onFocus={(e) => e.target.select()}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3>Server health</h3>
          <div className="spacer" />
          <label className="checkbox" style={{ marginRight: 10, fontSize: 12.5 }}>
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            <Radio size={13} style={{ color: live ? 'var(--green)' : 'var(--muted)' }} />
            Live
          </label>
          <button className="btn btn-sm" onClick={refreshAll} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            Refresh all
          </button>
        </div>
        <div className="card-body">
          {data.servers.length === 0 ? (
            <Empty
              title="No servers yet"
              hint="Add your first Flussonic server to start monitoring it."
              action={
                <Link className="btn btn-primary" to="/servers">
                  <ServerIcon size={15} /> Add a server
                </Link>
              }
            />
          ) : (
            <div className="server-grid">
              {data.servers.map((s) => (
                <div className="server-card" key={s.id}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h4>{s.name}</h4>
                      <div className="url">{s.baseUrl}</div>
                    </div>
                    <StatusBadge status={s.status} />
                  </div>

                  {s.status === 'offline' && s.lastError && (
                    <div className="alert alert-error" style={{ margin: '12px 0 0', fontSize: 12 }}>
                      {s.lastError}
                    </div>
                  )}

                  <Meter label="CPU" value={s.stats?.cpuPercent} right={pctLabel(s.stats?.cpuPercent)} />
                  <Meter
                    label="RAM"
                    value={s.stats?.memoryPercent}
                    right={
                      s.stats?.memoryUsedBytes
                        ? `${pctLabel(s.stats.memoryPercent)} · ${bytes(s.stats.memoryUsedBytes)}/${bytes(s.stats.memoryTotalBytes)}`
                        : pctLabel(s.stats?.memoryPercent)
                    }
                  />
                  <Meter
                    label="Disk"
                    value={s.stats?.diskPercent}
                    right={
                      s.stats?.diskUsedBytes
                        ? `${pctLabel(s.stats.diskPercent)} · ${bytes(s.stats.diskUsedBytes)}/${bytes(s.stats.diskTotalBytes)}`
                        : pctLabel(s.stats?.diskPercent)
                    }
                  />

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 8,
                      marginTop: 14,
                      fontSize: 12.5,
                      color: 'var(--muted)',
                    }}
                  >
                    <div>
                      Out{' '}
                      <b style={{ color: 'var(--text)' }}>
                        {bitrate(s.stats?.outputBitrateBps)}
                        {s.stats?.outputEstimated ? ' *' : ''}
                      </b>
                    </div>
                    <div>
                      In <b style={{ color: 'var(--text)' }}>{bitrate(s.stats?.inputBitrateBps)}</b>
                    </div>
                    <div>
                      Streams{' '}
                      <b style={{ color: 'var(--text)' }}>
                        {s.stats?.streamsAlive ?? '—'}/{s.stats?.streamsTotal ?? s.channels}
                      </b>
                    </div>
                    <div>
                      Viewers <b style={{ color: 'var(--text)' }}>{num(s.stats?.clients)}</b>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      Uptime <b style={{ color: 'var(--text)' }}>{uptime(s.stats?.uptimeSec)}</b>
                    </div>
                  </div>

                  {s.stats?.outputEstimated && (
                    <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--muted)' }}>
                      * output estimated from viewers x bitrate — this server does not report egress
                    </div>
                  )}
                  {s.stats?.cpuPercent == null && (
                    <div
                      style={{
                        marginTop: 10,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 11.5,
                        color: 'var(--muted)',
                      }}
                    >
                      <span>This server does not expose CPU/RAM/disk over its API.</span>
                      <button className="btn btn-sm" onClick={() => diagnose(s)} style={{ padding: '3px 8px' }}>
                        <Stethoscope size={12} /> Diagnose
                      </button>
                    </div>
                  )}
                  <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--muted)' }}>
                    Checked: {dateTime(s.stats?.checkedAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
