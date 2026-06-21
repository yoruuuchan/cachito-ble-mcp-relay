# VPS deployment for the MCP Android BLE relay

Goal:

- Claude or ChatGPT calls the VPS over HTTPS MCP at https://<DOMAIN>/mcp.
- Android connects outward to the VPS over WSS at wss://<DOMAIN>/phone/ws.
- The phone stays near the device and performs BLE legacy advertisements.
- The desktop computer is not in the runtime path.

This is still a private prototype. Do not expose it without tokens.

## Required public endpoints

- Public health: GET https://<DOMAIN>/healthz
- MCP: POST https://<DOMAIN>/mcp with Authorization: Bearer <MCP_TOKEN>
- Phone WebSocket: wss://<DOMAIN>/phone/ws with PHONE_TOKEN in the Android app
- Phone status: GET https://<DOMAIN>/phone/status with Authorization: Bearer <MCP_TOKEN>

The public /healthz endpoint only returns server liveness. It does not expose phone status, last command, last ack, tokens, or UUIDs.

## Generate production tokens

Do not reuse local test tokens or any other values that have been written into developer machines, dotfiles, or chat logs.

Generate fresh tokens on the VPS:

~~~bash
openssl rand -hex 32
openssl rand -hex 32
~~~

Use one value as MCP_TOKEN and the other as PHONE_TOKEN.

## Server environment

Create /etc/cachito-ble.env:

~~~bash
sudo install -m 600 -o root -g root /dev/null /etc/cachito-ble.env
sudo tee /etc/cachito-ble.env >/dev/null <<'EOF'
MCP_TOKEN=replace-with-new-production-mcp-token
PHONE_TOKEN=replace-with-new-production-phone-token
ALLOW_HIGH_LEVELS=false
PORT=3000
HOST=127.0.0.1
PUBLIC_BASE_URL=https://<DOMAIN>
EOF
~~~

Replace both token values before starting the service.

## Copy and build the project

Example layout:

~~~bash
sudo mkdir -p /opt/cachito-ble
sudo chown -R "$USER":"$USER" /opt/cachito-ble
~~~

Copy this project to /opt/cachito-ble on the VPS, then build the server:

~~~bash
cd /opt/cachito-ble/server
npm ci
npm run build
npm test
~~~

If package-lock.json is not present on the VPS, use npm install instead of npm ci.

## systemd service

Create /etc/systemd/system/cachito-ble.service:

~~~ini
[Unit]
Description=Cachito BLE MCP relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/cachito-ble/server
ExecStart=/usr/bin/node dist/index.js
EnvironmentFile=/etc/cachito-ble.env
Restart=always
RestartSec=3
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
~~~

Make sure /opt/cachito-ble is readable by the service user. Then start it:

~~~bash
sudo systemctl daemon-reload
sudo systemctl enable --now cachito-ble
sudo systemctl status cachito-ble --no-pager
journalctl -u cachito-ble -f
~~~

The Node service should listen only on 127.0.0.1:3000. Caddy owns the public HTTPS and WSS entry.

## Caddy reverse proxy

Install Caddy and add this site:

~~~caddy
ble.example.com {
    reverse_proxy 127.0.0.1:3000
}
~~~

Reload Caddy:

~~~bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
~~~

Caddy handles HTTPS certificates and WebSocket upgrade automatically for this reverse proxy.

## Deployment acceptance checks

Use the real domain and production tokens:

~~~bash
curl https://ble.example.com/healthz
curl -H "Authorization: Bearer $MCP_TOKEN" https://ble.example.com/phone/status
~~~

Android app:

- Server WebSocket URL: wss://ble.example.com/phone/ws
- Phone token: PHONE_TOKEN from /etc/cachito-ble.env
- Keep Pairing ID as 5002 unless your device uses a different pairing ID.
- Keep the app in the foreground near the BLE device.

After the Android app connects:

~~~bash
curl -H "Authorization: Bearer $MCP_TOKEN" https://ble.example.com/phone/status
~~~

The response should include phone_online:true.

Remote MCP clients:

- MCP endpoint: https://ble.example.com/mcp
- Header: Authorization: Bearer <MCP_TOKEN>

Run get_status first, then stop_all. For a full control check, call:

1. get_status
2. stop_all(duration_ms=2000)
3. set_suction(level=10, duration_ms=2000)
4. stop_all(duration_ms=2000)
5. set_vibration(level=10, duration_ms=2000)
6. stop_all(duration_ms=2000)

Neutral aliases are also available:

- set_channel_a(level, duration_ms?) maps to set_suction
- set_channel_b(level, duration_ms?) maps to set_vibration

The aliases keep the same level limit, duration limit, phone timeout behavior, and stop_all safety behavior.

## Security notes

- /mcp requires Authorization: Bearer MCP_TOKEN.
- /phone/ws requires PHONE_TOKEN.
- /phone/status and /status require Authorization: Bearer MCP_TOKEN.
- /healthz is intentionally public and only returns server alive.
- HOST should stay 127.0.0.1 in production.
- Do not add raw_uuid, arbitrary_uuid, or any user-supplied UUID broadcast tool.
- Keep ALLOW_HIGH_LEVELS=false unless you explicitly need levels above 50.
