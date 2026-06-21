# AGENTS.md

给 Codex / Claude Code / 其它 agent 的操作说明。

## 项目目标

这是一个 MCP 到 Android BLE legacy advertisement 的 relay。

目标链路：

```text
MCP Client
→ HTTPS MCP endpoint
→ VPS Node relay
→ Android WebSocket
→ Android BLE advertisement
→ Cachito 失控 2.0
```

VPS 不负责蓝牙。Android 手机负责 BLE 广播。

## 目录

```text
server/
  Node.js MCP server
  WebSocket relay
  protocol builder
  tests / smoke scripts

android/
  Android BLE relay App

docs/
  setup / deploy docs
```

## 当前支持

已验证：

```text
Android App → WebSocket relay → BLE advertisement → Cachito 失控 2.0
```

未验证：

```text
iOS / iPhone relay
```

不要声称支持 iPhone。iOS 支持必须作为新功能单独开发和验收。

## 不要做的事

不要新增 raw UUID / arbitrary UUID 广播。

不要移除 `MCP_TOKEN` / `PHONE_TOKEN` 鉴权。

不要让 `/phone/status` 公网匿名可读。

不要把 `3000` 开到公网。

不要降低 level / duration 校验。

不要默认开启 `ALLOW_HIGH_LEVELS`。

不要改坏 `stop_all`。

不要把生产 token 写进 README、日志、报告或 issue。

不要擅自停 nginx、sing-box、Caddy 等已有服务。

## Server 环境变量

生产环境使用：

```env
HOST=127.0.0.1
PORT=3000
PUBLIC_BASE_URL=https://example.com
ALLOW_HIGH_LEVELS=false
MCP_TOKEN=<production secret>
PHONE_TOKEN=<production secret>
```

生成生产 token：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

## Server 验收

修改 server 后必须跑：

```bash
cd server
npm test
npm run build
```

本地检查：

```bash
curl http://127.0.0.1:3000/healthz
```

预期：

```json
{"ok":true}
```

匿名状态接口必须是 401：

```bash
curl http://127.0.0.1:3000/phone/status
```

带 token 状态接口：

```bash
source /etc/cachito-ble.env
curl -H "Authorization: Bearer $MCP_TOKEN" \
  http://127.0.0.1:3000/phone/status
```

## Android 验收

Android App 连接：

```text
ws://127.0.0.1:3000/phone/ws
```

或公网：

```text
wss://example.com/phone/ws
```

必须使用 `PHONE_TOKEN`。

手机连接后，授权状态接口应显示：

```json
"phone_online": true
```

修改 Android 后构建：

```bash
cd android
./gradlew assembleDebug
```

如果改了 BLE / WebSocket / 权限逻辑，需要真机安装测试。

## MCP tools

必须保留：

```text
get_status
stop_all
stop_suction
stop_vibration
set_suction
set_vibration
set_channel_a
set_channel_b
```

`set_channel_a` / `set_channel_b` 是中性别名，必须复用原有安全限制。

推荐 smoke 顺序：

```text
get_status
stop_all
set_channel_b level=10 duration_ms=2000
stop_all
```

如果 `get_status` 返回 `phone_online:false`，不要继续 active command。

## 部署策略

Node relay 默认只监听：

```text
127.0.0.1:3000
```

公网入口优先使用 Cloudflare Tunnel，尤其是 VPS 已经有 nginx / sing-box / Caddy 占用 80 / 443 时。

Cloudflare Tunnel 目标：

```text
hostname: example.com
service: http://127.0.0.1:3000
```

外部验收：

```bash
curl --noproxy "*" https://example.com/healthz
```

预期：

```json
{"ok":true}
```

## systemd

服务名建议：

```text
cachito-ble.service
```

示例：

```ini
[Unit]
Description=Cachito BLE MCP Relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/cachito-ble/server
ExecStart=/usr/bin/node dist/index.js
EnvironmentFile=/etc/cachito-ble.env
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

部署后：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cachito-ble
sudo systemctl status cachito-ble --no-pager
sudo journalctl -u cachito-ble -n 80 --no-pager
```

## Cloudflare Tunnel

如果使用 Tunnel，不要占用 80 / 443，不要停已有服务。

检查：

```bash
systemctl status cloudflared-cachito-ble --no-pager
curl --noproxy "*" https://example.com/healthz
```

DNS 应为 tunnel CNAME，proxied=true。不要保留冲突记录。

## 状态接口

`/healthz` 可以公开，只返回 alive。

`/phone/status` 必须要求：

```text
Authorization: Bearer MCP_TOKEN
```

或等价的授权 token。

匿名访问必须 401。

状态返回不能泄露 `PHONE_TOKEN`、`MCP_TOKEN`。

## ChatGPT / OAuth

如果 ChatGPT 新应用界面只支持 OAuth，不支持 Bearer header，不要把 `/mcp` 改成无鉴权。

正确处理方式是新增 OAuth / PKCE 层，同时保留原有 `MCP_TOKEN` 路径。

`/phone/ws` 仍然只接受 `PHONE_TOKEN`。

## iOS

当前不支持 iOS / iPhone。

如果用户要求 iOS 支持，作为新功能处理，至少需要：

```text
iOS relay App
WebSocket 配置
BLE advertising 实现
前台 / 后台行为验证
权限说明
真实设备验收
README 更新
```

完成前不要写“支持 iOS”。

## 报告格式

任务完成后报告：

```text
修改文件
npm test 结果
npm run build 结果
Android 构建结果，如果涉及 Android
systemd 状态，如果涉及部署
Cloudflare Tunnel / Caddy / Nginx 状态，如果涉及公网
外部 /healthz 验收结果
匿名 /phone/status 是否 401
带 token /phone/status 是否正常
Android App 应填写的 URL
未解决问题
```

不要在报告里打印生产 `MCP_TOKEN` 或 `PHONE_TOKEN`。

## 失败处理

不要用 fallback 假装成功。

如果手机离线，报告 `phone_offline`。

如果 ack 超时，报告 `phone_timeout`。

如果公网不通，区分 DNS、TLS、Tunnel、Node、鉴权、手机连接问题。

如果 iPhone 不能用，报告 `ios_not_supported`。
