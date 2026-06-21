import { createRelayHttpServer, readRuntimeConfig } from "./runtime.js";

const config = readRuntimeConfig();
const { httpServer } = createRelayHttpServer(config);

httpServer.listen(config.port, config.host, () => {
  console.log("MCP Android BLE relay listening on " + config.host + ":" + config.port);
});

process.on("SIGINT", () => {
  httpServer.close(() => process.exit(0));
});
