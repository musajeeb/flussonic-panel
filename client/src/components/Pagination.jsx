import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZES = [25, 50, 100, 250];

/**
 * Client-side paging for the channel and server tables.
 *
 * Returns the visible slice plus the control to render underneath it. Paging is
 * done here rather than on the server because both lists are already assembled
 * in one response (the channel list merges panel records with live streams), so
 * a second round trip per page would only add latency.
 */
export function usePagination(items, { defaultSize = 25, resetKey = '' } = {}) {
  const [size, setSize] = useState(defaultSize);
  const [page, setPage] = useState(1);

  const total = items.length;
  const pageCount = size === 'all' ? 1 : Math.max(1, Math.ceil(total / size));

  // A filter change must not leave you stranded on a page that no longer exists.
  useEffect(() => {
    setPage(1);
  }, [resetKey, size]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const visible = useMemo(() => {
    if (size === 'all') return items;
    const start = (page - 1) * size;
    return items.slice(start, start + size);
  }, [items, page, size]);

  const from = total === 0 ? 0 : size === 'all' ? 1 : (page - 1) * size + 1;
  const to = size === 'all' ? total : Math.min(total, page * size);

  return { visible, page, setPage, size, setSize, pageCount, total, from, to };
}

export function Pagination({ state, label = 'items' }) {
  const { page, setPage, size, setSize, pageCount, total, from, to } = state;
  if (total === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '12px 16px',
        borderTop: '1px solid var(--border)',
        fontSize: 13,
        color: 'var(--muted)',
      }}
    >
      <span>
        Showing <b style={{ color: 'var(--text)' }}>{from}</b>–<b style={{ color: 'var(--text)' }}>{to}</b> of{' '}
        <b style={{ color: 'var(--text)' }}>{total}</b> {label}
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        Per page
        <select
          value={size}
          onChange={(e) => setSize(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          style={{ width: 'auto', padding: '5px 8px' }}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value="all">All</option>
        </select>
      </span>

      <div className="spacer" style={{ flex: 1 }} />

      {pageCount > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="btn btn-sm btn-icon" onClick={() => setPage(1)} disabled={page === 1} title="First page">
            «
          </button>
          <button className="btn btn-sm btn-icon" onClick={() => setPage(page - 1)} disabled={page === 1}>
            <ChevronLeft size={14} />
          </button>
          <span style={{ minWidth: 92, textAlign: 'center' }}>
            Page <b style={{ color: 'var(--text)' }}>{page}</b> of {pageCount}
          </span>
          <button className="btn btn-sm btn-icon" onClick={() => setPage(page + 1)} disabled={page === pageCount}>
            <ChevronRight size={14} />
          </button>
          <button
            className="btn btn-sm btn-icon"
            onClick={() => setPage(pageCount)}
            disabled={page === pageCount}
            title="Last page"
          >
            »
          </button>
        </div>
      )}
    </div>
  );
}
