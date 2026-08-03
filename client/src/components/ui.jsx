import React, { useEffect } from 'react';
import { X, Inbox } from 'lucide-react';

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { maxWidth: 720 } : undefined} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <div className="spacer" />
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function StatusBadge({ status }) {
  const map = {
    online: ['badge-ok', 'Online'],
    offline: ['badge-bad', 'Offline'],
    unknown: ['badge-idle', 'Not checked'],
    synced: ['badge-ok', 'Synced'],
    pending: ['badge-warn', 'Pending'],
    error: ['badge-bad', 'Error'],
    active: ['badge-ok', 'Active'],
    suspended: ['badge-bad', 'Suspended'],
    expired: ['badge-warn', 'Expired'],
  };
  const [cls, label] = map[status] || ['badge-idle', status || '—'];
  return (
    <span className={`badge ${cls}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

export function Empty({ title, hint, action }) {
  return (
    <div className="empty">
      <Inbox size={34} />
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {hint && <div style={{ fontSize: 13 }}>{hint}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function Alert({ kind = 'info', children }) {
  if (!children) return null;
  return <div className={`alert alert-${kind}`}>{children}</div>;
}

export function Meter({ label, value, right }) {
  const pct = Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : null;
  const cls = pct === null ? '' : pct >= 90 ? 'crit' : pct >= 80 ? 'warn' : '';
  return (
    <div className="meter">
      <div className="meter-row">
        <span>{label}</span>
        <b>{right ?? (pct === null ? '—' : `${pct.toFixed(0)}%`)}</b>
      </div>
      <div className="meter-bar">
        <div className={`meter-fill ${cls}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
    </div>
  );
}

export function CopyField({ value }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="copy-row">
      <input readOnly value={value} onFocus={(e) => e.target.select()} />
      <button
        className="btn btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
          } catch {
            /* clipboard blocked (e.g. plain http) — the field is selectable as a fallback */
          }
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
