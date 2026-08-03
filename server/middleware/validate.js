export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function badRequest(message, details) {
  return new HttpError(400, message, details);
}

/** Wraps an async route so rejected promises reach the error handler. */
export function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const STREAM_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._@-]{2,63}$/;

export function requireFields(body, fields) {
  const missing = fields.filter((f) => {
    const v = body?.[f];
    return v === undefined || v === null || String(v).trim() === '';
  });
  if (missing.length) throw badRequest(`Missing required field(s): ${missing.join(', ')}`, { missing });
}

/**
 * Stream names become part of a URL path on the Flussonic server, so we keep them
 * strict rather than trying to escape arbitrary input later.
 */
export function assertStreamName(name) {
  if (!STREAM_NAME_RE.test(String(name || ''))) {
    throw badRequest(
      'Channel name must start with a letter or digit and contain only letters, digits, dots, dashes or underscores (max 64 chars)'
    );
  }
  return String(name);
}

export function assertUsername(name) {
  if (!USERNAME_RE.test(String(name || ''))) {
    throw badRequest('Username must be 3-64 characters: letters, digits, dot, dash, underscore or @');
  }
  return String(name);
}

export function assertUrl(value, field = 'URL') {
  const str = String(value || '').trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(str)) {
    throw badRequest(`${field} must include a protocol, for example http://, https://, rtmp:// or udp://`);
  }
  return str;
}

export function assertHost(value) {
  const str = String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!str || /\s/.test(str)) throw badRequest('Host must be a hostname or IP address without spaces');
  return str;
}

export function assertPort(value, fallback = 8080) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw badRequest('Port must be an integer between 1 and 65535');
  return n;
}

export function errorHandler(err, req, res, _next) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;

  // An HttpError is deliberate — its message was written for the operator, so it
  // is shown even at 5xx. A 502 from an upstream Flussonic box is useless as
  // "Internal server error". Only genuine crashes are hidden.
  const deliberate = err instanceof HttpError;
  if (!deliberate && status >= 500) console.error('[error]', err);

  res.status(status).json({
    error: deliberate || status < 500 ? err.message : 'Internal server error',
    ...(err.details ? { details: err.details } : {}),
  });
}
