# Deployment Guide

This guide explains how to deploy untis-mcp on a Linux server so teachers can connect through [claude.ai](https://claude.ai) using the "Add custom connector" dialog.

Teachers authenticate with their existing **Microsoft O365 school account** — no extra passwords required.

## Prerequisites

- A Linux server with a public domain name (e.g. `mcp.your-school.example.com`)
- Docker and Docker Compose installed
- Apache2 or Nginx with a valid TLS certificate (Let's Encrypt works fine)
- A WebUntis service account with API access
- An Azure AD app registration (see step 1)
- Git

---

## 1. Configure Azure AD (Microsoft Entra ID)

You need an Azure AD app registration. If your school already has one for another app, you can reuse it — just add the new redirect URI.

### Add the redirect URI

In the [Azure portal](https://portal.azure.com) → App registrations → your app → **Authentication**:

- Add a **Web** redirect URI: `https://mcp.your-school.example.com/oauth/microsoft/callback`

That's all — client ID, secret, and tenant ID stay the same.

### Create a new app registration (if you don't have one)

1. Azure portal → App registrations → **New registration**
2. Name: `untis-mcp` (or similar)
3. Supported account types: **Accounts in this organizational directory only** (single tenant — restricts to your school)
4. Redirect URI: Web → `https://mcp.your-school.example.com/oauth/microsoft/callback`
5. After creation, go to **Certificates & secrets** → New client secret → copy the value immediately
6. Note the **Application (client) ID** and **Directory (tenant) ID** from the Overview page

---

## 2. Create a deployment user

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

## 3. Clone the repository

```bash
git clone https://github.com/graphics80/untis-mcp.git
cd untis-mcp
```

---

## 4. Create the environment file

```bash
cp .env.production.example .env.production
nano .env.production
```

Fill in all values:

```env
WEBUNTIS_SCHOOL=BZZ
WEBUNTIS_BASE_URL=bzz.webuntis.com
WEBUNTIS_USERNAME=your_service_account
WEBUNTIS_PASSWORD=your_password

SCHOOL_TIMEZONE=Europe/Zurich

AZURE_AD_CLIENT_ID=21c25dd0-...
AZURE_AD_CLIENT_SECRET=your_client_secret
AZURE_AD_TENANT_ID=12ea5aa9-...

BASE_URL=https://mcp.your-school.example.com

PORT=3001
```

Keep `.env.production` private — never commit it.

---

## 5. Start the container

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

## 6. Configure the reverse proxy

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

    ErrorLog ${APACHE_LOG_DIR}/mcp_error.log
    CustomLog ${APACHE_LOG_DIR}/mcp_access.log combined

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

## 7. Verify the deployment

```bash
# Health check
curl https://mcp.your-school.example.com/health

# OAuth discovery (claude.ai reads this automatically)
curl https://mcp.your-school.example.com/.well-known/oauth-authorization-server

# MCP endpoint should return 401 (auth required)
curl -si https://mcp.your-school.example.com/untis -X POST \
  -H 'Content-Type: application/json' -d '{}'
```

---

## 8. Connect in claude.ai

1. Open [claude.ai](https://claude.ai) → Settings → Integrations
2. Click **Add custom connector**
3. Enter the MCP URL: `https://mcp.your-school.example.com/untis`
4. Click **Connect** — claude.ai redirects to the Microsoft login page
5. Teacher logs in with their school O365 account
6. Done — the Untis tools are now available in Claude

Each teacher repeats steps 1–6 with their own O365 account.

### Access control

Access is controlled by the Azure AD app:
- **Single-tenant app** (recommended): only accounts from your school's tenant can log in — no configuration needed per teacher
- **To block specific users**: disable their O365 account in Entra ID (access is revoked immediately)
- **To restrict to a subset**: enable **User assignment required** on the app in Azure portal → Enterprise Applications, then assign only the teachers you want

---

## Updating the server

```bash
cd /home/mcp/untis-mcp
git pull origin main
docker compose up -d --build
```

Teachers will need to re-authenticate after a restart (tokens are in-memory).

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

- `.env.production` is never committed — keep it only on the server
- Access tokens are stored in memory hashed with SHA-256; raw tokens never persist
- Each teacher gets their own WebUntis session (one per access token), expires after 1 hour
- WebUntis session expiry is handled transparently with auto-reconnect
- The container runs as a non-root `node` user
- Single-tenant Azure AD ensures only your school's accounts can authenticate
