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

/** 将 webhook URL 脱敏，只显示域名部分 + 最后4位 */
export function maskWebhookUrl(url: string): string {
  try {
    const u = new URL(url);
    const pathParts = u.pathname;
    // 取路径最后一段的最后4位
    const lastSegment = pathParts.split("/").filter(Boolean).pop() || "";
    const tail = lastSegment.length > 4 ? lastSegment.slice(-4) : lastSegment;
    return `${u.origin}/****${tail ? "..." + tail : ""}`;
  } catch {
    // 非标准 URL，只保留前10字符
    if (url.length <= 10) return url;
    return url.slice(0, 10) + "****";
  }
}
