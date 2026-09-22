/** 账户流程只接受站内路径；拒绝协议相对地址、反斜杠和 URL 控制字符。 */
export function safeAuthRedirect(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value?.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  return value;
}

export function authPageHref(page: "login" | "register" | "reset-password", redirectTo?: string | null): string {
  const destination = safeAuthRedirect(redirectTo ?? undefined);
  return `/${page}${destination ? `?redirect=${encodeURIComponent(destination)}` : ""}`;
}
