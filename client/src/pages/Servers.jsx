import React, { useEffect, useState, useCallback } from 'react';
import api, { errMsg } from '../lib/api';
import { Modal, StatusBadge, Empty, Alert } from '../components/ui';
import { usePagination, Pagination } from '../components/Pagination';
import { dateTime } from '../lib/format';
import { Plus, Trash2, Pencil, Activity, Loader2, RotateCcw, ListRestart, Radio } from 'lucide-react';

const BLANK = {
  name: '',
  category: 'General',
  protocol: 'http',
  host: '',
  port: 8080,
  apiUser: '',
  apiPassword: '',
  playbackDomain: '',
  enabled: true,
};

export default function Servers({ onCounts }) {
  const [servers, setServers] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [checkingId, setCheckingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [streamsFor, setStreamsFor] = useState(null);
  const pager = usePagination(servers, { defaultSize: 25 });

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/servers');
      setServers(data.data);
      onCounts?.({ servers: data.data.length });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [onCounts]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setForm(BLANK);
    setEditing('new');
    setError('');
  };

  const openEdit = (s) => {
    setForm({
      name: s.name,
      category: s.category,
      protocol: s.protocol,
      host: s.host,
      port: s.port,
      apiUser: s.apiUser,
      apiPassword: '',
      playbackDomain: s.playbackDomain || '',
      enabled: s.enabled,
    });
    setEditing(s.id);
    setError('');
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editing === 'new') await api.post('/servers', form);
      else await api.put(`/servers/${editing}`, form);
      setEditing(null);
      await load();
      setNotice('Server saved. Use “Check” to verify the connection.');
      setTimeout(() => setNotice(''), 5000);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const check = async (id) => {
    setCheckingId(id);
    setNotice('');
    setError('');
    try {
      const { data } = await api.post(`/servers/${id}/check`);
      if (data.status === 'online') setNotice('Connection OK — statistics updated.');
      else setError(`Could not reach the server: ${data.error}`);
      await load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setCheckingId(null);
    }
  };

  const restartDead = async (s) => {
    if (
      !window.confirm(
        `Restart every dead stream on "${s.name}"?\n\nRunning streams are not touched. This can take a while on a large server.`
      )
    )
      return;
    setCheckingId(s.id);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post(`/servers/${s.id}/restart-dead`);
      if (data.attempted === 0) setNotice(`Nothing to do — no dead streams on ${s.name}.`);
      else setNotice(`${s.name}: restarted ${data.restarted} of ${data.attempted} dead stream(s).`);
      if (data.failed?.length) {
        setError(`Could not restart: ${data.failed.map((f) => f.name).join(', ')} — ${data.failed[0].error}`);
      }
      await load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setCheckingId(null);
    }
  };

  const reload = async (s) => {
    if (!window.confirm(`Ask "${s.name}" to re-read its configuration? Playback is not interrupted.`)) return;
    setCheckingId(s.id);
    setError('');
    setNotice('');
    try {
      await api.post(`/servers/${s.id}/reload`);
      setNotice(`${s.name}: configuration reloaded.`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setCheckingId(null);
    }
  };

  const openStreams = async (s) => {
    setStreamsFor({ server: s, loading: true, data: [] });
    try {
      const { data } = await api.get(`/servers/${s.id}/streams`);
      setStreamsFor({ server: s, loading: false, data: data.data, count: data.count, alive: data.alive });
    } catch (err) {
      setStreamsFor(null);
      setError(errMsg(err));
    }
  };

  const restartOne = async (serverId, name) => {
    try {
      await api.post(`/servers/${serverId}/streams/${encodeURIComponent(name)}/restart`);
      setNotice(`Restarted ${name}.`);
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const remove = async (s) => {
    if (!window.confirm(`Delete server "${s.name}"? This does not touch the Flussonic machine itself.`)) return;
    setError('');
    try {
      await api.delete(`/servers/${s.id}`);
      await load();
    } catch (err) {
      const msg = errMsg(err);
      if (err?.response?.status === 409 && window.confirm(`${msg}\n\nDelete the server and its channel records anyway?`)) {
        await api.delete(`/servers/${s.id}?force=true`).catch((e) => setError(errMsg(e)));
        await load();
      } else {
        setError(msg);
      }
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

      <div className="card">
        <div className="card-head">
          <h3>Servers ({servers.length})</h3>
          <div className="spacer" />
          <button className="btn btn-primary btn-sm" onClick={openNew}>
            <Plus size={15} /> Add server
          </button>
        </div>

        {loading ? (
          <div className="empty">
            <Loader2 size={26} className="spin" />
            <div>Loading…</div>
          </div>
        ) : servers.length === 0 ? (
          <Empty
            title="No servers yet"
            hint="Add the Flussonic machines you want to control from this panel."
            action={
              <button className="btn btn-primary" onClick={openNew}>
                <Plus size={15} /> Add server
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th>Last check</th>
                  <th style={{ width: 190 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.visible.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      {!s.enabled && <span className="badge badge-idle">Disabled</span>}
                    </td>
                    <td>{s.category}</td>
                    <td className="mono">{s.baseUrl}</td>
                    <td>
                      <StatusBadge status={s.status} />
                      {s.status === 'offline' && s.lastError && (
                        <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 4 }}>{s.lastError}</div>
                      )}
                    </td>
                    <td className="mono">{dateTime(s.stats?.checkedAt)}</td>
                    <td>
                      <div className="btn-row">
                        <button className="btn btn-sm" onClick={() => check(s.id)} disabled={checkingId === s.id}>
                          {checkingId === s.id ? <Loader2 size={13} className="spin" /> : <Activity size={13} />}
                          Check
                        </button>
                        <button
                          className="btn btn-sm btn-icon"
                          onClick={() => openStreams(s)}
                          title="Show all streams on this server"
                        >
                          <Radio size={14} />
                        </button>
                        <button
                          className="btn btn-sm btn-icon"
                          onClick={() => restartDead(s)}
                          disabled={checkingId === s.id}
                          title="Restart every dead stream"
                        >
                          <ListRestart size={14} />
                        </button>
                        <button
                          className="btn btn-sm btn-icon"
                          onClick={() => reload(s)}
                          disabled={checkingId === s.id}
                          title="Reload Flussonic configuration"
                        >
                          <RotateCcw size={14} />
                        </button>
                        <button className="btn btn-sm btn-icon" onClick={() => openEdit(s)} aria-label="Edit">
                          <Pencil size={14} />
                        </button>
                        <button className="btn btn-sm btn-icon btn-danger" onClick={() => remove(s)} aria-label="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination state={pager} label="servers" />
          </div>
        )}
      </div>

      {streamsFor && (
        <Modal
          title={`Streams on ${streamsFor.server.name}`}
          onClose={() => setStreamsFor(null)}
          wide
        >
          {streamsFor.loading ? (
            <div className="empty">
              <Loader2 size={26} className="spin" />
              <div>Reading every stream…</div>
            </div>
          ) : (
            <>
              <Alert kind="info">
                {streamsFor.count} stream(s) on this server, {streamsFor.alive} alive. Sorted by viewers.
              </Alert>
              <div className="table-wrap" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Stream</th>
                      <th>State</th>
                      <th style={{ textAlign: 'right' }}>Viewers</th>
                      <th style={{ width: 60 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {streamsFor.data.map((st) => (
                      <tr key={st.name}>
                        <td className="mono">{st.name}</td>
                        <td>
                          <span className={`badge ${st.alive ? 'badge-ok' : 'badge-bad'}`}>
                            <span className="dot" />
                            {st.alive ? 'alive' : 'dead'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{st.clients}</td>
                        <td>
                          <button
                            className="btn btn-sm btn-icon"
                            title="Restart this stream"
                            onClick={() => restartOne(streamsFor.server.id, st.name)}
                          >
                            <RotateCcw size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Modal>
      )}

      {editing && (
        <Modal
          title={editing === 'new' ? 'Add Flussonic server' : 'Edit server'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving && <Loader2 size={15} className="spin" />}
                Save
              </button>
            </>
          }
        >
          <form onSubmit={save}>
            <Alert kind="error">{error}</Alert>
            <div className="form-row">
              <div className="field">
                <label>Server name *</label>
                <input value={form.name} onChange={set('name')} placeholder="Bangladesh Node 1" required />
              </div>
              <div className="field">
                <label>Category</label>
                <input value={form.category} onChange={set('category')} placeholder="Bangladesh" />
                <div className="help">Free text — e.g. Bangladesh, India, Italy, Sports.</div>
              </div>
            </div>

            <div className="form-row">
              <div className="field">
                <label>Protocol</label>
                <select value={form.protocol} onChange={set('protocol')}>
                  <option value="http">http</option>
                  <option value="https">https</option>
                </select>
              </div>
              <div className="field">
                <label>Host / IP *</label>
                <input value={form.host} onChange={set('host')} placeholder="203.0.113.10" required />
              </div>
              <div className="field">
                <label>API port</label>
                <input type="number" value={form.port} onChange={set('port')} placeholder="8080" />
              </div>
            </div>

            <div className="form-row">
              <div className="field">
                <label>Flussonic admin user *</label>
                <input value={form.apiUser} onChange={set('apiUser')} placeholder="admin" required />
              </div>
              <div className="field">
                <label>Flussonic admin password {editing === 'new' ? '*' : ''}</label>
                <input
                  type="password"
                  value={form.apiPassword}
                  onChange={set('apiPassword')}
                  placeholder={editing === 'new' ? '' : 'Leave blank to keep current'}
                  required={editing === 'new'}
                />
                <div className="help">Found in Flussonic under Config → Settings → Access. Stored encrypted.</div>
              </div>
            </div>

            <div className="field">
              <label>Playback domain (optional)</label>
              <input value={form.playbackDomain} onChange={set('playbackDomain')} placeholder="cdn1.example.com" />
              <div className="help">
                Used to build playback URLs for subscribers. Leave blank to use the host above.
              </div>
            </div>

            <label className="checkbox">
              <input type="checkbox" checked={form.enabled} onChange={set('enabled')} />
              Enabled (include in monitoring and playlists)
            </label>
          </form>
        </Modal>
      )}
    </>
  );
}
