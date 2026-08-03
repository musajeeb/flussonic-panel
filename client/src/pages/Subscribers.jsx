import React, { useEffect, useState, useCallback } from 'react';
import api, { errMsg } from '../lib/api';
import { Modal, StatusBadge, Empty, Alert, CopyField } from '../components/ui';
import { dateTime, dateOnly } from '../lib/format';
import { Plus, Trash2, Pencil, KeyRound, Loader2, FileText } from 'lucide-react';

const BLANK = {
  username: '',
  password: '',
  note: '',
  status: 'active',
  maxConnections: 1,
  expiresAt: '',
  allowedCategories: [],
  allowedServerIds: [],
};

function toDateInput(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export default function Subscribers({ onCounts }) {
  const [users, setUsers] = useState([]);
  const [servers, setServers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [u, s, o] = await Promise.all([api.get('/iptv-users'), api.get('/servers'), api.get('/overview')]);
      setUsers(u.data.data);
      setServers(s.data.data);
      setCategories(o.data.categories || []);
      onCounts?.({ subscribers: u.data.data.length });
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

  const openEdit = (u) => {
    setForm({
      username: u.username,
      password: '',
      note: u.note || '',
      status: u.status,
      maxConnections: u.maxConnections,
      expiresAt: toDateInput(u.expiresAt),
      allowedCategories: u.allowedCategories || [],
      allowedServerIds: u.allowedServerIds || [],
    });
    setEditing(u.id);
    setError('');
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, expiresAt: form.expiresAt || null };
      if (editing !== 'new' && !payload.password) delete payload.password;
      const res = editing === 'new' ? await api.post('/iptv-users', payload) : await api.put(`/iptv-users/${editing}`, payload);
      setEditing(null);
      await load();
      if (editing === 'new') setDetail(res.data.data);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const rotate = async (u) => {
    if (!window.confirm(`Generate a new token for "${u.username}"? Their current playlist link stops working.`)) return;
    try {
      const { data } = await api.post(`/iptv-users/${u.id}/rotate-token`);
      await load();
      setDetail(data.data);
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const remove = async (u) => {
    if (!window.confirm(`Delete subscriber "${u.username}"?`)) return;
    try {
      await api.delete(`/iptv-users/${u.id}`);
      await load();
      setNotice('Subscriber deleted.');
      setTimeout(() => setNotice(''), 4000);
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const toggleIn = (key, value) =>
    setForm((f) => {
      const list = f[key] || [];
      return { ...f, [key]: list.includes(value) ? list.filter((x) => x !== value) : [...list, value] };
    });

  return (
    <>
      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{notice}</Alert>
      <Alert kind="info">
        Subscribers are stored here only. Point every Flussonic server at this panel as its authorization backend
        (Settings page) and one account works on all of them.
      </Alert>

      <div className="card">
        <div className="card-head">
          <h3>Subscribers ({users.length})</h3>
          <div className="spacer" />
          <button className="btn btn-primary btn-sm" onClick={openNew}>
            <Plus size={15} /> Add subscriber
          </button>
        </div>

        {loading ? (
          <div className="empty">
            <Loader2 size={26} className="spin" />
            <div>Loading…</div>
          </div>
        ) : users.length === 0 ? (
          <Empty
            title="No subscribers yet"
            hint="Create one account and hand the generated playlist link to your customer."
            action={
              <button className="btn btn-primary" onClick={openNew}>
                <Plus size={15} /> Add subscriber
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Status</th>
                  <th>Devices</th>
                  <th>Expires</th>
                  <th>Packages</th>
                  <th>Last seen</th>
                  <th style={{ width: 170 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{u.username}</div>
                      {u.note && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.note}</div>}
                    </td>
                    <td>
                      <StatusBadge status={u.expired ? 'expired' : u.status} />
                    </td>
                    <td>{u.maxConnections}</td>
                    <td className="mono">{u.expiresAt ? dateOnly(u.expiresAt) : 'never'}</td>
                    <td style={{ fontSize: 12.5 }}>
                      {(u.allowedCategories?.length || 0) === 0 ? (
                        <span style={{ color: 'var(--muted)' }}>All channels</span>
                      ) : (
                        u.allowedCategories.join(', ')
                      )}
                    </td>
                    <td className="mono">{dateTime(u.lastSeenAt)}</td>
                    <td>
                      <div className="btn-row">
                        <button className="btn btn-sm btn-icon" onClick={() => setDetail(u)} title="Playlist link">
                          <FileText size={14} />
                        </button>
                        <button className="btn btn-sm btn-icon" onClick={() => rotate(u)} title="New token">
                          <KeyRound size={14} />
                        </button>
                        <button className="btn btn-sm btn-icon" onClick={() => openEdit(u)} title="Edit">
                          <Pencil size={14} />
                        </button>
                        <button className="btn btn-sm btn-icon btn-danger" onClick={() => remove(u)} title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <Modal
          title={editing === 'new' ? 'Add subscriber' : 'Edit subscriber'}
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
                <label>Username *</label>
                <input value={form.username} onChange={set('username')} required disabled={editing !== 'new'} />
              </div>
              <div className="field">
                <label>Password</label>
                <input
                  value={form.password}
                  onChange={set('password')}
                  placeholder={editing === 'new' ? 'auto-generated if blank' : 'leave blank to keep'}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="field">
                <label>Max simultaneous devices</label>
                <input type="number" min="1" max="100" value={form.maxConnections} onChange={set('maxConnections')} />
              </div>
              <div className="field">
                <label>Expires on</label>
                <input type="date" value={form.expiresAt} onChange={set('expiresAt')} />
                <div className="help">Leave blank for no expiry.</div>
              </div>
              <div className="field">
                <label>Status</label>
                <select value={form.status} onChange={set('status')}>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label>Allowed categories</label>
              <div className="chips">
                {categories.length === 0 && <span style={{ color: 'var(--muted)', fontSize: 13 }}>No categories yet.</span>}
                {categories.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`chip ${form.allowedCategories.includes(c) ? 'on' : ''}`}
                    onClick={() => toggleIn('allowedCategories', c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="help">Select none to grant access to every channel.</div>
            </div>

            <div className="field">
              <label>Restrict to servers</label>
              <div className="chips">
                {servers.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className={`chip ${form.allowedServerIds.includes(s.id) ? 'on' : ''}`}
                    onClick={() => toggleIn('allowedServerIds', s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              <div className="help">Select none to allow all servers.</div>
            </div>

            <div className="field">
              <label>Note</label>
              <textarea value={form.note} onChange={set('note')} placeholder="Paid until March, contact +880…" />
            </div>
          </form>
        </Modal>
      )}

      {detail && (
        <Modal title={`Subscriber — ${detail.username}`} onClose={() => setDetail(null)} wide>
          <div className="field">
            <label>Playlist URL (give this to the customer)</label>
            <CopyField value={detail.playlistUrl} />
          </div>
          <div className="form-row">
            <div className="field">
              <label>Username</label>
              <CopyField value={detail.username} />
            </div>
            <div className="field">
              <label>Password</label>
              <CopyField value={detail.password} />
            </div>
          </div>
          <div className="field">
            <label>Playback token</label>
            <CopyField value={detail.token} />
          </div>
          <Alert kind="info">
            The playlist only contains channels this subscriber is entitled to, and every URL already carries their
            token.
          </Alert>
        </Modal>
      )}
    </>
  );
}
