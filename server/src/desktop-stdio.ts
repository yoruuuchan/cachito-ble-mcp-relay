import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PhoneRelay, createMcpServer, createRelayHttpServer, readRuntimeConfig } from "./runtime.js";

const config = readRuntimeConfig();
const phoneRelay = new PhoneRelay();
const { httpServer } = createRelayHttpServer(config, {
  phoneRelay,
  enableHttpMcp: false,
});

const mcpServer = createMcpServer(phoneRelay, {
  pairingId: config.pairingId,
  allowHighLevels: config.allowHighLevels,
});

httpServer.on("error", (error) => {
  console.error("Desktop stdio relay HTTP server error:", error);
  process.exit(1);
});

httpServer.listen(config.port, config.host, () => {
  console.error("Desktop stdio phone relay listening on " + config.host + ":" + config.port);
});

const transport = new StdioServerTransport();
await mcpServer.connect(transport);

process.on("SIGINT", async () => {
  await mcpServer.close();
  httpServer.close(() => process.exit(0));
});
