import Link from "next/link";

import type { RelatedTerm } from "@/lib/recommend";

/**
 * 词条页「相关词条」推荐区块（T12）：共同引用 + 兴趣匹配。
 * 无邻居（没有双链关联）的词条不渲染本区块。
 */
export function RelatedTermsPanel({ items }: { items: RelatedTerm[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="related-terms-heading" className="mt-12">
      <h2 id="related-terms-heading" className="text-xl font-semibold">
        相关词条
      </h2>
      <ul data-testid="related-terms" className="mt-4 grid border-t border-border sm:grid-cols-2 sm:gap-x-8">
        {items.map((term) => (
          <li key={term.id} className="min-w-0 border-b border-border py-4">
            <Link href={term.href} className="break-words font-medium hover:underline">
              {term.title}
            </Link>
            <p className="mt-1.5 text-xs text-muted-foreground">
              共同引用 {term.commonRefCount} 次
              {term.interestMatchCount > 0 && (
                <span
                  data-testid="interest-match-badge"
                  className="ml-2 rounded bg-secondary px-1.5 py-0.5"
                >
                  兴趣相关
                </span>
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
