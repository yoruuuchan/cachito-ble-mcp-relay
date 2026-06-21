import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";
import { type ControlAction, prepareCommand, type PreparedCommand } from "./control.js";

export type PhoneAck = {
  type?: string;
  request_id?: string;
  action?: string;
  ok?: boolean;
  generated_uuid?: string | string[];
  error?: string | null;
  [key: string]: unknown;
};

export type ToolResult = {
  action: string;
  level: number | null;
  duration_ms: number | null;
  generated_uuid: string | string[] | null;
  phone_online: boolean;
  pushed_to_phone: boolean;
  phone_ack: PhoneAck | PhoneAck[] | null;
  error: string | null;
};

export type RuntimeConfig = {
  port: number;
  host: string;
  mcpToken: string;
  phoneToken: string;
  pairingId: string;
  allowHighLevels: boolean;
  publicBaseUrl: string;
};

export type ControlRuntimeOptions = {
  pairingId: string;
  allowHighLevels: boolean;
};

export class PhoneRelay {
  private activeSocket: WebSocket | null = null;
  private connectedAt: string | null = null;
  private lastSeenAt: string | null = null;
  private lastCommand: unknown = null;
  private lastAck: PhoneAck | null = null;
  private pending = new Map<
    string,
    {
      resolve: (ack: PhoneAck) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  attach(ws: WebSocket): void {
    if (this.activeSocket && this.activeSocket.readyState === WebSocket.OPEN) {
      this.activeSocket.close(4000, "replaced_by_new_phone_connection");
    }

    this.activeSocket = ws;
    this.connectedAt = new Date().toISOString();
    this.lastSeenAt = this.connectedAt;

    ws.on("message", (data) => {
      this.lastSeenAt = new Date().toISOString();
      this.handleMessage(data.toString());
    });

    ws.on("close", () => {
      if (this.activeSocket === ws) {
        this.activeSocket = null;
        this.connectedAt = null;
      }
      this.rejectPending("phone_offline");
    });

    ws.on("error", () => {
      if (this.activeSocket === ws) {
        this.activeSocket = null;
        this.connectedAt = null;
      }
      this.rejectPending("phone_offline");
    });
  }

  isOnline(): boolean {
    return this.activeSocket?.readyState === WebSocket.OPEN;
  }

  status(): Record<string, unknown> {
    return {
      phone_online: this.isOnline(),
      connected_at: this.connectedAt,
      last_seen_at: this.lastSeenAt,
      last_command: this.lastCommand,
      last_ack: this.lastAck,
      pending_commands: this.pending.size,
    };
  }

  send(action: ControlAction, prepared: PreparedCommand): Promise<PhoneAck> {
    const ws = this.activeSocket;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("phone_offline"));
    }

    const requestId = randomUUID();
    const command = {
      type: "command",
      request_id: requestId,
      action,
      level: prepared.level,
      duration_ms: prepared.duration_ms,
    };

    this.lastCommand = command;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("phone_timeout"));
      }, 8000);

      this.pending.set(requestId, { resolve, reject, timeout });

      ws.send(JSON.stringify(command), (error) => {
        if (error) {
          clearTimeout(timeout);
          this.pending.delete(requestId);
          reject(new Error("phone_offline"));
        }
      });
    });
  }

  private handleMessage(raw: string): void {
    let ack: PhoneAck;
    try {
      ack = JSON.parse(raw) as PhoneAck;
    } catch {
      return;
    }

    if (ack.type === "pong") {
      this.lastAck = ack;
      return;
    }

    if (ack.type !== "ack" || typeof ack.request_id !== "string") {
      return;
    }

    const pending = this.pending.get(ack.request_id);
    if (!pending) {
      this.lastAck = ack;
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(ack.request_id);
    this.lastAck = ack;
    pending.resolve(ack);
  }

  private rejectPending(code: string): void {
    for (const [requestId, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(code));
      this.pending.delete(requestId);
    }
  }
}

export function readRuntimeConfig(): RuntimeConfig {
  const mcpToken = process.env.MCP_TOKEN;
  const phoneToken = process.env.PHONE_TOKEN;

  if (!mcpToken || !phoneToken) {
    throw new Error("MCP_TOKEN and PHONE_TOKEN must be set before starting the server.");
  }

  return {
    port: Number.parseInt(process.env.PORT ?? "3000", 10),
    host: process.env.HOST ?? "127.0.0.1",
    mcpToken,
    phoneToken,
    pairingId: process.env.PAIRING_ID ?? "5002",
    allowHighLevels: process.env.ALLOW_HIGH_LEVELS === "true",
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:" + (process.env.PORT ?? "3000"),
  };
}

