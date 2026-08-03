import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { errMsg } from '../lib/api';
import { Alert } from '../components/ui';
import { LogIn, Loader2 } from 'lucide-react';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('token', data.token);
      onLogin(data.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errMsg(err, 'Login failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>Flussonic CRM</h1>
        <p className="sub">Sign in to manage your servers</p>
        <Alert kind="error">{error}</Alert>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy} type="submit">
          {busy ? <Loader2 size={16} className="spin" /> : <LogIn size={16} />}
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
