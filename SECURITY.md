# Security

这个项目会把 MCP 客户端连接到本地 BLE 设备，所以安全边界不能靠文档嘴硬，必须靠默认配置和代码限制。

## 不要提交的东西

不要提交：

```text
MCP_TOKEN
PHONE_TOKEN
.env
/etc/cachito-ble.env
生产域名的真实 token
私有 pairing ID
包含 token 的日志或截图
```

如果 token 泄露，立刻在服务器上重新生成：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

然后更新 `/etc/cachito-ble.env` 并重启服务。

## 推荐部署方式

生产环境推荐：

```env
HOST=127.0.0.1
PORT=3000
ALLOW_HIGH_LEVELS=false
```

`3000` 端口不要直接暴露到公网。公网入口使用 Cloudflare Tunnel、Caddy 或 Nginx。

`/healthz` 可以公开。

`/phone/status` 和 `/mcp` 必须鉴权。

`/phone/ws` 必须使用 `PHONE_TOKEN`。

## 报告问题

如果你发现鉴权绕过、任意 BLE 广播、token 泄露、状态接口裸露或其它安全问题，请先不要公开贴生产 token 或真实日志。

可以在 issue 中描述复现条件，但请替换掉所有密钥和真实设备标识。
