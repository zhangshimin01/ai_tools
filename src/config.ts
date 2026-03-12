/**
 * 环境变量配置 —— 安全相关
 */

/** 允许的 webhook URL 前缀列表（逗号分隔） */
export function getAllowedWebhookPrefixes(): string[] {
  const raw = process.env.ALLOWED_WEBHOOK_PREFIXES?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 将 webhook URL 脱敏，只保留前 25 字符 */
export function maskWebhookUrl(url: string): string {
  if (url.length <= 25) return url;
  return url.slice(0, 25) + "...";
}
