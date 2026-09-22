export interface KeyText {
  title: string;
  author?: string;
  year?: string;
  url?: string;
}

/** 保留校验位置，让编辑器把同一条服务端规则的反馈放回对应字段。 */
export class KeyTextValidationError extends Error {
  constructor(message: string, public readonly index: number, public readonly field: keyof KeyText) {
    super(message);
    this.name = "KeyTextValidationError";
  }
}

/** 未提供与显式清空保持不同；这里只校验格式，不评价作品的权威性。 */
export function parseKeyTexts(value: unknown): KeyText[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("关键文本必须是作品列表");
  return value.map((item: unknown, index) => {
    if (!item || typeof item !== "object" || !("title" in item) || typeof item.title !== "string" || !item.title.trim()) {
      throw new KeyTextValidationError("关键文本需要作品名", index, "title");
    }
    const result: KeyText = { title: item.title.trim() };
    for (const field of ["author", "year", "url"] as const) {
      if (field in item) {
        const entry = (item as Record<string, unknown>)[field];
        if (typeof entry !== "string") throw new KeyTextValidationError("作者、年份和链接必须是文本", index, field);
        if (entry.trim()) result[field] = entry.trim();
      }
    }
    if (result.url) {
      let url: URL;
      try { url = new URL(result.url); } catch { throw new KeyTextValidationError("作品链接必须是有效的 HTTP(S) 地址", index, "url"); }
      if (!["https:", "http:"].includes(url.protocol)) throw new KeyTextValidationError("作品链接必须是有效的 HTTP(S) 地址", index, "url");
    }
    return result;
  });
}

export function formatKeyTexts(value: KeyText[] | undefined) {
  return value === undefined ? "未记录（保留当前值）" : value.map((item) => [item.title, item.author, item.year, item.url].filter(Boolean).join(" · ")).join("\n");
}
