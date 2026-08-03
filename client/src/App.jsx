import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import api from './lib/api';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Servers from './pages/Servers';
import Channels from './pages/Channels';
import Subscribers from './pages/Subscribers';
import Settings from './pages/Settings';
import { Loader2 } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [counts, setCounts] = useState({});

  const mergeCounts = useCallback((partial) => {
    setCounts((prev) => {
      const next = { ...prev, ...partial };
      const changed = Object.keys(partial).some((k) => prev[k] !== partial[k]);
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return setReady(true);
    api
      .get('/auth/me')
      .then(({ data }) => setUser(data.user))
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <Loader2 size={30} className="spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login onLogin={setUser} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <Layout user={user} counts={counts}>
        <Routes>
          <Route path="/" element={<Dashboard onCounts={mergeCounts} />} />
          <Route path="/servers" element={<Servers onCounts={mergeCounts} />} />
          <Route path="/channels" element={<Channels onCounts={mergeCounts} />} />
          <Route path="/subscribers" element={<Subscribers onCounts={mergeCounts} />} />
          <Route path="/settings" element={<Settings user={user} />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
