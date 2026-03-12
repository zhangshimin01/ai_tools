/**
 * HTTP 服务器 —— 管理 API + MCP SSE/Streamable HTTP + 静态页面 + healthz
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp-factory.js";
import {
  getWebhooks,
  getWebhookById,
  addWebhook,
  updateWebhook,
  deleteWebhook,
  getHistory,
  clearHistory,
} from "./store.js";
import { feishuSendText } from "./feishu-tool.js";
import { maskWebhookUrl } from "./config.js";

// public 目录位于项目根目录下
const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();

// Bearer Token 认证（可选）
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || "";

// ─── SSE 会话管理 ───────────────────────────────────────
const sseSessions = new Map<string, SSEServerTransport>();

// ─── Streamable HTTP 会话管理 ───────────────────────────
const streamableSessions = new Map<string, StreamableHTTPServerTransport>();

// ─── 辅助函数 ───────────────────────────────────────────
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
  });
  res.end(JSON.stringify(data));
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
  };
}

function cors(res: http.ServerResponse): void {
  res.writeHead(204, corsHeaders());
  res.end();
}

/** 校验 Bearer Token（如果配置了） */
function checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!AUTH_TOKEN) return true; // 未配置 token，跳过验证
  const authHeader = req.headers.authorization || "";
  if (authHeader === `Bearer ${AUTH_TOKEN}`) return true;
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Unauthorized: invalid or missing Bearer token" }));
  return false;
}

