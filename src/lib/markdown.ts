// Markdown 渲染管线（纯函数，无 IO）：unified/remark 扩展 wiki-link（ADR-0003、spec 技术栈）。
//
// `[[词条名]]` 渲染为落词条枢纽的站内链接；`[[词条名|视角@诠释者]]` 直落视角页。
// 落点由调用方注入的 resolveWikiLink 决定——读路径上传入该页 links 表的解析结果
// （受理时的解析结果即真相）；目标不存在（红链）渲染为带 title 提示的 span，不可点击。

import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkRehype from "remark-rehype";

import type { Node, Parent } from "unist";

import { parseWikiLink, wikiLinkKey, type WikiLinkRef } from "@/lib/wiki-links";
import { filterRenderedImages } from "@/lib/image-markdown";
import { markdownParser, visitWikiLinks } from "@/lib/markdown-ast";

export interface WikiLinkTarget {
  /** 已解析目标的站内路径（如 /term/主体性-3）；红链为空字符串 */
  href: string;
  /** false = 目标页不存在（红链） */
  exists: boolean;
  /** 已解析的页面因软删除或父页面删除而暂不可用，不是写作缺口。 */
  unavailable?: boolean;
}

export type ResolveWikiLink = (ref: WikiLinkRef) => WikiLinkTarget;

/** 用 links 表解析结果（键 = wikiLinkKey）构造渲染器的落点回调；未命中即红链。 */
export function wikiLinkResolver(
  targets: Map<string, WikiLinkTarget>,
): ResolveWikiLink {
  return (ref) => targets.get(wikiLinkKey(ref)) ?? { href: "", exists: false };
}

/**
 * 用解析结果改写 wikiLink 节点的 hast 输出。
 * remark-wiki-link 自带的 permalinks/exists 机制是「预知全集」式的，
 * 不适合按名称逐个解析的回调式落点；这里在 mdast 阶段全量接管 hName/hProperties。
 */
function rewriteWikiLinks(resolve: ResolveWikiLink) {
  return (tree: Node) => {
    visitWikiLinks(tree, (node) => {
      const parsed = parseWikiLink(node.value, node.data?.alias ?? null);
      // remark-wiki-link 保证 value 非空，解析失败仅可能来自空白名，防御性跳过
      if (!parsed) return;
      const { href, exists, unavailable } = resolve(parsed);
      if (exists) {
        node.data!.hProperties = { className: ["wiki-link"], href };
      } else {
        node.data!.hName = "span";
        node.data!.hProperties = {
          className: ["wiki-link", unavailable ? "wiki-link--unavailable" : "wiki-link--red"],
          title: unavailable ? "页面暂不可用" : parsed.interpreter === null ? "词条尚未创建" : "视角尚未创建",
        };
      }
      node.data!.hChildren = [{ type: "text", value: parsed.display }];
    });
  };
}

// sanitize 默认剥掉 class/title；渲染出来的 wiki-link 类名与提示需要放行。
// 注意 defaultSchema 里 className 是值受限元组（如 ["className","data-footnote-backref"]），
// 直接追加会命中元组把自定义类名滤空——必须先移除元组再放行任意值。
type SanitizeAttributes = NonNullable<typeof defaultSchema.attributes>["a"];

function withAttributes(attrs: SanitizeAttributes, allowed: string[]): SanitizeAttributes {
  const kept = attrs.filter(
    (attr) => (Array.isArray(attr) ? attr[0] : attr) !== "className",
  );
  return [...kept, ...allowed];
}

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: withAttributes(defaultSchema.attributes?.a ?? [], ["className", "title"]),
    span: withAttributes(defaultSchema.attributes?.span ?? [], ["className", "title"]),
    code: withAttributes(defaultSchema.attributes?.code ?? [], ["className"]),
  },
};

/** 把 Markdown 源文本渲染为可安全注入的 HTML 字符串。 */
export function renderMarkdown(
  source: string,
  resolveWikiLink: ResolveWikiLink,
): string {
  return markdownProcessor(resolveWikiLink).processSync(source).toString();
}

/**
 * 与 renderMarkdown 同一管线（含 sanitize 与图片过滤，不含 stringify）的 hast 树。
 * 供锚定投影（lib/passage-body.ts）在服务端取得与浏览器解析渲染 HTML 等价的结构。
 */
export function renderMarkdownTree(
  source: string,
  resolveWikiLink: ResolveWikiLink,
): Node {
  const processor = markdownProcessor(resolveWikiLink);
  return processor.runSync(processor.parse(source));
}

function markdownProcessor(resolveWikiLink: ResolveWikiLink) {
  return markdownParser()
    .use(rewriteWikiLinks, resolveWikiLink)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSanitize, sanitizeSchema)
    .use(filterRenderedImages)
    .use(rehypeStringify);
}

/** Agent 上下文使用同一渲染管线的可见文本，保留段落边界。 */
export function renderMarkdownText(source: string, resolve: ResolveWikiLink): string {
  const processor = markdownProcessor(resolve);
  const tree = processor.runSync(processor.parse(source));
  function visibleText(node: Node): string {
    if (node.type === "text") return (node as Node & { value: string }).value;
    const text = ((node as Parent).children ?? []).map(visibleText).join("");
    const tag = (node as Node & { tagName?: string }).tagName;
    return tag && /^(p|h[1-6]|li|blockquote|pre|br|hr)$/.test(tag) ? `${text}\n` : text;
  }
  return visibleText(tree).replace(/\n{3,}/g, "\n\n").trim();
}
