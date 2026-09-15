// 服务端锚定投影（docs/passage-anchors.md「server adapter」）：把 sanitize 后的
// 渲染 hast 树投影成结构等价的 PassageNode 快照，供 indexPassage / relocateAnchor
// 在无浏览器环境下取得与客户端完全一致的规范化正文文本。
//
// 关键不变量：浏览器端索引的根是 div.wiki-content（block 容器，尾部换行保留），
// 因此这里把 hast root 投影为 DIV；元素/文本节点的结构按浏览器解析渲染 HTML
// 的结果一一对应（rehype-sanitize 不产生注释，wiki-link 两种落点都只输出显示文本，
// 图片已被过滤且本就不贡献偏移），投影前后可见文本完全一致。

import type { Node, Parent } from "unist";

import { renderMarkdownTree, wikiLinkResolver } from "@/lib/markdown";
import { indexPassage, type IndexedPassage, type PassageNode } from "@/lib/passage-anchors";

// 双链两种落点输出的显示文本相同（docs/passage-anchors.md），投影统一按红链解析
const redLinkResolver = wikiLinkResolver(new Map());

function projectChildren(node: Node): PassageNode[] {
  const projected: PassageNode[] = [];
  for (const child of (node as Parent).children ?? []) {
    if (child.type === "text") {
      projected.push({ nodeType: 3, nodeName: "#text", nodeValue: (child as Node & { value: string }).value, childNodes: [] });
    } else if (child.type === "element") {
      projected.push(projectElement(child));
    }
    // 其余节点类型（注释等）不贡献内容，与浏览器端索引规则一致
  }
  return projected;
}

function projectElement(node: Node): PassageNode {
  return {
    nodeType: 1,
    nodeName: ((node as Node & { tagName?: string }).tagName ?? "div").toUpperCase(),
    nodeValue: null,
    childNodes: projectChildren(node),
  };
}

/** 与客户端对 div.wiki-content 的 indexPassage 同构的正文索引。 */
export function indexMarkdownBody(source: string): IndexedPassage {
  const tree = renderMarkdownTree(source, redLinkResolver);
  return indexPassage({
    nodeType: 1,
    nodeName: "DIV",
    nodeValue: null,
    childNodes: projectChildren(tree),
  });
}

/** 渲染正文的规范化文本（历史修订与现行修订共用同一投影）。 */
export function canonicalMarkdownText(source: string): string {
  return indexMarkdownBody(source).text;
}
