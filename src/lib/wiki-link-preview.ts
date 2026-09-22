// 双链预览的最小目标信息（#85）：只读当前公开内容，作为公开读取边界的扩展。
//
// 普通词条链接 → 词条名 + 已有简介 + 最多两个视角入口（沿用词条页默认排序，
// 不引入权威排序）；显式视角链接 → 诠释者 + 该视角当前公开正文的开头纯文本摘录。
// 不生成新总结、不新增摘要字段；隐藏目标（软删除或父页面下线）一律返回 null，
// 由调用方按不可预览处理——预览永远不得绕过页面可见性读取最新正文。

import "server-only";

import {
  getHeadContent,
  getLivePage,
  getPerspectiveDetail,
  getTermDetail,
  listPerspectivesOfTerm,
} from "@/lib/content";
import { renderMarkdownText, wikiLinkResolver } from "@/lib/markdown";
import { pagePath } from "@/lib/slug";

/** 卡片文字（简介/摘录）的服务端截断长度，约 150 字；卡片内再按空间收紧。 */
export const PREVIEW_TEXT_LIMIT = 150;
/** 普通词条预览最多提供的视角入口数。 */
export const PREVIEW_PERSPECTIVE_LIMIT = 2;

export interface WikiLinkPreviewEntry {
  /** 视角页标题（如「拉康论主体性」），入口的无障碍名称来源。 */
  title: string;
  /** 入口显示文字：诠释者名（视角平等并列，卡片只作导航入口）。 */
  interpreterName: string;
  href: string;
}

export interface WikiLinkTermPreview {
  kind: "term";
  title: string;
  /** 词条已有简介；空串由卡片显示「暂无简介」。 */
  summary: string;
  perspectives: WikiLinkPreviewEntry[];
}

export interface WikiLinkPerspectivePreview {
  kind: "perspective";
  title: string;
  interpreterName: string;
  /** 当前公开正文的开头纯文本摘录；空串由卡片显示「暂无正文」。 */
  excerpt: string;
}

export type WikiLinkPreview = WikiLinkTermPreview | WikiLinkPerspectivePreview;

/** 压缩空白并按字数截断；超出加省略号。简介与摘录共用同一规则。 */
export function clampPreviewText(text: string, limit = PREVIEW_TEXT_LIMIT): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit)}…`;
}

/**
 * 预览目标的最小公开信息。目标不存在、已软删除，或（视角的）所属词条/
 * 诠释者下线时返回 null——与页面公开读取同一口径。
 */
export async function getWikiLinkPreview(pageId: number): Promise<WikiLinkPreview | null> {
  const page = await getLivePage(pageId);
  if (!page) return null;

  if (page.type === "term") {
    const detail = await getTermDetail(pageId);
    if (!detail) return null;
    const perspectives = (await listPerspectivesOfTerm(pageId))
      .slice(0, PREVIEW_PERSPECTIVE_LIMIT)
      .map((perspective) => ({
        title: perspective.title,
        interpreterName: perspective.interpreterName,
        href: pagePath("perspective", perspective.slug, perspective.pageId),
      }));
    return { kind: "term", title: detail.title, summary: clampPreviewText(detail.summary), perspectives };
  }

  if (page.type === "perspective") {
    const detail = await getPerspectiveDetail(pageId);
    if (!detail) return null;
    const content = await getHeadContent(pageId);
    // 管线里的链接落点不影响可见文本，摘录用红链解析即可（与锚定投影同口径）
    const excerpt = clampPreviewText(
      content === null ? "" : renderMarkdownText(content, wikiLinkResolver(new Map())),
    );
    return { kind: "perspective", title: detail.title, interpreterName: detail.interpreterName, excerpt };
  }

  return null;
}
