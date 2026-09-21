import { PageContainer } from "@/components/page-container";
import { DiscoveryHeader, DiscoveryEmpty } from "@/components/discovery";
import type { Metadata } from "next";
import Link from "next/link";

import type { CategoryTreeNode } from "@/lib/categories";
import { categoryPath } from "@/lib/categories";
import { getCategoryTree } from "@/lib/content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "分类 · PhoskyWiki" };

function CategoryTreeNodeItem({ node }: { node: CategoryTreeNode }) {
  return (
    <li className="min-w-0 py-3">
      <Link
        href={categoryPath(node.slug)}
        className="min-w-0 break-words text-lg font-medium text-primary underline-offset-4 hover:underline"
      >
        {node.name}
      </Link>
      <span className="mt-1 block text-xs text-muted-foreground">
        {node.termCount} 个词条
      </span>
      {node.children.length > 0 && (
        <ul className="mt-3 ml-2 divide-y divide-border border-l border-border pl-3 sm:ml-4 sm:pl-4">
          {node.children.map((child) => (
            <CategoryTreeNodeItem key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function countNodes(nodes: CategoryTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
}

export default async function CategoriesPage() {
  const tree = await getCategoryTree();
  const total = countNodes(tree);

  return (
    <PageContainer>
      <DiscoveryHeader label="知识主题 / 分类" title="分类">
        <p>分类按知识主题组织词条，一个词条可同时出现在多个分类下。学派则组织诠释者。</p>
      </DiscoveryHeader>

      <section aria-labelledby="tree-heading" className="mt-10">
        <h2 id="tree-heading" className="mb-6 text-xl font-semibold">
          分类树（{total}）
        </h2>
        {tree.length > 0 ? (
          <ul className="divide-y divide-border border-y border-border">
            {tree.map((root) => (
              <CategoryTreeNodeItem key={root.id} node={root} />
            ))}
          </ul>
        ) : (
          <DiscoveryEmpty href="/terms" label="浏览词条索引">暂无分类。</DiscoveryEmpty>
        )}
      </section>
    </PageContainer>
  );
}
