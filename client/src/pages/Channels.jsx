import React, { useEffect, useState, useCallback } from 'react';
import api, { errMsg } from '../lib/api';
import { Modal, StatusBadge, Empty, Alert, CopyField } from '../components/ui';
import { usePagination, Pagination } from '../components/Pagination';
import { Plus, Trash2, Pencil, RefreshCw, Loader2, Link2, Download, Search } from 'lucide-react';

const BLANK = {
  name: '',
  title: '',
  serverId: '',
  sourceUrl: '',
  category: '',
  logo: '',
  epgId: '',
  enabled: true,
};

export default function Channels({ onCounts }) {
  const [channels, setChannels] = useState([]);
  const [servers, setServers] = useState([]);
  const [filter, setFilter] = useState('');
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const [counts, setCounts] = useState({ total: 0, managed: 0, serverOnly: 0 });
  const [serverErrors, setServerErrors] = useState([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [urlsFor, setUrlsFor] = useState(null);
  const [loading, setLoading] = useState(true);
  const pager = usePagination(channels, { defaultSize: 25, resetKey: `${filter}|${source}|${query}` });

  const load = useCallback(
    async ({ refresh = false } = {}) => {
      try {
        const params = { ...(filter ? { serverId: filter } : {}), ...(source ? { source } : {}), ...(query ? { q: query } : {}) };
        if (refresh) params.refresh = 'true';
        const [c, s] = await Promise.all([api.get('/channels', { params }), api.get('/servers')]);
        setChannels(c.data.data);
        setCounts(c.data.counts || { total: 0, managed: 0, serverOnly: 0 });
        setServerErrors(c.data.serverErrors || []);
        setServers(s.data.data);
        onCounts?.({ channels: c.data.counts?.total ?? c.data.data.length });
      } catch (err) {
        setError(errMsg(err));
      } finally {
        setLoading(false);
      }
    },
    [filter, source, query, onCounts]
  );

  useEffect(() => {
    const t = setTimeout(() => load(), query ? 300 : 0); // debounce typing
    return () => clearTimeout(t);
  }, [load, query]);

  const importFrom = async (serverId) => {
    const server = servers.find((s) => s.id === serverId);
    if (!server) return;
    if (
      !window.confirm(
        `Add every channel already on "${server.name}" to the panel?\n\nNothing on the Flussonic server is changed — this only lets you put them into subscriber packages.`
      )
    )
      return;
    setImporting(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post('/channels/import', { serverId });
      setNotice(
        data.imported > 0
          ? `Adopted ${data.imported} channel(s) from ${server.name}.`
          : `Nothing new — all ${data.total} channel(s) were already in the panel.`
      );
      await load({ refresh: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setImporting(false);
    }
  };

  const openNew = () => {
    setForm({ ...BLANK, serverId: servers[0]?.id || '' });
    setEditing('new');
    setError('');
  };

  const openEdit = (c) => {
    setForm({
      name: c.name,
      title: c.title || '',
      serverId: c.serverId,
      sourceUrl: c.sourceUrl,
      category: c.category || '',
      logo: c.logo || '',
      epgId: c.epgId || '',
      enabled: c.enabled,
    });
    setEditing(c.id);
    setError('');
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = editing === 'new' ? await api.post('/channels', form) : await api.put(`/channels/${editing}`, form);
      setEditing(null);
      await load();
      const warn = res.data.warning || res.data.data?.syncError;
      if (warn) setError(warn);
      else {
        setNotice(
          res.data.created > 1
            ? `Channel created on ${res.data.created} servers.`
            : 'Channel pushed to Flussonic successfully.'
        );
        setTimeout(() => setNotice(''), 5000);
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const sync = async (c) => {
    setBusyId(c.id);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post(`/channels/${c.id}/sync`);
      if (data.status === 'synced') setNotice(`"${c.name}" re-sent to ${c.serverName}.`);
      else setError(data.error);
      await load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (c) => {
    const msg =
      c.source === 'server'
        ? `Delete "${c.name}" from ${c.serverName}?\n\nThis removes the stream from the Flussonic server itself.`
        : `Delete "${c.name}"? It will also be removed from ${c.serverName}.`;
    if (!window.confirm(msg)) return;
    setBusyId(c.id);
    setError('');
    try {
      const { data } = await api.delete(`/channels/${c.id}`);
      if (data.warning) setError(data.warning);
      await load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  };

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  return (
    <>
      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{notice}</Alert>
      {serverErrors.map((e) => (
        <Alert kind="warn" key={e.serverId}>
          Could not read channels from {e.serverName}: {e.error}
        </Alert>
      ))}

      <div className="card">
        <div className="card-head">
          <h3>
            Channels ({counts.total})
            <span style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--muted)', marginLeft: 8 }}>
              {counts.managed} in panel · {counts.serverOnly} on servers only
            </span>
          </h3>
          <div className="spacer" />
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 9, top: 11, color: 'var(--muted)' }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search channels…"
              style={{ width: 190, paddingLeft: 28 }}
            />
          </div>
          <select value={source} onChange={(e) => setSource(e.target.value)} style={{ width: 150 }}>
            <option value="">All sources</option>
            <option value="panel">Created here</option>
            <option value="imported">Imported</option>
            <option value="server">On server only</option>
          </select>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 170 }}>
            <option value="">All servers</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={() => load({ refresh: true })} title="Re-read from the servers">
            <RefreshCw size={14} /> Refresh
          </button>
          {filter && counts.serverOnly > 0 && (
            <button className="btn btn-sm" onClick={() => importFrom(filter)} disabled={importing}>
              {importing ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
              Add all to panel
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={openNew} disabled={servers.length === 0}>
            <Plus size={15} /> Add channel
          </button>
        </div>

        {loading ? (
          <div className="empty">
            <Loader2 size={26} className="spin" />
            <div>Loading…</div>
          </div>
        ) : servers.length === 0 ? (
          <Empty title="Add a server first" hint="Channels are pushed to a Flussonic server, so add one before creating channels." />
        ) : channels.length === 0 ? (
          <Empty
            title="No channels found"
            hint="Channels already on your servers appear here automatically. If this is empty, check the server connection."
            action={
              <button className="btn btn-primary" onClick={openNew}>
                <Plus size={15} /> Add channel
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Server</th>
                  <th>Category</th>
                  <th>Live</th>
                  <th>In panel</th>
                  <th style={{ width: 180 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.visible.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.title || c.name}</div>
                      <div className="mono">{c.name}</div>
                      {!c.enabled && <span className="badge badge-idle">Disabled</span>}
                    </td>
                    <td>{c.serverName}</td>
                    <td>{c.category}</td>
                    <td>
                      {c.onServer ? (
                        <>
                          <span className={`badge ${c.onServer.alive ? 'badge-ok' : 'badge-bad'}`}>
                            <span className="dot" />
                            {c.onServer.alive ? 'alive' : 'dead'}
                          </span>
                          {c.onServer.clients > 0 && (
                            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>
                              {c.onServer.clients} watching
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="badge badge-idle">not seen</span>
                      )}
                    </td>
                    <td>
                      {c.source === 'server' ? (
                        <span className="badge badge-warn">server only</span>
                      ) : c.source === 'imported' ? (
                        <span className="badge badge-ok">imported</span>
                      ) : (
                        <>
                          <span className="badge badge-ok">created here</span>
                          {c.syncState === 'error' && (
                            <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 4, maxWidth: 220 }}>
                              {c.syncError}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <div className="btn-row">
                        {c.source !== 'server' && (
                          <button
                            className="btn btn-sm btn-icon"
                            onClick={() => sync(c)}
                            disabled={busyId === c.id}
                            title="Re-send to Flussonic"
                          >
                            {busyId === c.id ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                          </button>
                        )}
                        <button className="btn btn-sm btn-icon" onClick={() => setUrlsFor(c)} title="Playback URLs">
                          <Link2 size={14} />
                        </button>
                        <button
                          className="btn btn-sm btn-icon"
                          onClick={() => openEdit(c)}
                          title={c.source === 'server' ? 'Edit (adds it to the panel)' : 'Edit'}
                        >
                          <Pencil size={14} />
                        </button>
                        <button className="btn btn-sm btn-icon btn-danger" onClick={() => remove(c)} title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination state={pager} label="channels" />
          </div>
        )}
      </div>

      {editing && (
        <Modal
          title={editing === 'new' ? 'Add channel' : 'Edit channel'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving && <Loader2 size={15} className="spin" />}
                Save &amp; push
              </button>
            </>
          }
        >
          <form onSubmit={save}>
            <Alert kind="error">{error}</Alert>
            <div className="form-row">
              <div className="field">
                <label>Stream name *</label>
                <input value={form.name} onChange={set('name')} placeholder="btv_hd" required disabled={editing !== 'new'} />
                <div className="help">
                  Used in the playback URL. Letters, digits, dot, dash, underscore. Cannot be changed later.
                </div>
              </div>
              <div className="field">
                <label>Display title</label>
                <input value={form.title} onChange={set('title')} placeholder="BTV HD" />
              </div>
            </div>

            <div className="field">
              <label>Target server *</label>
              <select value={form.serverId} onChange={set('serverId')} required disabled={editing !== 'new'}>
                <option value="">Select a server…</option>
                {editing === 'new' && servers.filter((s) => s.enabled !== false).length > 1 && (
                  <option value="all">★ All servers ({servers.filter((s) => s.enabled !== false).length})</option>
                )}
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.category})
                  </option>
                ))}
              </select>
              {form.serverId === 'all' && (
                <div className="help" style={{ color: 'var(--amber)' }}>
                  This channel will be created on every enabled server, one after another.
                </div>
              )}
              {editing !== 'new' && <div className="help">To move a channel, delete it and recreate it on the other server.</div>}
            </div>

            <div className="field">
              <label>Source URL *</label>
              <input
                value={form.sourceUrl}
                onChange={set('sourceUrl')}
                placeholder="udp://239.0.0.1:1234 or http://source/stream.m3u8"
                required
              />
              <div className="help">Anything Flussonic accepts as an input: udp://, http://, rtmp://, rtsp://, srt://.</div>
            </div>

            <div className="form-row">
              <div className="field">
                <label>Category</label>
                <input value={form.category} onChange={set('category')} placeholder="Sports" />
                <div className="help">Becomes the playlist group and controls subscriber access.</div>
              </div>
              <div className="field">
                <label>EPG id</label>
                <input value={form.epgId} onChange={set('epgId')} placeholder="btv.bd" />
              </div>
            </div>

            <div className="field">
              <label>Logo URL</label>
              <input value={form.logo} onChange={set('logo')} placeholder="https://…/logo.png" />
            </div>

            <label className="checkbox">
              <input type="checkbox" checked={form.enabled} onChange={set('enabled')} />
              Enabled
            </label>
          </form>
        </Modal>
      )}

      {urlsFor && (
        <Modal title={`Playback URLs — ${urlsFor.name}`} onClose={() => setUrlsFor(null)} wide>
          {urlsFor.urls ? (
            Object.entries(urlsFor.urls).map(([k, v]) => (
              <div className="field" key={k}>
                <label>{k.toUpperCase()}</label>
                <CopyField value={v} />
              </div>
            ))
          ) : (
            <Alert kind="warn">The server for this channel no longer exists.</Alert>
          )}
          <Alert kind="info">
            If authorization is enabled, subscribers need <code>?token=…</code> appended — the generated M3U playlist does
            that automatically.
          </Alert>
        </Modal>
      )}
    </>
  );
}
