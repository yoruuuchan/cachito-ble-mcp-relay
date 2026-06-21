# Private MCP Android BLE Broadcaster MVP setup

This is a private prototype. The control chain is:

ChatGPT or Claude -> HTTPS MCP server on a VPS -> Android phone WebSocket connection -> Android BLE legacy non-connectable advertisement -> nearby BLE broadcast-controlled device.

The phone does not need a public IP. Do not expose the server without tokens.

## Server

Install and build:

~~~bash
cd server
npm install
npm run build
~~~

Start:

~~~bash
MCP_TOKEN='replace-with-long-random-token' \
PHONE_TOKEN='replace-with-long-random-token' \
ALLOW_HIGH_LEVELS=false \
PORT=3000 \
npm start
~~~

Required environment variables:

- MCP_TOKEN: bearer token required for /mcp.
- PHONE_TOKEN: token required for /phone/ws.
- ALLOW_HIGH_LEVELS: set to true only when MCP tools may use levels above 50.
- PORT: HTTP listen port. The default used by examples is 3000.

Optional:

- PAIRING_ID: server-side UUID preview pairing ID. Defaults to 5002. The Android app also has a Pairing ID field and generates the UUID it actually advertises.

Endpoints:

- GET /health
- GET /healthz
- GET /status
- GET /phone/status
- WS /phone/ws
- POST /mcp for stateless Streamable HTTP MCP

/status and /phone/status require Authorization: Bearer <MCP_TOKEN>. /health and /healthz only report server liveness.

The WebSocket token can be sent either as an authorization header:

~~~text
Authorization: Bearer <PHONE_TOKEN>
~~~

or as a query parameter:

~~~text
wss://example.com/phone/ws?token=<PHONE_TOKEN>
~~~

## Android debug app

Build:

~~~bash
cd android
./gradlew assembleDebug
~~~

Install:

~~~bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
~~~

Use:

1. Open the app.
2. Enter the server WebSocket URL, for example wss://example.com/phone/ws.
3. Enter PHONE_TOKEN.
4. Keep Pairing ID as 5002 unless your device uses a different pairing ID.
5. Tap Connect.
6. Grant the Android 12+ Nearby devices Bluetooth permissions when prompted.
7. Keep the app in the foreground and place the phone near the BLE-controlled device.

The app does not connect to the device with GATT. It only sends one 128-bit Service UUID in a BLE legacy non-connectable advertisement for each whitelisted command. It has no arbitrary UUID input.

## Reverse proxy

The public MCP URL must be HTTPS. The phone should use WSS.

Minimal Nginx shape:

~~~nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
~~~

Minimal Caddy shape:

~~~caddy
example.com {
    reverse_proxy 127.0.0.1:3000
}
~~~

Caddy handles HTTPS and WebSocket upgrade automatically in the normal reverse proxy path.

## Claude Desktop / Claude Code

Configure a remote HTTP MCP server:

- URL: https://example.com/mcp
- Transport: Streamable HTTP
- Header: Authorization: Bearer <MCP_TOKEN>

The server exposes these tools:

- set_suction(level, duration_ms?)
- set_vibration(level, duration_ms?)
- stop_suction(duration_ms?)
- stop_vibration(duration_ms?)
- stop_all(duration_ms?)
- get_status()

If your Claude client only supports stdio MCP, place a small local proxy in front of this HTTPS MCP endpoint or use a client version that supports remote Streamable HTTP MCP.

### Claude Desktop GUI local stdio mode

Claude Desktop can also start an all-in-one local stdio entry. In this mode, stop the old npm start process first so port 3000 is free. Claude Desktop starts one Node process that owns both:

- phone WebSocket relay: /phone/ws
- phone status: /phone/status
- stdio MCP tools: get_status, stop_all, set_suction, set_vibration, stop_suction, stop_vibration

Build before configuring Claude Desktop:

~~~powershell
cd <path-to-repo>\server
npm run build
~~~

Edit this file:

~~~text
%APPDATA%\Claude\claude_desktop_config.json
~~~

Example config:

~~~json
{
  "mcpServers": {
    "cachito-ble": {
      "command": "node",
      "args": [
        "<absolute-path-to-repo>\\server\\dist\\desktop-stdio.js"
      ],
      "env": {
        "MCP_TOKEN": "replace-with-mcp-token",
        "PHONE_TOKEN": "replace-with-phone-token",
        "PORT": "3000",
        "ALLOW_HIGH_LEVELS": "false"
      }
    }
  }
}
~~~

After restarting Claude Desktop:

~~~powershell
adb reverse tcp:3000 tcp:3000
curl -H "Authorization: Bearer <MCP_TOKEN>" http://127.0.0.1:3000/phone/status
~~~

Then connect the Android app to ws://127.0.0.1:3000/phone/ws and call get_status or stop_all from Claude Desktop.

## ChatGPT custom MCP app

Create a private custom MCP connector/app with:

- MCP server URL: https://example.com/mcp
- Authorization header: Bearer <MCP_TOKEN>

Keep it private. Do not configure this as an unauthenticated public connector.

## Safety boundaries

- Never expose the MCP endpoint without MCP_TOKEN.
- Never expose the phone WebSocket without PHONE_TOKEN.
- Do not add arbitrary_uuid, raw_uuid, or any tool that broadcasts user-supplied UUIDs.
- Keep stop_all available.
- The default high-level safety cap is 50. Levels above 50 return level_too_high unless ALLOW_HIGH_LEVELS=true.
- This is a private prototype, not a public service or app-store app.

## Tests

Run protocol and validation tests:

~~~bash
cd server
npm test
~~~

The tests cover:

- suction level 34 UUID: 710002db-0400-5002-0302-2200000000cb
- vibration level 34 UUID: 710002f8-0400-5002-050a-2200000000f2
- stop_suction UUID: 710002df-0400-5002-0302-0000000000ad
- stop_vibration UUID: 710002ed-0400-5002-0601-0000000000bd
- invalid level and duration failures
- level_too_high when ALLOW_HIGH_LEVELS is not enabled

## Current verification status

Verified in this workspace:

- npm test
- npm run build

Not verified in this workspace:

- ./gradlew assembleDebug, because this WSL environment currently has no java executable.
- Real BLE advertisement on Android hardware.
- End-to-end MCP client -> VPS -> phone -> BLE device behavior.
