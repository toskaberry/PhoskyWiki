import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import type { Node, Parent } from "unist";

import { renderMarkdownTree, type ResolveWikiLink } from "@/lib/markdown";

export interface ReadingHeading {
  id: string;
  title: string;
  depth: number;
}

type Element = Parent & { tagName: string; properties: Record<string, unknown> };

function visibleText(node: Node): string {
  if (node.type === "text") return (node as Node & { value: string }).value;
  return ((node as Parent).children ?? []).map(visibleText).join("");
}

/** Add only heading attributes to the existing sanitized tree: passage text and offsets stay intact. */
export function renderReadingMarkdown(source: string, resolve: ResolveWikiLink) {
  const tree = renderMarkdownTree(source, resolve);
  const headings: ReadingHeading[] = [];
  const used = new Set<string>();
  function visit(node: Node) {
    if (node.type === "element") {
      const element = node as Element;
      if (/^h[1-6]$/.test(element.tagName)) {
        const title = visibleText(element).trim();
        if (title) {
          const slug = title.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
          const base = `chapter-${slug || "section"}`;
          let id = base;
          for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
          used.add(id);
          element.properties.id = id;
          headings.push({ id, title, depth: Number(element.tagName[1]) });
        }
      }
    }
    for (const child of (node as Parent).children ?? []) visit(child);
  }
  visit(tree);
  return { html: unified().use(rehypeStringify).stringify(tree), headings };
}