// MIME 类型映射
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// ─── 路由处理 ───────────────────────────────────────────
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const method = req.method || "GET";
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  // CORS 预检
  if (method === "OPTIONS") {
    cors(res);
    return;
  }

  // ── healthz ──
  if (method === "GET" && pathname === "/healthz") {
    json(res, 200, {
      status: "ok",
      service: "feishu-mcp-server",
      mcpTransports: ["sse", "streamable-http"],
      activeSseSessions: sseSessions.size,
      activeStreamableSessions: streamableSessions.size,
    });
    return;
  }

  // ═══════════════════════════════════════════════════════
  // MCP SSE 端点（旧版兼容，Notion 等客户端使用）
  // ═══════════════════════════════════════════════════════

  // GET /sse — 建立 SSE 连接
  if (method === "GET" && pathname === "/sse") {
    if (!checkAuth(req, res)) return;

    console.error("[mcp-sse] 新的 SSE 连接请求");

    const transport = new SSEServerTransport("/mcp", res);
    const mcpServer = createMcpServer();

    sseSessions.set(transport.sessionId, transport);
    console.error(`[mcp-sse] 会话已创建: ${transport.sessionId}`);

    // 连接关闭时清理
    res.on("close", () => {
      sseSessions.delete(transport.sessionId);
      console.error(`[mcp-sse] 会话已断开: ${transport.sessionId}`);
    });

    await mcpServer.connect(transport);
    return;
  }

  // POST /mcp — SSE 客户端发送消息（同时兼容 Streamable HTTP）
  if (method === "POST" && pathname === "/mcp") {
    if (!checkAuth(req, res)) return;

    // 先检查是否有 sessionId 参数（SSE 模式）
    const sessionId = url.searchParams.get("sessionId");

    if (sessionId) {
      // SSE 模式：查找已有会话
      const transport = sseSessions.get(sessionId);
      if (!transport) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "SSE session not found", sessionId }));
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    // Streamable HTTP 模式
    const mcpSessionId = req.headers["mcp-session-id"] as string | undefined;

    if (mcpSessionId && streamableSessions.has(mcpSessionId)) {
      // 已有 Streamable HTTP 会话
      const transport = streamableSessions.get(mcpSessionId)!;
      await transport.handleRequest(req, res);
      return;
    }

    // 新的 Streamable HTTP 会话（初始化请求）
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const mcpServer = createMcpServer();

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        streamableSessions.delete(sid);
        console.error(`[mcp-streamable] 会话已断开: ${sid}`);
      }
    };

    await mcpServer.connect(transport);

    if (transport.sessionId) {
      streamableSessions.set(transport.sessionId, transport);
      console.error(`[mcp-streamable] 会话已创建: ${transport.sessionId}`);
    }

    await transport.handleRequest(req, res);
    return;
  }

  // GET /mcp — Streamable HTTP 的 SSE 连接（用于接收服务器推送通知）
  if (method === "GET" && pathname === "/mcp") {
    if (!checkAuth(req, res)) return;

    const mcpSessionId = req.headers["mcp-session-id"] as string | undefined;
    if (mcpSessionId && streamableSessions.has(mcpSessionId)) {
      const transport = streamableSessions.get(mcpSessionId)!;
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing or invalid Mcp-Session-Id header" }));
    return;
  }

  // DELETE /mcp — 关闭 Streamable HTTP 会话
  if (method === "DELETE" && pathname === "/mcp") {
    if (!checkAuth(req, res)) return;

    const mcpSessionId = req.headers["mcp-session-id"] as string | undefined;
    if (mcpSessionId && streamableSessions.has(mcpSessionId)) {
      const transport = streamableSessions.get(mcpSessionId)!;
      await transport.close();
      streamableSessions.delete(mcpSessionId);
      res.writeHead(200).end("Session closed");
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Session not found" }));
    return;
  }

  // ═══════════════════════════════════════════════════════
  // 管理 API 路由
  // ═══════════════════════════════════════════════════════

  // GET /api/webhooks
  if (method === "GET" && pathname === "/api/webhooks") {
    const webhooks = getWebhooks().map((w) => ({
      ...w,
      urlMasked: maskWebhookUrl(w.url),
    }));
    json(res, 200, { ok: true, data: webhooks });
    return;
  }

  // POST /api/webhooks
  if (method === "POST" && pathname === "/api/webhooks") {
    const body = JSON.parse(await readBody(req));
    const { name, url: hookUrl, isDefault } = body as {
      name?: string;
      url?: string;
      isDefault?: boolean;
    };
    if (!name || !hookUrl) {
      json(res, 400, { ok: false, error: "name 和 url 为必填" });
      return;
    }
    const entry = addWebhook(name, hookUrl, isDefault);
    json(res, 201, { ok: true, data: entry });
    return;
  }

  // PUT /api/webhooks/:id
  if (method === "PUT" && pathname.startsWith("/api/webhooks/")) {
    const id = pathname.split("/")[3];
    const body = JSON.parse(await readBody(req));
    const updated = updateWebhook(id, body);
    if (!updated) {
      json(res, 404, { ok: false, error: "Webhook 不存在" });
      return;
    }
    json(res, 200, { ok: true, data: updated });
    return;
  }

  // DELETE /api/webhooks/:id
  if (method === "DELETE" && pathname.startsWith("/api/webhooks/")) {
    const id = pathname.split("/")[3];
    const deleted = deleteWebhook(id);
    json(res, deleted ? 200 : 404, { ok: deleted, error: deleted ? undefined : "Webhook 不存在" });
    return;
  }

  // POST /api/send  —— 对外 HTTP API，其他应用调用
  if (method === "POST" && pathname === "/api/send") {
    try {
      const body = JSON.parse(await readBody(req));
      const { webhookUrl, webhookId, text } = body as {
        webhookUrl?: string;
        webhookId?: string;
        text?: string;
      };

      if (!text) {
        json(res, 400, { ok: false, error: "text 为必填" });
        return;
      }

      // 支持通过 webhookId 查找
      let resolvedUrl = webhookUrl;
      if (!resolvedUrl && webhookId) {
        const entry = getWebhookById(webhookId);
        if (entry) resolvedUrl = entry.url;
      }

      const result = await feishuSendText({ webhookUrl: resolvedUrl, text });
      json(res, result.ok ? 200 : 502, result);
    } catch (err) {
      json(res, 500, {
        ok: false,
        error: (err as Error).message,
      });
    }
    return;
  }

  // GET /api/history
  if (method === "GET" && pathname === "/api/history") {
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    json(res, 200, { ok: true, data: getHistory(limit) });
    return;
  }

  // DELETE /api/history
  if (method === "DELETE" && pathname === "/api/history") {
    clearHistory();
    json(res, 200, { ok: true });
    return;
  }

  // ── 静态文件（管理界面） ──
  let filePath: string;
  if (pathname === "/" || pathname === "/index.html") {
    filePath = path.join(PROJECT_ROOT, "public", "index.html");
  } else {
    filePath = path.join(PROJECT_ROOT, "public", pathname);
  }

  // 安全：防止路径遍历
  const publicDir = path.resolve(path.join(PROJECT_ROOT, "public"));
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    const ext = path.extname(resolved);
    const mime = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    fs.createReadStream(resolved).pipe(res);
    return;
  }

  // 未匹配 → SPA fallback
  const indexPath = path.join(publicDir, "index.html");
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(indexPath).pipe(res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
}

// ─── 启动 HTTP 服务器 ───────────────────────────────────
export function startHttpServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("[http] 请求处理异常:", err);
      if (!res.headersSent) {
        json(res, 500, { ok: false, error: "Internal Server Error" });
      }
    });
  });

  server.listen(port, () => {
    console.error(`[http] 管理界面 & API 已启动: http://0.0.0.0:${port}`);
    console.error(`[http]   管理界面:   http://localhost:${port}/`);
    console.error(`[http]   API 端点:   http://localhost:${port}/api/send`);
    console.error(`[http]   MCP SSE:    http://localhost:${port}/sse`);
    console.error(`[http]   MCP 消息:   http://localhost:${port}/mcp`);
    console.error(`[http]   健康检查:   http://localhost:${port}/healthz`);
    if (AUTH_TOKEN) {
      console.error(`[http]   认证: Bearer Token 已启用`);
    } else {
      console.error(`[http]   认证: 未配置（设置 MCP_AUTH_TOKEN 环境变量启用）`);
    }
  });

  return server;
}
