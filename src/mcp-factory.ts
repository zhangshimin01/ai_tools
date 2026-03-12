/**
 * MCP Server 工厂 —— 创建并注册工具
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  feishuSendText,
  type FeishuSendTextResult,
} from "./feishu-tool.js";

export function createMcpServer(): McpServer {
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

  return server;
}
