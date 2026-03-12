# Feishu MCP Server

基于 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) 的飞书群机器人消息发送服务，附带 **Web 管理界面** 和 **HTTP API**。

## ✨ 功能

- **MCP 工具** `feishu_send_text`：AI 客户端通过 stdio 协议调用
- **Web 管理界面**：可视化配置 Webhook、发送测试消息、查看历史记录
- **HTTP API**：`POST /api/send` 供其他应用直接调用
- **配置持久化**：Webhook 列表保存到 JSON 文件
- **健康检查**：`GET /healthz`

## 📁 项目结构

```
feishu-mcp-server/
├── src/
│   ├── index.ts          # 入口：MCP Server + HTTP 服务
│   ├── feishu-tool.ts    # 飞书发送核心逻辑
│   ├── http-server.ts    # HTTP 管理 API + 静态文件服务
│   ├── config.ts         # 安全配置
│   └── store.ts          # Webhook 配置持久化存储
├── public/
│   └── index.html        # 管理界面 (SPA)
├── data/                 # 运行时数据（自动创建）
│   └── config.json
├── package.json
├── tsconfig.json
├── Dockerfile
└── README.md
```

## 🔧 环境变量

| 变量名 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `SERVER_PORT` | 否 | `3000` | HTTP 服务端口（管理界面 + API + 健康检查） |
| `DEFAULT_WEBHOOK_URL` | 否 | - | 启动时若无已配置 Webhook 则自动导入 |
| `ALLOWED_WEBHOOK_PREFIXES` | 否 | - | 允许的 URL 前缀白名单，逗号分隔 |
| `DATA_DIR` | 否 | `./data` | 配置文件存储目录 |

## 🚀 本地启动

```bash
cd feishu-mcp-server

# 安装依赖 & 编译
npm install
npm run build

# 启动
npm start
# 或指定端口和默认 webhook
SERVER_PORT=3000 DEFAULT_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/your-token" npm start
```

启动后访问：
- 管理界面：http://localhost:3000/
- API 端点：http://localhost:3000/api/send
- 健康检查：http://localhost:3000/healthz

## 🐳 Docker 部署

```bash
# 构建镜像
docker build -t feishu-mcp-server .

# 运行
docker run -d \
  --name feishu-mcp \
  -p 3000:3000 \
  -v feishu-data:/app/data \
  -e DEFAULT_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/your-token" \
  feishu-mcp-server

# 健康检查
curl http://localhost:3000/healthz
```

## 🌐 HTTP API（给其他应用调用）

### 发送消息

```bash
curl -X POST http://localhost:3000/api/send \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from API!"}'
```

也可指定 Webhook：

```bash
# 通过 URL 直接指定
curl -X POST http://localhost:3000/api/send \
  -H "Content-Type: application/json" \
  -d '{
    "text": "指定群消息",
    "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
  }'

# 通过已配置的 ID 指定
curl -X POST http://localhost:3000/api/send \
  -H "Content-Type: application/json" \
  -d '{"text": "指定群消息", "webhookId": "xxx"}'
```

### 管理 Webhook

```bash
# 列表
curl http://localhost:3000/api/webhooks

# 添加
curl -X POST http://localhost:3000/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{"name":"测试群","url":"https://open.feishu.cn/open-apis/bot/v2/hook/xxx","isDefault":true}'

# 修改
curl -X PUT http://localhost:3000/api/webhooks/<id> \
  -H "Content-Type: application/json" \
  -d '{"name":"新名称"}'

# 删除
curl -X DELETE http://localhost:3000/api/webhooks/<id>
```

### 发送历史

```bash
curl http://localhost:3000/api/history?limit=20
```

## 🤖 MCP 客户端接入

### Claude Desktop / CodeBuddy / Cursor

```json
{
  "mcpServers": {
    "feishu-webhook": {
      "command": "node",
      "args": ["/path/to/feishu-mcp-server/dist/index.js"],
      "env": {
        "SERVER_PORT": "3001"
      }
    }
  }
}
```

### Docker 方式

```json
{
  "mcpServers": {
    "feishu-webhook": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-p", "3000:3000",
        "-v", "feishu-data:/app/data",
        "feishu-mcp-server"
      ]
    }
  }
}
```

## License

MIT
# ai_tools
