import Link from "next/link";

import type { BacklinkItem } from "@/lib/content";
import { pagePath } from "@/lib/slug";

/** 反链面板：引用本页的视角列表（词条页与视角页共用，数据来自 links 表）。 */
export function BacklinkPanel({ items }: { items: BacklinkItem[] }) {
  return (
    <section aria-labelledby="backlinks-heading" className="mt-10 scroll-mt-20">
      <h2 id="backlinks-heading" className="mb-4 flex flex-wrap items-baseline gap-2 text-xl font-semibold">
        反链
        <span className="font-mono text-sm font-normal text-muted-foreground">（{items.length}）</span>
      </h2>
      {items.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {items.map((item) => (
            <li key={item.pageId} className="px-4 py-3">
              <Link
                href={pagePath("perspective", item.slug, item.pageId)}
                className="font-medium underline-offset-4 hover:underline"
              >
                {item.title}
              </Link>
              <span className="ml-2 text-sm text-muted-foreground">
                属于词条{" "}
                <Link
                  href={pagePath("term", item.termSlug, item.termId)}
                  className="hover:text-foreground hover:underline"
                >
                  {item.termTitle}
                </Link>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">暂无视角引用本页。</p>
      )}
    </section>
  );
}
