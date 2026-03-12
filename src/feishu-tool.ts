import {
  getAllowedWebhookPrefixes,
  maskWebhookUrl,
} from "./config.js";
import { getDefaultWebhook, getWebhooks, addHistory } from "./store.js";

// ─── 常量 ───────────────────────────────────────────────
const FEISHU_WEBHOOK_PATTERN =
  /^https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/.+/;
const REQUEST_TIMEOUT_MS = 8_000;
const RETRY_BACKOFF_MS = 300;
const MAX_RAW_LENGTH = 2048;

// ─── 类型 ───────────────────────────────────────────────
export interface FeishuSendTextInput {
  webhookUrl?: string;
  text: string;
  tag?: string;
}

export interface FeishuSendTextResult {
  ok: boolean;
  httpStatus: number;
  feishuCode: number | null;
  feishuMsg: string | null;
  raw: string;
}

// ─── 校验 webhookUrl ────────────────────────────────────
function resolveAndValidateUrl(inputUrl?: string): { url: string; name: string } {
  let url = inputUrl?.trim() || "";
  let name = "直接调用";

  if (!url) {
    const defaultEntry = getDefaultWebhook();
    if (defaultEntry) {
      url = defaultEntry.url;
      name = defaultEntry.name;
    }
  } else {
    // 尝试通过名称匹配已配置的 webhook
    const all = getWebhooks();
    const match = all.find((w) => w.url === url);
    if (match) name = match.name;
  }

  if (!url) {
    throw new Error("webhookUrl 未提供且未配置任何 Webhook 地址");
  }

  if (!FEISHU_WEBHOOK_PATTERN.test(url)) {
    throw new Error(
      "webhookUrl 格式不合法，需要 https://open.feishu.cn/open-apis/bot/v2/hook/..."
    );
  }

  const prefixes = getAllowedWebhookPrefixes();
  if (prefixes.length > 0) {
    const allowed = prefixes.some((p) => url.startsWith(p));
    if (!allowed) {
      throw new Error(
        "webhookUrl 不在允许的前缀列表中 (ALLOWED_WEBHOOK_PREFIXES)"
      );
    }
  }

  return { url, name };
}

// ─── 单次 HTTP 请求 ─────────────────────────────────────
async function doPost(
  url: string,
  body: string
): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body,
      signal: controller.signal,
    });
    const text = await resp.text();
    return { status: resp.status, text };
  } finally {
    clearTimeout(timer);
  }
}

// ─── 发送（含 1 次重试） ────────────────────────────────
async function postWithRetry(
  url: string,
  body: string
): Promise<{ status: number; text: string }> {
  try {
    return await doPost(url, body);
  } catch (err) {
    console.error(
      `[feishu] 首次请求失败 (${maskWebhookUrl(url)})，${RETRY_BACKOFF_MS}ms 后重试...`,
      (err as Error).message
    );
    await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    return await doPost(url, body);
  }
}

// ─── 工具主逻辑 ─────────────────────────────────────────
export async function feishuSendText(
  input: FeishuSendTextInput
): Promise<FeishuSendTextResult> {
  const { url, name: webhookName } = resolveAndValidateUrl(input.webhookUrl);

  console.error(
    `[feishu] 发送消息到 ${maskWebhookUrl(url)}，文本长度=${input.text.length}`
  );

  const payload = JSON.stringify({
    msg_type: "text",
    content: { text: input.text },
  });

  let status: number;
  let rawText: string;

  try {
    const resp = await postWithRetry(url, payload);
    status = resp.status;
    rawText = resp.text;
  } catch (err) {
    const msg = (err as Error).message || String(err);
    const result: FeishuSendTextResult = {
      ok: false,
      httpStatus: 0,
      feishuCode: null,
      feishuMsg: `请求异常: ${msg}`,
      raw: msg.slice(0, MAX_RAW_LENGTH),
    };
    addHistory({
      webhookName,
      text: input.text.slice(0, 200),
      ok: false,
      httpStatus: 0,
      feishuCode: null,
      feishuMsg: result.feishuMsg,
    });
    return result;
  }

  const raw =
    rawText.length > MAX_RAW_LENGTH
      ? rawText.slice(0, MAX_RAW_LENGTH)
      : rawText;

  let feishuCode: number | null = null;
  let feishuMsg: string | null = null;
  try {
    const json = JSON.parse(rawText);
    feishuCode =
      typeof json.code === "number"
        ? json.code
        : typeof json.StatusCode === "number"
          ? json.StatusCode
          : null;
    feishuMsg =
      typeof json.msg === "string"
        ? json.msg
        : typeof json.StatusMessage === "string"
          ? json.StatusMessage
          : null;
  } catch {
    // 非 JSON 返回
  }

  const httpOk = status >= 200 && status < 300;
  const feishuOk = feishuCode === 0;
  const ok = httpOk && feishuOk;

  console.error(
    `[feishu] 结果: ok=${ok}, httpStatus=${status}, feishuCode=${feishuCode}`
  );

  // 记录到历史
  addHistory({
    webhookName,
    text: input.text.slice(0, 200),
    ok,
    httpStatus: status,
    feishuCode,
    feishuMsg,
  });

  return { ok, httpStatus: status, feishuCode, feishuMsg, raw };
}
