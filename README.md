# Cachito BLE MCP Relay

把 Cachito 失控 2.0 接入 MCP 的 Android BLE 中继项目。

这个项目的作用是：让 MCP 客户端把命令发到服务端，服务端转发给 Android 手机，再由手机发送 BLE legacy advertisement，控制本地设备。

```text
MCP Client
→ HTTPS MCP endpoint
→ VPS Relay
→ Android WebSocket
→ Android BLE advertisement
→ Cachito 失控 2.0
```

VPS 不需要蓝牙。真正靠近设备、负责发 BLE 广播的是 Android 手机。

目前只验证了 Android relay。iPhone / iOS 暂时不能直接使用。

## 已验证设备

| 设备 | 控制方式 | 状态 |
|---|---|---|
| Cachito 失控 2.0 | BLE legacy advertisement | 已验证 |

不同批次、固件、型号可能不兼容。换设备需要重新抓包和验证。

## 项目结构

```text
server/
  Node.js MCP server
  Android WebSocket relay
  协议封装
  smoke test

android/
  Android BLE relay App
  接收 server 命令
  发送 BLE advertisement

docs/
  本地调试和部署文档
```

## 平台支持

| 平台 / 组件 | 状态 |
|---|---|
| Android relay App | 已验证 |
| Windows 本地调试 | 已验证 |
| VPS + Cloudflare Tunnel | 已验证 |
| iPhone / iOS relay | 未验证，暂不支持 |

iPhone 用户目前不能直接照着本文使用。仓库里没有 iOS relay App，也没有验证 iOS 能否稳定发送目标设备需要的 BLE advertisement。

## 基本设计

Cachito 失控 2.0 不是通过普通 GATT write 控制的。官方 App 会发送 BLE legacy advertisement，设备监听其中的 128-bit Service UUID 并执行动作。

本项目只把已经验证过的动作封装成 MCP tools，不提供通用蓝牙发包器。

当前 tools：

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

`set_channel_a` 和 `set_channel_b` 是中性别名，适合在 MCP 客户端里使用。它们内部仍然映射到实际通道。

第一次测试建议：

```text
get_status
stop_all
set_channel_b(level=10, duration_ms=2000)
stop_all
```

先确认手机在线，再确认能停，再测低强度动作。

## 鉴权

服务端使用两个 token：

```text
MCP_TOKEN    给 MCP endpoint 和状态接口用
PHONE_TOKEN  给 Android App 的 WebSocket 连接用
```

不要把生产 token 提交到仓库，也不要发到 issue、截图、日志里。

生产环境推荐：

```env
HOST=127.0.0.1
PORT=3000
ALLOW_HIGH_LEVELS=false
```

`3000` 端口不要直接暴露到公网。用 Cloudflare Tunnel、Caddy 或 Nginx 反代。

## 本地运行

安装依赖：

```bash
cd server
npm ci
npm test
npm run build
```

启动本地 relay：

```bash
MCP_TOKEN=dev-mcp-token \
PHONE_TOKEN=dev-phone-token \
ALLOW_HIGH_LEVELS=false \
HOST=127.0.0.1 \
PORT=3000 \
npm start
```

如果用 USB 调试：

```bash
adb reverse tcp:3000 tcp:3000
```

Android App 填：

```text
ws://127.0.0.1:3000/phone/ws
```

如果走局域网，手机和电脑在同一网络下，App 填电脑局域网 IP：

```text
ws://192.168.x.x:3000/phone/ws
```

## Android App

构建 APK：

```bash
cd android
./gradlew assembleDebug
```

安装：

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

App 内填写：

```text
Server URL: ws://127.0.0.1:3000/phone/ws
Phone token: PHONE_TOKEN
Pairing ID: 设备 pairing ID
```

公网部署后：

```text
Server URL: wss://example.com/phone/ws
```

Android 12 及以上需要授予蓝牙 / Nearby Devices 权限。

## 公网部署

推荐结构：

```text
MCP Client
→ https://example.com/mcp
→ Cloudflare Tunnel / Reverse Proxy
→ VPS 127.0.0.1:3000
→ Android App wss://example.com/phone/ws
→ BLE advertisement
```

生成生产 token：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

环境变量示例：

```env
HOST=127.0.0.1
PORT=3000
PUBLIC_BASE_URL=https://example.com
ALLOW_HIGH_LEVELS=false
MCP_TOKEN=replace-with-production-token
PHONE_TOKEN=replace-with-production-token
```

如果 VPS 已经有 nginx、sing-box、Caddy 占用 80 / 443，优先用 Cloudflare Tunnel，不要抢端口。

Cloudflare Tunnel 目标：

```text
example.com
→ http://127.0.0.1:3000
```

验收：

```bash
curl https://example.com/healthz
```

预期：

```json
{"ok":true}
```

匿名状态接口应该返回 401：

```bash
curl https://example.com/phone/status
```

带 token 查询：

```bash
curl -H "Authorization: Bearer $MCP_TOKEN" \
  https://example.com/phone/status
```

手机连接后，应看到：

```json
"phone_online": true
```

## MCP 客户端接入

Endpoint：

```text
https://example.com/mcp
```

Header：

```text
Authorization: Bearer <MCP_TOKEN>
```

建议先调用：

```text
get_status
stop_all
set_channel_b(level=10, duration_ms=2000)
stop_all
```

如果客户端只支持 OAuth，不支持 Bearer header，需要给 server 额外加 OAuth 层。不要把 `/mcp` 改成无鉴权。

## 逆向流程记录

本项目最初通过 Android Bluetooth HCI snoop log 分析官方 App 的 BLE 广播行为。

大致流程：

```text
1. Android 开发者选项开启 Bluetooth HCI snoop log。
2. 官方 App 每次只执行一个动作。
3. 导出 bugreport。
4. 从 HCI log 中找 BLE advertising data。
5. 分析 UUID、通道、强度字段、checksum。
6. 手动复现低强度命令。
7. 写入协议 builder。
8. 用 stop_all 做验收。
```

这个流程只适用于拥有者自测。不要测试或控制不属于自己的设备。

## 故障排查

手机离线时，先查 App URL、PHONE_TOKEN、App 是否仍在前台，以及 `/phone/status`。

USB 断了就重新跑：

```bash
adb reverse tcp:3000 tcp:3000
```

局域网连不上时，确认手机和电脑在同一网络，确认防火墙放行，确认 App URL 不是 `127.0.0.1`。

大陆 VPS 出现 HTTPS/TLS 异常时，优先考虑备案、SNI 拦截或入口策略问题。换非大陆 VPS 或 Cloudflare Tunnel 往往更省事。

iPhone 不能用时，不是 bug。当前没有 iOS relay。

## License

MIT License.