process.env.DB_DRIVER = 'memory';
process.env.NODE_ENV = 'test';
process.env.LOG_REQUESTS = 'false';
process.env.MONITOR_ENABLED = 'false';
process.env.JWT_SECRET = 'test-secret';
process.env.ENCRYPTION_KEY = 'test-encryption-key';
process.env.ADMIN_EMAIL = 'sajeeb809@live.com';
process.env.ADMIN_PASSWORD = 'musajeeb';
process.env.AUTH_BACKEND_KEY = 'test-backend-key';

const { initDb, ensureAdmin } = await import('../server/db/index.js');
const { createApp } = await import('../server/app.js');

export async function startPanel() {
  await initDb({ driver: 'memory' });
  await ensureAdmin();
  const app = createApp({ serveClient: false });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function req(method, path, { body, token, headers = {}, raw = false } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON — raw callers use `text` */
    }
    return { status: res.status, body: json, text, headers: res.headers, raw };
  }

  return {
    base,
    req,
    close: () => new Promise((r) => server.close(r)),
  };
}

export async function loginAsAdmin(panel) {
  const res = await panel.req('POST', '/api/auth/login', {
    body: { email: 'sajeeb809@live.com', password: 'musajeeb' },
  });
  if (res.status !== 200) throw new Error(`Login failed: ${res.text}`);
  return res.body.token;
}
