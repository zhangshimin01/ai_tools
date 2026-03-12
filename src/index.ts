import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { load as loadStore, getServerPort } from "./store.js";
import { startHttpServer } from "./http-server.js";
import {
  feishuSendText,
  type FeishuSendTextResult,
} from "./feishu-tool.js";

// ─── 加载持久化配置 ─────────────────────────────────────
loadStore();

// ─── MCP Server ─────────────────────────────────────────
const server = new McpServer({
  name: "feishu-webhook",
  version: "1.0.0",
});

// 注册 feishu_send_text 工具
server.tool(
  "feishu_send_text",
  "向飞书群机器人 Webhook 发送纯文本消息。webhookUrl 需为完整 URL（https://open.feishu.cn/open-apis/bot/v2/hook/...），或使用已配置的默认 Webhook。",
  {
    webhookUrl: z
      .string()
      .url()
      .optional()
      .describe(
        "飞书群机器人 Webhook 完整 URL，若不传则使用已配置的默认 Webhook"
      ),
    text: z.string().min(1).describe("要发送的纯文本消息内容"),
    tag: z
      .string()
      .optional()
      .default("text")
      .describe('消息类型标签，固定为 "text"，可缺省'),
  },
  async (args) => {
    const result: FeishuSendTextResult = await feishuSendText({
      webhookUrl: args.webhookUrl,
      text: args.text,
      tag: args.tag,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
      isError: !result.ok,
    };
  }
);

// ─── 启动 ───────────────────────────────────────────────
async function main(): Promise<void> {
  // 启动 HTTP 管理界面 & API
  const port = parseInt(process.env.SERVER_PORT || String(getServerPort()), 10);
  startHttpServer(port);

  // 启动 MCP Server（stdio 传输）
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] Feishu MCP Server started (stdio transport)");
}

main().catch((err) => {
  console.error("[mcp] Fatal error:", err);
  process.exit(1);
});
