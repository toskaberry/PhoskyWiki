"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { PerspectiveList } from "@/components/perspective-list";
import { RelatedTermsPanel } from "@/components/related-terms";
import { useGuestInterests } from "@/lib/guest-interest-store";
import { hasAnyInterest, serializeInterestSet } from "@/lib/interest-tags";
import type { TermDiscovery } from "@/lib/term-discovery";

export function TermDiscoveryPanel({ termId, initial, guest, resources, exploreNav, children }: {
  termId: number;
  initial: TermDiscovery;
  guest: boolean;
  resources: ReactNode;
  /** 继续探索区的索引导航（#97：词条页按真实存在的区块生成锚点）。 */
  exploreNav?: ReactNode;
  children: ReactNode;
}) {
  const selected = useGuestInterests();
  const requestKey = guest && selected && hasAnyInterest(selected)
    ? `${termId}:${serializeInterestSet(selected)}` : null;
  const [result, setResult] = useState<{ key: string; data: TermDiscovery } | null>(null);

  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    const interests = requestKey.slice(requestKey.indexOf(":") + 1);
    void fetch(`/api/terms/${termId}/discovery?interests=${encodeURIComponent(interests)}`, {
      cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("发现请求失败");
      const data: TermDiscovery = await response.json();
      if (!controller.signal.aborted) setResult({ key: requestKey, data });
    }).catch(() => {
      if (!controller.signal.aborted) setResult(null);
    });
    return () => controller.abort();
  }, [requestKey, termId]);

  // 水合、选择变更和请求失败期间保持 SSR 默认结果，旧请求不能覆盖新选择。
  const data = requestKey && result?.key === requestKey ? result.data : initial;
  const others = data.perspectives;
  return (
    <>
      <section aria-labelledby="perspectives-heading" className="mt-12">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="perspectives-heading" className="text-2xl font-semibold">
            诠释者视角（{others.length}）
          </h2>
          {!guest && (
            <Link
              href={`/new/perspective?term=${termId}`}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              撰写视角 +
            </Link>
          )}
        </div>
        <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
          各视角平等并列，排序不代表权威。未设置相关兴趣时，按站内引用排序。
        </p>
        {others.length > 0 ? (
          <PerspectiveList items={others} interestInterpreterIds={data.interestInterpreterIds} />
        ) : (
          <p className="text-sm text-muted-foreground">该词条暂无诠释者的视角。</p>
        )}
      </section>
      {resources}
      <section aria-labelledby="term-explore-heading" className="mt-12 border-t border-border pt-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h2 id="term-explore-heading" className="text-2xl font-semibold">继续探索</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">从相关词条、引用本页的视角与双链邻居，找到下一步阅读入口。</p>
          </div>
          {exploreNav}
        </div>
        <RelatedTermsPanel items={data.relatedTerms} />
        {children}
      </section>
    </>
  );
}
