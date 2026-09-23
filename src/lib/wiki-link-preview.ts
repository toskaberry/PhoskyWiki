import "server-only";

import { getWikiPreview } from "@/lib/wiki-preview";

/** 兼容旧公开路径的数据形状；可见性与摘录统一由主预览的只读快照提供。 */
export async function getWikiLinkPreview(pageId: number) {
  const preview = await getWikiPreview(pageId);
  if (!preview) return null;
  if (preview.type === "term") {
    return {
      kind: "term" as const,
      title: preview.title,
      summary: preview.excerpt,
      perspectives: preview.perspectives,
    };
  }
  return {
    kind: "perspective" as const,
    title: preview.title,
    interpreterName: preview.interpreterName,
    excerpt: preview.excerpt,
  };
}
