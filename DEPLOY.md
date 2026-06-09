# Deployment Guide

This guide explains how to deploy untis-mcp on a Linux server so teachers can connect through [claude.ai](https://claude.ai) using the "Add custom connector" dialog.

There is no login form: access is gated by a secret token in the connector URL (`https://<host>/untis/<MCP_SECRET>`). You share that one URL with the teachers who should have access — no WebUntis credentials required on their end. Treat the URL like a password.

## Prerequisites

- A Linux server with a public domain name (e.g. `mcp.your-school.example.com`)
- Docker and Docker Compose installed
- Apache2 or Nginx with a valid TLS certificate (Let's Encrypt works fine)
- A WebUntis service account with API access
- Git

---

## 1. Create a deployment user

Run as root:

```bash
adduser --disabled-password mcp
usermod -aG docker mcp
```

Switch to that user for all remaining steps:

```bash
su - mcp
```

---

## 2. Clone the repository

```bash
git clone https://github.com/graphics80/untis-mcp.git
cd untis-mcp
```

---

## 3. Create the environment file

```bash
cp .env.production.example .env.production
nano .env.production
```

Fill in all values:

```env
# Shared WebUntis service account
WEBUNTIS_SCHOOL=BZZ
WEBUNTIS_BASE_URL=bzz.webuntis.com
WEBUNTIS_USERNAME=your_service_account
WEBUNTIS_PASSWORD=your_password

SCHOOL_TIMEZONE=Europe/Zurich

# Secret URL token — this IS the authentication. Anyone with the full URL
# https://<host>/untis/<MCP_SECRET> can use the server. Generate a fresh one:
#   uuidgen        # or:  openssl rand -hex 16
MCP_SECRET=paste-a-long-random-uuid-here

# Public HTTPS URL of this server (no trailing slash)
BASE_URL=https://mcp.your-school.example.com

PORT=3001
```

Keep `.env.production` private — never commit it. If you omit `MCP_SECRET`, the
server generates a random one at startup and prints it to the logs, but it changes
on every restart — set a stable value so the connector URL doesn't break.

---

## 4. Start the container

```bash
docker compose up -d --build
```

Verify it's running:

```bash
docker compose logs -f
curl http://localhost:3001/health
```

Expected: `{"status":"ok","school":"BZZ","activeSessions":0,"uptime":...}`

---

## 5. Configure the reverse proxy

The container only listens on `127.0.0.1:3001` and must be fronted by Apache or Nginx with TLS.

### Apache2

Enable required modules (once):

```bash
sudo a2enmod proxy proxy_http rewrite ssl headers
```

Create `/etc/apache2/sites-available/mcp.your-school.example.com.conf`:

```apache
<VirtualHost *:80>
    ServerName mcp.your-school.example.com
    RewriteEngine On
    RewriteRule ^(.*)$ https://%{HTTP_HOST}$1 [R=301,L]
</VirtualHost>

<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName mcp.your-school.example.com

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3001/ timeout=300 flushpackets=on
    ProxyPassReverse / http://127.0.0.1:3001/

    # Required for MCP streaming (Server-Sent Events)
    SetEnv proxy-nokeepalive 1

    # IMPORTANT: the connector URL contains MCP_SECRET in its path. The default
    # "combined" access log records the full request line, which would write that
    # secret to disk in plaintext. Redact the path for /untis/* requests.
    SetEnvIf Request_URI "^/untis/" mcp_secret_path
    LogFormat "%h %l %u %t \"%m /untis/<redacted> %H\" %>s %b \"%{Referer}i\" \"%{User-Agent}i\"" mcp_redacted
    CustomLog ${APACHE_LOG_DIR}/mcp_access.log combined env=!mcp_secret_path
    CustomLog ${APACHE_LOG_DIR}/mcp_access.log mcp_redacted env=mcp_secret_path

    ErrorLog ${APACHE_LOG_DIR}/mcp_error.log

    SSLCertificateFile /etc/letsencrypt/live/mcp.your-school.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/mcp.your-school.example.com/privkey.pem
    Include /etc/letsencrypt/options-ssl-apache.conf
</VirtualHost>
</IfModule>
```

Enable and reload:

```bash
sudo a2ensite mcp.your-school.example.com
sudo systemctl reload apache2
```

Get a TLS certificate if you don't have one:

```bash
sudo certbot --apache -d mcp.your-school.example.com
```

### Nginx (alternative)

```nginx
server {
    listen 80;
    server_name mcp.your-school.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name mcp.your-school.example.com;

    ssl_certificate /etc/letsencrypt/live/mcp.your-school.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mcp.your-school.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;           # required for SSE streaming
        proxy_read_timeout 300s;
    }
}
```

---

## 6. Verify the deployment

```bash
# Health check
curl https://mcp.your-school.example.com/health

# Wrong/missing secret returns 404 (endpoint is not advertised)
curl -si https://mcp.your-school.example.com/untis -X POST \
  -H 'Content-Type: application/json' -d '{}'

# The real connector URL (with the secret) accepts an MCP initialize.
# A non-initialize POST without a session id returns 400 — that's expected and
# confirms the secret is accepted:
curl -si https://mcp.your-school.example.com/untis/<MCP_SECRET> -X POST \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

---

## 7. Connect in claude.ai

1. Open [claude.ai](https://claude.ai) → Settings → Connectors
2. Click **Add custom connector**
3. Enter the full MCP URL **including the secret**: `https://mcp.your-school.example.com/untis/<MCP_SECRET>`
4. Leave the OAuth/Advanced settings empty — this server is authless
5. Click **Add** — the Untis tools are now available in Claude

Share that one URL with each teacher who should have access. Anyone with the URL is in, so distribute it over a private channel and never paste it anywhere public.

---

## Managing access / rotating the secret

The secret URL is the only credential. To revoke everyone (e.g. it leaked), change `MCP_SECRET` and restart:

```bash
nano /home/mcp/untis-mcp/.env.production
# Set MCP_SECRET to a fresh value:  uuidgen

docker compose restart   # no rebuild needed
```

Every teacher must then update their connector URL to the new secret. There are no per-teacher accounts: access is all-or-nothing on the shared URL.

---

## Updating the server

```bash
cd /home/mcp/untis-mcp
git pull origin main
docker compose up -d --build
```

The connector URL is unchanged across restarts as long as `MCP_SECRET` stays the same. Active MCP sessions are in-memory, so clients transparently re-initialize after a restart — no teacher action needed.

---

## Logs and monitoring

```bash
# Live logs
docker compose logs -f

# Health endpoint
curl http://localhost:3001/health
# Returns: { status, school, activeSessions, uptime }

# Restart the container
docker compose restart

# Stop completely
docker compose down
```

---

## Security notes

- The path secret (`MCP_SECRET`) **is** the authentication — anyone with the full URL has full read access. Treat it like a password: distribute privately, serve only over HTTPS.
- **Keep the secret out of logs.** The reverse-proxy access log redacts the `/untis/*` path (see the Apache `mcp_redacted` `LogFormat` above) — verify your config does the same before going live, and check the app/container logs don't echo full URLs.
- `.env.production` is never committed — keep it only on the server.
- The secret comparison uses `timingSafeEqual` to prevent timing attacks; a wrong secret returns a flat `404`.
- Each MCP client connection gets its own WebUntis session, swept after 24h idle. WebUntis session expiry is handled transparently with auto-reconnect.
- The container runs as a non-root `node` user.
- This model has **no per-teacher accounts and no individual revocation** — to revoke access you rotate `MCP_SECRET`, which logs everyone out. If you need per-user auth or audit trails, keep the OAuth-based model instead.
