/**
 * HTTP 服务器 —— 管理 API + 静态页面 + healthz
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
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
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function cors(res: http.ServerResponse): void {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end();
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
    json(res, 200, { status: "ok", service: "feishu-mcp-server" });
    return;
  }

  // ── API 路由 ──

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
    console.error(`[http]   管理界面: http://localhost:${port}/`);
    console.error(`[http]   API 端点: http://localhost:${port}/api/send`);
    console.error(`[http]   健康检查: http://localhost:${port}/healthz`);
  });

  return server;
}