function bearerToken(req: IncomingMessage): string | null {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  return authorization.slice("Bearer ".length);
}

function phoneTokenFromUpgrade(req: IncomingMessage): string | null {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", "http://" + host);
  const queryToken = url.searchParams.get("token");
  return queryToken ?? bearerToken(req);
}

function errorResult(
  phoneRelay: PhoneRelay,
  action: string,
  error: string,
  prepared: PreparedCommand | null = null,
): ToolResult {
  return {
    action,
    level: prepared?.level ?? null,
    duration_ms: prepared?.duration_ms ?? null,
    generated_uuid: prepared?.generated_uuid ?? null,
    phone_online: phoneRelay.isOnline(),
    pushed_to_phone: false,
    phone_ack: null,
    error,
  };
}

function asToolResponse(result: ToolResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

export async function runControlAction(
  phoneRelay: PhoneRelay,
  options: ControlRuntimeOptions,
  action: ControlAction,
  input: { level?: number; duration_ms?: number },
): Promise<ToolResult> {
  let prepared: PreparedCommand;
  try {
    prepared = prepareCommand(action, input, options);
  } catch (error) {
    return errorResult(phoneRelay, action, error instanceof Error ? error.message : "invalid_input");
  }

  if (!phoneRelay.isOnline()) {
    return errorResult(phoneRelay, action, "phone_offline", prepared);
  }

  if (action === "stop_all") {
    const first = prepareCommand("stop_suction", { duration_ms: prepared.duration_ms }, options);
    const second = prepareCommand("stop_vibration", { duration_ms: prepared.duration_ms }, options);
    const acks: PhoneAck[] = [];

    try {
      acks.push(await phoneRelay.send("stop_suction", first));
      acks.push(await phoneRelay.send("stop_vibration", second));
    } catch (error) {
      const message = error instanceof Error ? error.message : "phone_error";
      return {
        ...prepared,
        phone_online: phoneRelay.isOnline(),
        pushed_to_phone: acks.length > 0 || message === "phone_timeout",
        phone_ack: acks.length > 0 ? acks : null,
        error: message,
      };
    }

    return {
      ...prepared,
      generated_uuid: acks.map((ack) => ack.generated_uuid).filter(Boolean) as string[],
      phone_online: phoneRelay.isOnline(),
      pushed_to_phone: true,
      phone_ack: acks,
      error: acks.find((ack) => ack.ok === false)?.error ?? null,
    };
  }

  try {
    const ack = await phoneRelay.send(action, prepared);
    return {
      ...prepared,
      generated_uuid: ack.generated_uuid ?? prepared.generated_uuid,
      phone_online: phoneRelay.isOnline(),
      pushed_to_phone: true,
      phone_ack: ack,
      error: ack.ok === false ? ack.error ?? "phone_error" : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "phone_error";
    return {
      ...prepared,
      phone_online: phoneRelay.isOnline(),
      pushed_to_phone: message === "phone_timeout",
      phone_ack: null,
      error: message,
    };
  }
}

export function createMcpServer(phoneRelay: PhoneRelay, options: ControlRuntimeOptions): McpServer {
  const server = new McpServer({
    name: "android-ble-broadcaster-relay",
    version: "0.1.0",
  });

  const durationSchema = z.number().int().optional().describe("BLE advertise duration in ms. Defaults to 2000. Allowed range: 100-5000.");
  const levelSchema = z.number().int().describe("Intensity level 0-100. Levels above 50 require ALLOW_HIGH_LEVELS=true.");

  server.registerTool(
    "set_suction",
    {
      description: "Set suction intensity by asking the connected Android phone to emit a whitelisted BLE legacy advertisement.",
      inputSchema: { level: levelSchema, duration_ms: durationSchema },
    },
    async ({ level, duration_ms }) => asToolResponse(await runControlAction(phoneRelay, options, "set_suction", { level, duration_ms })),
  );

  server.registerTool(
    "set_vibration",
    {
      description: "Set vibration intensity by asking the connected Android phone to emit a whitelisted BLE legacy advertisement.",
      inputSchema: { level: levelSchema, duration_ms: durationSchema },
    },
    async ({ level, duration_ms }) => asToolResponse(await runControlAction(phoneRelay, options, "set_vibration", { level, duration_ms })),
  );

  server.registerTool(
    "set_channel_a",
    {
      description: "Neutral alias for set_suction. Uses the same whitelist, level limit, and duration limit.",
      inputSchema: { level: levelSchema, duration_ms: durationSchema },
    },
    async ({ level, duration_ms }) => asToolResponse(await runControlAction(phoneRelay, options, "set_suction", { level, duration_ms })),
  );

  server.registerTool(
    "set_channel_b",
    {
      description: "Neutral alias for set_vibration. Uses the same whitelist, level limit, and duration limit.",
      inputSchema: { level: levelSchema, duration_ms: durationSchema },
    },
    async ({ level, duration_ms }) => asToolResponse(await runControlAction(phoneRelay, options, "set_vibration", { level, duration_ms })),
  );

  server.registerTool(
    "stop_suction",
    {
      description: "Stop suction by sending the whitelisted stop_suction advertisement through the Android phone.",
      inputSchema: { duration_ms: durationSchema },
    },
    async ({ duration_ms }) => asToolResponse(await runControlAction(phoneRelay, options, "stop_suction", { duration_ms })),
  );

  server.registerTool(
    "stop_vibration",
    {
      description: "Stop vibration by sending the whitelisted stop_vibration advertisement through the Android phone.",
      inputSchema: { duration_ms: durationSchema },
    },
    async ({ duration_ms }) => asToolResponse(await runControlAction(phoneRelay, options, "stop_vibration", { duration_ms })),
  );

  server.registerTool(
    "stop_all",
    {
      description: "Stop both channels. The server sends stop_suction first and stop_vibration second.",
      inputSchema: { duration_ms: durationSchema },
    },
    async ({ duration_ms }) => asToolResponse(await runControlAction(phoneRelay, options, "stop_all", { duration_ms })),
  );

  server.registerTool(
    "get_status",
    {
      description: "Return current server and Android phone relay status.",
      inputSchema: {},
    },
    async () =>
      asToolResponse({
        action: "get_status",
        level: null,
        duration_ms: null,
        generated_uuid: null,
        phone_online: phoneRelay.isOnline(),
        pushed_to_phone: false,
        phone_ack: phoneRelay.status() as PhoneAck,
        error: null,
      }),
  );

  return server;
}

export function createRelayHttpServer(
  config: RuntimeConfig,
  options: { phoneRelay?: PhoneRelay; enableHttpMcp?: boolean } = {},
) {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  const httpServer = createServer(app);
  const phoneRelay = options.phoneRelay ?? new PhoneRelay();
  const phoneWss = new WebSocketServer({ noServer: true });
  const enableHttpMcp = options.enableHttpMcp ?? true;
  const controlOptions = {
    pairingId: config.pairingId,
    allowHighLevels: config.allowHighLevels,
  };

  function requireMcpAuth(req: express.Request, res: express.Response): boolean {
    if (bearerToken(req) !== config.mcpToken) {
      res.status(401).json({ error: "unauthorized" });
      return false;
    }
    return true;
  }

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/status", (req, res) => {
    if (!requireMcpAuth(req, res)) {
      return;
    }
    res.json(phoneRelay.status());
  });

  app.get("/phone/status", (req, res) => {
    if (!requireMcpAuth(req, res)) {
      return;
    }
    res.json(phoneRelay.status());
  });

  if (enableHttpMcp) {
    app.post("/mcp", async (req, res) => {
      if (!requireMcpAuth(req, res)) {
        return;
      }

      const server = createMcpServer(phoneRelay, controlOptions);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: error instanceof Error ? error.message : "Internal server error" },
            id: null,
          });
        }
      } finally {
        await transport.close();
        await server.close();
      }
    });

    app.get("/mcp", (req, res) => {
      if (!requireMcpAuth(req, res)) {
        return;
      }
      res.status(405).json({ error: "method_not_allowed" });
    });

    app.delete("/mcp", (req, res) => {
      if (!requireMcpAuth(req, res)) {
        return;
      }
      res.status(405).json({ error: "method_not_allowed" });
    });
  }

  phoneWss.on("connection", (ws) => {
    phoneRelay.attach(ws);
    ws.send(JSON.stringify({ type: "hello", server_time: new Date().toISOString() }));
  });

  httpServer.on("upgrade", (req, socket, head) => {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", "http://" + host);

    if (url.pathname !== "/phone/ws") {
      socket.destroy();
      return;
    }

    if (phoneTokenFromUpgrade(req) !== config.phoneToken) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    phoneWss.handleUpgrade(req, socket, head, (ws) => {
      phoneWss.emit("connection", ws, req);
    });
  });

  return { app, httpServer, phoneRelay };
}
