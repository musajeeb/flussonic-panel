import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Server, Tv, Users, Settings, LogOut, Menu } from 'lucide-react';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/servers', label: 'Servers', icon: Server, countKey: 'servers' },
  { to: '/channels', label: 'Channels', icon: Tv, countKey: 'channels' },
  { to: '/subscribers', label: 'Subscribers', icon: Users, countKey: 'subscribers' },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const TITLES = {
  '/': 'Dashboard',
  '/servers': 'Flussonic Servers',
  '/channels': 'Channels',
  '/subscribers': 'IPTV Subscribers',
  '/settings': 'Settings',
};

export default function Layout({ children, user, counts = {}, actions }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const logout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <strong>Flussonic CRM</strong>
          <span>Control Panel</span>
        </div>
        <nav className="nav">
          {NAV.map(({ to, label, icon: Icon, end, countKey }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setOpen(false)}
            >
              <Icon size={17} />
              {label}
              {countKey && counts[countKey] > 0 && <span className="badge-count">{counts[countKey]}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-user">{user?.email}</div>
          <button className="nav-item" onClick={logout} style={{ width: '100%' }}>
            <LogOut size={17} />
            Sign out
          </button>
        </div>
      </aside>

      <div className={`scrim ${open ? 'show' : ''}`} onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setOpen((v) => !v)} aria-label="Menu">
            <Menu size={20} />
          </button>
          <h2>{TITLES[pathname] || 'Flussonic CRM'}</h2>
          <div className="spacer" />
          {actions}
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
