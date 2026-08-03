export function bytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function bitrate(bps) {
  const n = Number(bps);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} Gbps`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} Mbps`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} Kbps`;
  return `${n} bps`;
}

export function percent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
}

export function uptime(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const d = Math.floor(n / 86400);
  const h = Math.floor((n % 86400) / 3600);
  const m = Math.floor((n % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : '—';
}

export function dateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function dateOnly(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}
