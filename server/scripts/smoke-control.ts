import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type SmokeResult = {
  action?: string;
  generated_uuid?: string | string[] | null;
  phone_online?: boolean;
  pushed_to_phone?: boolean;
  phone_ack?: unknown;
  error?: string | null;
};

type ToolStep = {
  name: string;
  arguments: Record<string, unknown>;
};

const mcpToken = process.env.MCP_TOKEN;
const phoneToken = process.env.PHONE_TOKEN;
const port = process.env.PORT ?? "3000";

if (!mcpToken) {
  throw new Error("MCP_TOKEN is required.");
}

if (!phoneToken) {
  throw new Error("PHONE_TOKEN is required.");
}

const steps: ToolStep[] = [
  { name: "get_status", arguments: {} },
  { name: "stop_all", arguments: { duration_ms: 2000 } },
  { name: "set_suction", arguments: { level: 10, duration_ms: 2000 } },
  { name: "stop_all", arguments: { duration_ms: 2000 } },
  { name: "set_vibration", arguments: { level: 10, duration_ms: 2000 } },
  { name: "stop_all", arguments: { duration_ms: 2000 } },
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractResult(raw: unknown): SmokeResult {
  if (!isObject(raw)) {
    throw new Error("Tool returned a non-object result.");
  }

  if (isObject(raw.structuredContent)) {
    return raw.structuredContent as SmokeResult;
  }

  const content = raw.content;
  if (Array.isArray(content)) {
    const textItem = content.find((item) => isObject(item) && item.type === "text" && typeof item.text === "string");
    if (isObject(textItem) && typeof textItem.text === "string") {
      return JSON.parse(textItem.text) as SmokeResult;
    }
  }

  throw new Error("Tool result did not include structuredContent or JSON text content.");
}

function printStep(result: SmokeResult): void {
  console.log(
    JSON.stringify(
      {
        action: result.action ?? null,
        generated_uuid: result.generated_uuid ?? null,
        phone_online: result.phone_online ?? null,
        pushed_to_phone: result.pushed_to_phone ?? null,
        phone_ack: result.phone_ack ?? null,
        error: result.error ?? null,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const client = new Client({
    name: "mcp-android-ble-smoke-control",
    version: "0.1.0",
  });

  const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:" + port + "/mcp"), {
    requestInit: {
      headers: {
        Authorization: "Bearer " + mcpToken,
      },
    },
  });

  try {
    await client.connect(transport);

    for (const step of steps) {
      const raw = await client.callTool({
        name: step.name,
        arguments: step.arguments,
      });
      const result = extractResult(raw);
      printStep(result);

      if (result.phone_online === false) {
        console.error("phone_offline");
        process.exitCode = 1;
        return;
      }

      if (result.error === "phone_timeout") {
        console.error("phone_timeout");
        process.exitCode = 1;
        return;
      }

      if (result.error) {
        console.error(result.error);
        process.exitCode = 1;
        return;
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
