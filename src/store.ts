/**
 * 持久化配置存储 —— webhook 列表 & 发送记录
 */
import fs from "node:fs";
import path from "node:path";

// ─── 类型 ───────────────────────────────────────────────
export interface WebhookEntry {
  id: string;
  name: string;
  url: string;
  isDefault: boolean;
  createdAt: string;
}

export interface SendRecord {
  id: string;
  webhookName: string;
  text: string;
  ok: boolean;
  httpStatus: number;
  feishuCode: number | null;
  feishuMsg: string | null;
  timestamp: string;
}

interface StoreData {
  webhooks: WebhookEntry[];
  history: SendRecord[];
  serverPort: number;
}

// ─── 常量 ───────────────────────────────────────────────
const MAX_HISTORY = 100;
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "config.json");

// ─── 内存数据 ───────────────────────────────────────────
let store: StoreData = {
  webhooks: [],
  history: [],
  serverPort: parseInt(process.env.SERVER_PORT || "3000", 10),
};

// ─── 持久化 ─────────────────────────────────────────────
function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function save(): void {
  ensureDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
}

export function load(): void {
  ensureDir();
  if (fs.existsSync(STORE_FILE)) {
    try {
      const raw = fs.readFileSync(STORE_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      store.webhooks = parsed.webhooks ?? [];
      store.history = parsed.history ?? [];
      if (parsed.serverPort) store.serverPort = parsed.serverPort;
      console.error(`[store] 已加载配置，${store.webhooks.length} 个 webhook`);
    } catch {
      console.error("[store] 配置文件损坏，使用默认值");
    }
  }

  // 如果环境变量提供了默认 webhook 且列表为空，自动加入
  const envUrl = process.env.DEFAULT_WEBHOOK_URL?.trim();
  if (envUrl && store.webhooks.length === 0) {
    store.webhooks.push({
      id: genId(),
      name: "默认(环境变量)",
      url: envUrl,
      isDefault: true,
      createdAt: new Date().toISOString(),
    });
    save();
  }
}

// ─── ID 生成 ────────────────────────────────────────────
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── Webhook CRUD ───────────────────────────────────────
export function getWebhooks(): WebhookEntry[] {
  return store.webhooks;
}

export function getWebhookById(id: string): WebhookEntry | undefined {
  return store.webhooks.find((w) => w.id === id);
}

export function getDefaultWebhook(): WebhookEntry | undefined {
  return store.webhooks.find((w) => w.isDefault) || store.webhooks[0];
}

export function addWebhook(name: string, url: string, isDefault = false): WebhookEntry {
  if (isDefault) {
    store.webhooks.forEach((w) => (w.isDefault = false));
  }
  const entry: WebhookEntry = {
    id: genId(),
    name,
    url,
    isDefault: isDefault || store.webhooks.length === 0,
    createdAt: new Date().toISOString(),
  };
  store.webhooks.push(entry);
  save();
  return entry;
}

export function updateWebhook(
  id: string,
  data: Partial<Pick<WebhookEntry, "name" | "url" | "isDefault">>
): WebhookEntry | null {
  const entry = store.webhooks.find((w) => w.id === id);
  if (!entry) return null;

  if (data.isDefault) {
    store.webhooks.forEach((w) => (w.isDefault = false));
  }
  if (data.name !== undefined) entry.name = data.name;
  if (data.url !== undefined) entry.url = data.url;
  if (data.isDefault !== undefined) entry.isDefault = data.isDefault;

  save();
  return entry;
}

export function deleteWebhook(id: string): boolean {
  const idx = store.webhooks.findIndex((w) => w.id === id);
  if (idx === -1) return false;
  const wasDefault = store.webhooks[idx].isDefault;
  store.webhooks.splice(idx, 1);
  // 如果删除的是默认，自动将第一个设为默认
  if (wasDefault && store.webhooks.length > 0) {
    store.webhooks[0].isDefault = true;
  }
  save();
  return true;
}

// ─── 发送记录 ───────────────────────────────────────────
export function addHistory(record: Omit<SendRecord, "id" | "timestamp">): SendRecord {
  const full: SendRecord = {
    ...record,
    id: genId(),
    timestamp: new Date().toISOString(),
  };
  store.history.unshift(full);
  if (store.history.length > MAX_HISTORY) {
    store.history = store.history.slice(0, MAX_HISTORY);
  }
  save();
  return full;
}

export function getHistory(limit = 50): SendRecord[] {
  return store.history.slice(0, limit);
}

export function clearHistory(): void {
  store.history = [];
  save();
}

// ─── 服务端口 ───────────────────────────────────────────
export function getServerPort(): number {
  return store.serverPort;
}

export function setServerPort(port: number): void {
  store.serverPort = port;
  save();
}
