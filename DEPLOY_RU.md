# Deploy to a Russian VPS

This guide deploys Planner to one Russian VPS under one HTTPS domain:

```text
https://planner.example.ru        -> Caddy -> apps/web/dist
https://planner.example.ru/api/*  -> Caddy -> Fastify API on 127.0.0.1:3001
```

The current production path still uses Supabase for Auth and Postgres. That is
acceptable for a fast launch, but browser sign-in still depends on `supabase.co`.
For a strict Russia-only runtime, replace Supabase Auth with backend-owned auth
and move Postgres to a Russian provider.

## 1. Local checks

Run these before deploying:

```bash
npm run typecheck
npm run test:run
npm run build
```

Commit and push the deployable state to GitHub/GitLab before pulling it on the
server.

## 2. VPS baseline

Recommended first server:

```text
Ubuntu 24.04
2 vCPU
4 GB RAM
40 GB NVMe
Region: Russia
```

Providers that fit this setup: Timeweb Cloud, Selectel, Yandex Cloud, VK Cloud.

Create a DNS `A` record:

```text
planner.example.ru -> <server-ip>
```

Then connect to the server:

```bash
ssh root@<server-ip>
```

Install system packages:

```bash
apt update && apt upgrade -y
apt install -y curl git ufw caddy
```

Install Node.js 24:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
node -v
npm -v
```

Enable the firewall:

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
```

Create the application user and directories:

```bash
useradd --system --create-home --shell /usr/sbin/nologin planner
mkdir -p /opt/planner /etc/planner /var/lib/planner/icon-assets
chown -R planner:planner /opt/planner /var/lib/planner
chmod 750 /etc/planner
```

## 3. Pull the project

Clone the repository:

```bash
cd /opt
sudo -u planner git clone <repo-url> planner
cd /opt/planner
sudo -u planner npm ci
```

For a private repository, use a GitHub/GitLab deploy key or a personal access
token with read-only repository access.

## 4. Configure production env

Create the API env file:

```bash
cp /opt/planner/.env.production.example /etc/planner/planner.env
nano /etc/planner/planner.env
```

Set these values:

```bash
API_CORS_ORIGIN=https://planner.example.ru
DATABASE_URL=<resolved runtime database url>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable key>
SUPABASE_JWT_SECRET=<jwt secret, if configured>
```

To resolve the current Supabase runtime URL locally, run this on your Mac from
the project directory:

```bash
node --env-file=.env.supabase.local -e "import('./scripts/supabase-utils.mjs').then((m) => console.log(m.getSupabaseRuntimeDatabaseUrl()))"
```

Paste the printed value into `DATABASE_URL` on the server.

Keep `/etc/planner/planner.env` private:

```bash
chown root:planner /etc/planner/planner.env
chmod 640 /etc/planner/planner.env
```

## 5. Build the web app

Build with production browser variables:

```bash
cd /opt/planner
sudo -u planner env \
  VITE_API_BASE_URL=https://planner.example.ru \
  VITE_SUPABASE_URL=https://<project-ref>.supabase.co \
  VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key> \
  npm run build
```

The build output must exist at:

```text
/opt/planner/apps/web/dist
```

## 6. Start the API with systemd

Install the service:

```bash
cp /opt/planner/deploy/systemd/planner-api.service /etc/systemd/system/planner-api.service
systemctl daemon-reload
systemctl enable --now planner-api
```

Check it:

```bash
systemctl status planner-api
curl http://127.0.0.1:3001/api/health
```

Logs:

```bash
journalctl -u planner-api -f
```

## 7. Configure Caddy

Install the Caddy config:

```bash
cp /opt/planner/deploy/caddy/Caddyfile /etc/caddy/Caddyfile
nano /etc/caddy/Caddyfile
```

Replace every `planner.example.ru` with your real domain.

Validate and reload:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Caddy will automatically request and renew HTTPS certificates after DNS points
to the server.

Check through the public domain:

```bash
curl https://planner.example.ru/api/health
```

Then open:

```text
https://planner.example.ru
```

## 8. Configure Supabase Auth redirects

In Supabase Dashboard:

1. Open `Authentication`.
2. Open `URL Configuration`.
3. Set `Site URL` to `https://planner.example.ru`.
4. Add `https://planner.example.ru/**` to `Redirect URLs`.
5. Keep local URLs for development if needed:

```text
http://localhost:5173/**
http://127.0.0.1:5173/**
```

Save the settings.

## 9. Update an existing deploy

```bash
cd /opt/planner
sudo -u planner git pull --ff-only
sudo -u planner npm ci
sudo -u planner env \
  VITE_API_BASE_URL=https://planner.example.ru \
  VITE_SUPABASE_URL=https://<project-ref>.supabase.co \
  VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key> \
  npm run build
systemctl restart planner-api
systemctl reload caddy
```

## 10. Troubleshooting

API does not start:

```bash
journalctl -u planner-api -n 100 --no-pager
```

API works locally but not publicly:

```bash
curl http://127.0.0.1:3001/api/health
curl https://planner.example.ru/api/health
systemctl status caddy
```

HTTPS certificate does not issue:

```bash
dig +short planner.example.ru
caddy validate --config /etc/caddy/Caddyfile
journalctl -u caddy -n 100 --no-pager
```

Sign-in redirects to the wrong URL:

Check Supabase `Authentication -> URL Configuration` and rebuild the web app
with the correct `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and
`VITE_API_BASE_URL`.
