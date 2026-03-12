import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { load as loadStore, getServerPort } from "./store.js";
import { startHttpServer } from "./http-server.js";
import { createMcpServer } from "./mcp-factory.js";

// ─── 加载持久化配置 ─────────────────────────────────────
loadStore();

// ─── 启动 ───────────────────────────────────────────────
async function main(): Promise<void> {
  const port = parseInt(process.env.SERVER_PORT || String(getServerPort()), 10);
  const transportMode = process.env.MCP_TRANSPORT || "stdio";

  if (transportMode === "httponly") {
    // 仅 HTTP 模式：不启动 stdio，只提供 HTTP + SSE/Streamable MCP
    startHttpServer(port);
    console.error("[mcp] Feishu MCP Server started (HTTP-only mode)");
    console.error(`[mcp]   MCP SSE 端点:  http://localhost:${port}/sse`);
    console.error(`[mcp]   MCP 消息端点:  http://localhost:${port}/mcp`);
  } else {
    // 默认 stdio + HTTP 模式
    startHttpServer(port);

    const mcpServer = createMcpServer();
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error("[mcp] Feishu MCP Server started (stdio + HTTP mode)");
  }
}

main().catch((err) => {
  console.error("[mcp] Fatal error:", err);
  process.exit(1);
});
