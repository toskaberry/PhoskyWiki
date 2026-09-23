import { PageContainer } from "@/components/page-container";
import { DiscoveryHeader, DiscoveryList, DiscoveryRow, DiscoveryEmpty } from "@/components/discovery";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { getCategoryDetailBySlug } from "@/lib/content";
import { categoryPath } from "@/lib/categories";
import { decodePageKey, pagePath } from "@/lib/slug";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const category = await getCategoryDetailBySlug(decodePageKey((await params).slug));
  return category ? { title: `分类：${category.name} · PhoskyWiki` } : {};
}

export default async function CategoryPage({ params }: Params) {
  const category = await getCategoryDetailBySlug(decodePageKey((await params).slug));
  if (!category) notFound();

  return (
    <PageContainer>
      <nav aria-label="面包屑" className="mb-6 flex flex-wrap items-center gap-y-2 break-words text-sm text-muted-foreground">
        <Link href="/" className="min-w-0 break-words py-1 hover:text-foreground">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <Link href="/categories" className="min-w-0 break-words py-1 hover:text-foreground">
          分类
        </Link>
        {category.path.map((ancestor) => (
          <span key={ancestor.id} className="contents">
            <span className="mx-1.5">/</span>
            <Link href={categoryPath(ancestor.slug)} className="min-w-0 break-words py-1 hover:text-foreground">
              {ancestor.name}
            </Link>
          </span>
        ))}
        <span className="mx-1.5">/</span>
        <span aria-current="page" className="min-w-0 break-words">{category.name}</span>
      </nav>

      <DiscoveryHeader label="知识主题 / 分类" title={category.name}>
        <p>分类 · {category.terms.length} 个词条{category.children.length > 0 && ` · ${category.children.length} 个子分类`}</p>
      </DiscoveryHeader>

      {category.children.length > 0 && (
        <section aria-labelledby="children-heading" className="mt-8">
          <h2 id="children-heading" className="mb-3 text-lg font-semibold">
            子分类
          </h2>
          <ul className="flex flex-wrap gap-2">
            {category.children.map((child) => (
              <li key={child.id} className="min-w-0 max-w-full">
                <Link
                  href={categoryPath(child.slug)}
                  className="inline-flex max-w-full items-baseline gap-2 border-b border-border py-2 text-sm text-primary hover:border-primary"
                >
                  <span className="min-w-0 break-words">{child.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{child.termCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="terms-heading" className="mt-10">
        <h2 id="terms-heading" className="mb-4 text-xl font-semibold">
          词条（{category.terms.length}）
        </h2>
        {category.terms.length > 0 ? (
          <DiscoveryList>
            {category.terms.map((term) => (
              <DiscoveryRow key={term.id} href={pagePath("term", term.slug, term.id)} title={term.title} description={term.summary} meta="词条" />
            ))}
          </DiscoveryList>
        ) : (
          <DiscoveryEmpty href="/categories" label="返回分类索引">该分类下暂无词条。</DiscoveryEmpty>
        )}
      </section>
    </PageContainer>
  );
}
