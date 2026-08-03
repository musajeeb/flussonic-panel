import React, { useState } from 'react';
import api, { errMsg } from '../lib/api';
import { Alert, CopyField } from '../components/ui';
import { Loader2 } from 'lucide-react';

export default function Settings({ user }) {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const backendUrl = `${window.location.origin}/api/auth-backend?key=YOUR_AUTH_BACKEND_KEY`;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (newPassword !== confirm) return setError('The two new passwords do not match');
    if (newPassword.length < 8) return setError('New password must be at least 8 characters');
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setNotice('Password changed.');
      setCurrent('');
      setNew('');
      setConfirm('');
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h3>Connect your Flussonic servers to this panel</h3>
        </div>
        <div className="card-body">
          <p style={{ marginTop: 0, color: 'var(--muted)' }}>
            Do this once per server so a subscriber created here works everywhere, without creating them on each box.
          </p>
          <ol style={{ paddingLeft: 18, lineHeight: 1.9 }}>
            <li>Open the Flussonic web UI → <b>Config → Auth backends</b>.</li>
            <li>Add a backend and paste the URL below (replace the key with your <code>AUTH_BACKEND_KEY</code> from <code>.env</code>).</li>
            <li>On <b>Config → Settings</b>, make sure the API is enabled on the port you registered in this panel.</li>
            <li>Apply the auth backend to the streams or templates you want protected.</li>
          </ol>
          <div className="field">
            <label>Authorization backend URL</label>
            <CopyField value={backendUrl} />
          </div>
          <Alert kind="warn">
            Flussonic must be able to reach this panel over the network. If it is behind NAT, set <code>PUBLIC_URL</code>{' '}
            in <code>.env</code> and open the port.
          </Alert>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Change panel password</h3>
        </div>
        <div className="card-body">
          <Alert kind="error">{error}</Alert>
          <Alert kind="ok">{notice}</Alert>
          <form onSubmit={submit} style={{ maxWidth: 420 }}>
            <div className="field">
              <label>Signed in as</label>
              <input value={user?.email || ''} readOnly />
            </div>
            <div className="field">
              <label>Current password</label>
              <input type="password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
            </div>
            <div className="field">
              <label>New password</label>
              <input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} required autoComplete="new-password" />
            </div>
            <div className="field">
              <label>Confirm new password</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
            </div>
            <button className="btn btn-primary" disabled={busy}>
              {busy && <Loader2 size={15} className="spin" />}
              Change password
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
