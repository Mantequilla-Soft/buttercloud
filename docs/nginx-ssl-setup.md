# Nginx + SSL Setup for Buttercloud

This guide walks through pointing a domain at your Buttercloud instance, terminating HTTPS with Let's Encrypt, and proxying traffic to the Node.js backend.

The examples use `s3.3speak.tv` — replace it with your own domain throughout.

---

## Prerequisites

- A VPS with a public IP address
- DNS: an `A` record for `s3.3speak.tv` pointing to that IP (allow 5–15 min to propagate)
- Buttercloud running on its local port (e.g. `3000`) — confirmed with `systemctl status buttercloud`
- Ports `80` and `443` open in your firewall

---

## 1. Install Nginx and Certbot

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

---

## 2. Create the Nginx site config

Create `/etc/nginx/sites-available/buttercloud`:

```nginx
server {
    listen 80;
    server_name s3.3speak.tv;

    # Certbot will fill in the HTTPS redirect automatically.
    # Leave this block in place — certbot modifies it in step 3.
}
```

Enable it and reload:

```bash
sudo ln -s /etc/nginx/sites-available/buttercloud /etc/nginx/sites-enabled/buttercloud
sudo nginx -t && sudo systemctl reload nginx
```

---

## 3. Obtain an SSL certificate

```bash
sudo certbot --nginx -d s3.3speak.tv
```

Certbot will:
1. Verify domain ownership via HTTP
2. Issue a Let's Encrypt certificate
3. **Automatically rewrite your config** to add HTTPS and the HTTP → HTTPS redirect

Accept the prompts and let it finish. Your cert lives at:
```
/etc/letsencrypt/live/s3.3speak.tv/fullchain.pem
/etc/letsencrypt/live/s3.3speak.tv/privkey.pem
```

Certbot installs a cron job / systemd timer that auto-renews before expiry. Verify it:

```bash
sudo certbot renew --dry-run
```

---

## 4. Add the proxy configuration

After certbot runs, your config will look roughly like this. **Replace the contents** of `/etc/nginx/sites-available/buttercloud` with the full production config below:

```nginx
# HTTP → HTTPS redirect
server {
    listen 80;
    server_name s3.3speak.tv;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name s3.3speak.tv;

    # ── SSL (managed by Certbot) ───────────────────────────────────────
    ssl_certificate     /etc/letsencrypt/live/s3.3speak.tv/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/s3.3speak.tv/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    # ── Upload size ────────────────────────────────────────────────────
    # Must be at least as large as your largest plan's max object size.
    # Enterprise plan allows 50 GB — set generously and let Buttercloud
    # enforce per-plan limits in software.
    client_max_body_size 55G;

    # ── Timeouts (critical for large uploads) ─────────────────────────
    proxy_connect_timeout       60s;
    proxy_send_timeout          600s;   # 10 min — for slow uploaders
    proxy_read_timeout          600s;
    send_timeout                600s;

    # ── Proxy to Buttercloud ───────────────────────────────────────────
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Connection        "";

        # Disable buffering for streaming downloads and large uploads.
        # With buffering on, Nginx would hold the entire file in memory/disk
        # before forwarding — that breaks large transfers.
        proxy_buffering    off;
        proxy_request_buffering off;
    }
}
```

> **Change `3000`** to whatever port Buttercloud is actually running on. Check your `.env` or run `systemctl status buttercloud` to confirm.

Test and reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 5. Update your .env

Tell Buttercloud its public URL so emails and links are generated correctly:

```env
APP_URL=https://s3.3speak.tv
```

Then restart the service:

```bash
sudo systemctl restart buttercloud
```

---

## 6. Verify

```bash
# Should return the Buttercloud portal HTML
curl -I https://s3.3speak.tv

# Should return the S3 XML listing response
curl -I https://s3.3speak.tv/ \
  -H "Authorization: AWS4-HMAC-SHA256 ..."  # use a real key for a real test
```

A quick sanity check from your local machine using the AWS CLI:

```bash
aws s3 ls s3://your-bucket/ \
  --endpoint-url https://s3.3speak.tv \
  --no-verify-ssl   # remove this once cert is confirmed working
```

---

## 7. Firewall (ufw)

If you use `ufw`, allow only the ports Nginx needs publicly. Keep MinIO and MongoDB internal:

```bash
sudo ufw allow 'Nginx Full'   # 80 + 443
sudo ufw deny 9000             # MinIO — internal only
sudo ufw enable
```

---

## Troubleshooting

| Symptom | Check |
|---|---|
| 502 Bad Gateway | `systemctl status buttercloud` — is the app running? |
| 413 Request Entity Too Large | Increase `client_max_body_size` in Nginx config |
| Upload times out | Increase `proxy_send_timeout` and `proxy_read_timeout` |
| SSL cert expired | `sudo certbot renew` — auto-renewal should handle this |
| Logs | `journalctl -u buttercloud -f` and `tail -f /var/log/nginx/error.log` |
