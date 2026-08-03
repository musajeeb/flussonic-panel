# Flussonic CRM

One control panel for many Flussonic Media Servers.

Add a channel here and it is configured on the Flussonic server you pick. Create a
subscriber once and they work on every server, because the panel acts as the
authorization backend for all of them.

---

## Requirements

| | |
|---|---|
| Node.js | 18 or newer — <https://nodejs.org> (LTS) |
| MongoDB | local, or a free MongoDB Atlas cluster |
| Flussonic | any version with API v3 (21.x+). Older servers work for monitoring only |

---

## Install

```bash
unzip flussonic-crm.zip
cd flussonic-crm

cp .env.example .env      # then edit .env — see below
npm install               # installs the API, the front-end, and builds it
npm start
```

Open **http://localhost:5000** and sign in with the `ADMIN_EMAIL` and
`ADMIN_PASSWORD` from your `.env`.

`npm install` also installs and builds the front-end, so there is nothing to run
in a second terminal. `npm start` serves the panel and the API on one port.

### No MongoDB yet?

Set `DB_DRIVER=memory` in `.env` and run `npm start`. Everything works, but data
is lost when you stop the server. Switch to `DB_DRIVER=mongo` when you are ready.

---

## First run

**1 — Add a server** (Servers → Add server)

| Field | Value |
|---|---|
| Host / IP | the Flussonic machine, e.g. `203.0.113.10` |
| API port | usually `8080` |
| Admin user / password | from Flussonic → Config → Settings → **Access** |

Press **Check**. Green means the panel can read that server's CPU, RAM, disk,
bandwidth and stream count. The password is encrypted before it is stored and is
never sent back to the browser.

**2 — Add a channel** (Channels → Add channel)

Pick the target server, give the stream a name and a source URL. On save the panel
sends the configuration to that Flussonic server. If Flussonic refuses it, the row
shows **Error** with the reason — press the refresh icon to retry once fixed.

**3 — Connect the servers to the panel** (Settings)

Copy the authorization backend URL and add it on **every** Flussonic server under
**Config → Auth backends**, then apply it to your streams or templates.

**4 — Add a subscriber** (Subscribers → Add subscriber)

You get a playlist link to hand to the customer. It contains only the channels
they are entitled to, across all servers, with their token already in every URL.

---

## How the subscriber system works

```
Customer opens playlist
        │
        ▼
Flussonic server (any of them)
        │  "may token=abc watch btv_hd from 10.0.0.5?"
        ▼
Flussonic CRM  ──►  200 OK  + X-UserId + X-Max-Sessions
                    403     + reason (expired / suspended / not in package)
```

Because the decision is made here, a subscriber exists in one place. Suspending
them, changing their package or rotating their token takes effect on every server
immediately — no per-server work.

`X-Max-Sessions` is how the device limit is enforced: Flussonic itself cuts off
extra simultaneous streams.

---

## Hosting it

Any host that runs a Node.js process works — VPS, DigitalOcean, Railway, Render,
Heroku, or cPanel with "Setup Node.js App". Shared hosting that only serves PHP
will **not** work.

```bash
# on the server
cd /var/www/flussonic-crm
cp .env.example .env        # set NODE_ENV=production and real secrets
npm install
npm start
```

Keep it running with pm2:

```bash
npm install -g pm2
pm2 start server/index.js --name flussonic-crm
pm2 save && pm2 startup
```

Put nginx in front for HTTPS:

```nginx
server {
    listen 443 ssl;
    server_name panel.example.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then set `PUBLIC_URL=https://panel.example.com` in `.env` so playlist links are
correct.

**Before going live:** change `JWT_SECRET`, `ENCRYPTION_KEY`, `AUTH_BACKEND_KEY`
and your admin password. The panel warns in the log if you forget.

---

## API

Everything under `/api` except the two public endpoints needs
`Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | sign in |
| GET | `/api/auth/me` | current admin |
| POST | `/api/auth/change-password` | change panel password |
| GET | `/api/overview` | dashboard totals + per-server health |
| GET/POST | `/api/servers` | list / add server |
| PUT/DELETE | `/api/servers/:id` | edit / remove (`?force=true` to drop its channels) |
| POST | `/api/servers/:id/check` | live probe, stores stats |
| GET/POST | `/api/channels` | list / create (pushes to Flussonic) |
| PUT/DELETE | `/api/channels/:id` | edit / remove (also removes from Flussonic) |
| POST | `/api/channels/:id/sync` | re-send config to Flussonic |
| GET/POST | `/api/iptv-users` | list / create subscriber |
| PUT/DELETE | `/api/iptv-users/:id` | edit / remove |
| POST | `/api/iptv-users/:id/rotate-token` | new token, old link dies |
| GET/POST | `/api/auth-backend` | **public** — called by Flussonic |
| GET | `/playlist/:token.m3u` | **public** — customer playlist |
| GET | `/api/health` | uptime check |

---

## Development

```bash
npm run dev     # API on :5000 with reload, Vite on :5173 with hot reload
npm test        # 116 tests against simulated Flussonic servers
```

---

## Troubleshooting

**"Could not connect to the database"** — run `npm run check-db`. It inspects
your connection string character by character and tells you exactly what is
wrong: placeholders left in, a missing database name, a password with special
characters, an unreachable cluster, or a wrong Atlas password. Your password is
masked in its output, so it is safe to share.

For MongoDB Atlas the string must look like this, with **your** user, **your**
password and a database name added before the `?`:

```
MONGODB_URI=mongodb+srv://sajeeb:MyPass123@cluster0.5vocp5q.mongodb.net/flussonic-crm?retryWrites=true&w=majority
```

Also check Atlas → **Network Access** allows your IP (`0.0.0.0/0` while testing)
and Atlas → **Database Access** has the user you are using.

**CPU / RAM / disk / uptime are blank** — some Flussonic builds do not publish
server health over the JSON API. The panel tries the documented status paths, then
reads the server's own OpenAPI schema to look for others, then falls back to
Prometheus metrics. If all three come up empty the card says so and everything
else keeps working. Press **Diagnose** on the server card to see exactly which
endpoints answered.

**Server shows Offline** — one failed poll is not an outage; the panel waits for
three consecutive failures and keeps the last known readings on screen. The
message under the status says why. "Connection
refused" means the API port is closed or wrong. "Authentication failed" means the
admin user or password is wrong. "Host not found" means the address is wrong.

**Channel shows Error** — hover the message. `too old for API v3` means that
Flussonic predates the stream API and needs upgrading. Anything else is usually
Flussonic rejecting the source URL.

**Playback works without a token** — the auth backend is not applied to that
stream yet. Add it in Flussonic under Config → Auth backends and attach it to the
stream or its template.

**Port 5000 in use** — change `PORT` in `.env`.

**`EADDRINUSE` after a crash** — `pkill -f "server/index.js"` then start again.
