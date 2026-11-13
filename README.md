# Cachito BLE MCP Relay

<a href="https://github.com/DasterProkio/awesome-ai-companion/blob/main/README.zh-CN.md">
  <img src="https://raw.githubusercontent.com/DasterProkio/awesome-ai-companion/main/assets/featured-in-awesome-ai-companion-zh-CN.png" alt="已收录于人机恋开源项目大全" height="24">
</a>

把 Cachito 失控 2.0 接进 MCP 的 Android BLE 中继。

MCP 客户端把命令发到服务端，服务端转给 Android 手机，手机再发出 BLE legacy advertisement，控制本地设备。

```text
MCP Client
→ HTTPS MCP endpoint
→ VPS Relay
→ Android WebSocket
→ Android BLE advertisement
→ Cachito 失控 2.0
```

VPS 不需要蓝牙。真正靠近设备、负责发 BLE 广播的是 Android 手机。

目前只验证了 Android 中继。iPhone / iOS 暂时不能直接用。

## 验证过的设备

| 设备 | 控制方式 | 状态 |
|---|---|---|
| Cachito 失控 2.0 | BLE legacy advertisement | 已验证 |

不同批次、固件、型号可能不兼容。换设备就要重新抓包、重新验证。

## 仓库里有什么

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

## 支持哪些平台

| 平台 / 组件 | 状态 |
|---|---|
| Android 中继 App | 已验证 |
| Windows 本地调试 | 已验证 |
| VPS + Cloudflare Tunnel | 已验证 |
| iPhone / iOS 中继 | 未验证，暂不支持 |

iPhone 用户目前没法直接照着这份文档用。仓库里没有 iOS 中继 App，也没验证过 iOS 能不能稳定发出目标设备需要的 BLE advertisement。

## 它是怎么工作的

Cachito 失控 2.0 不走普通的 GATT write。官方 App 发的是 BLE legacy advertisement，设备监听里面的 128-bit Service UUID，再执行对应的动作。

这里只把已经验证过的动作封装成 MCP tools，不提供通用的蓝牙发包器。

现在有这些 tools：

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

`set_channel_a` 和 `set_channel_b` 是中性的别名，适合在 MCP 客户端里用。它们内部还是映射到实际通道。

第一次测试，建议按这个顺序：

```text
get_status
stop_all
set_channel_b(level=10, duration_ms=2000)
stop_all
```

先确认手机在线，再确认能停，再测低强度动作。

## 鉴权

服务端用两个 token：

```text
MCP_TOKEN    给 MCP endpoint 和状态接口用
PHONE_TOKEN  给 Android App 的 WebSocket 连接用
```

不要把生产 token 提交到仓库，也不要发到 issue、截图、日志里。

生产环境建议这样配：

```env
HOST=127.0.0.1
PORT=3000
ALLOW_HIGH_LEVELS=false
```

`3000` 端口不要直接暴露到公网。用 Cloudflare Tunnel、Caddy 或 Nginx 反代。

## 在本地跑起来

装依赖、跑测试、构建：

```bash
cd server
npm ci
npm test
npm run build
```

启动本地中继：

```bash
MCP_TOKEN=dev-mcp-token \
PHONE_TOKEN=dev-phone-token \
ALLOW_HIGH_LEVELS=false \
HOST=127.0.0.1 \
PORT=3000 \
npm start
```

用 USB 调试的话：

```bash
adb reverse tcp:3000 tcp:3000
```

Android App 里填：

```text
ws://127.0.0.1:3000/phone/ws
```

走局域网的话，手机和电脑要连在同一个网络，App 里填电脑的局域网 IP：

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

在 App 里填：

```text
Server URL: ws://127.0.0.1:3000/phone/ws
Phone token: PHONE_TOKEN
Pairing ID: 设备 pairing ID
```

部署到公网以后，Server URL 填：

```text
Server URL: wss://example.com/phone/ws
```

Android 12 及以上需要授予蓝牙 / Nearby Devices 权限。

## 部署到公网

推荐这样搭：

```text
MCP Client
→ https://example.com/mcp
→ Cloudflare Tunnel / Reverse Proxy
→ VPS 127.0.0.1:3000
→ Android App wss://example.com/phone/ws
→ BLE advertisement
```

生成两个生产 token：

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

如果 VPS 上已经有 nginx、sing-box、Caddy 占着 80 / 443，优先用 Cloudflare Tunnel，不要抢端口。

Cloudflare Tunnel 指向：

```text
example.com
→ http://127.0.0.1:3000
```

验收：

```bash
curl https://example.com/healthz
```

应该返回：

```json
{"ok":true}
```

不带 token 访问状态接口，应该返回 401：

```bash
curl https://example.com/phone/status
```

带 token 查询：

```bash
curl -H "Authorization: Bearer $MCP_TOKEN" \
  https://example.com/phone/status
```

手机连上以后，应该能看到：

```json
"phone_online": true
```

## 接入 MCP 客户端

地址：

```text
https://example.com/mcp
```

请求头：

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

如果客户端只支持 OAuth、不支持 Bearer header，就要给服务端另外加一层 OAuth。不要把 `/mcp` 改成无鉴权。

## 协议是怎么逆向出来的

最开始是用 Android 的 Bluetooth HCI snoop log，分析官方 App 发 BLE 广播的方式。

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

这个流程只适用于设备拥有者自测。不要测试或控制不属于自己的设备。

## 排错

手机离线：先查 App 里的 URL、PHONE_TOKEN、App 是不是还在前台，还有 `/phone/status`。

USB 断了，就重新跑：

```bash
adb reverse tcp:3000 tcp:3000
```

局域网连不上：确认手机和电脑在同一个网络，防火墙已放行，App 里的 URL 不是 `127.0.0.1`。

大陆 VPS 上 HTTPS/TLS 出异常：先考虑备案、SNI 拦截或入口策略的问题。换非大陆 VPS，或者用 Cloudflare Tunnel，往往更省事。

iPhone 用不了不是 bug。现在没有 iOS 中继。

## License

MIT License.