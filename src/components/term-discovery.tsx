"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PerspectiveList } from "@/components/perspective-list";
import { RelatedTermsPanel } from "@/components/related-terms";
import { useGuestInterests } from "@/lib/guest-interest-store";
import { hasAnyInterest, serializeInterestSet } from "@/lib/interest-tags";
import type { TermDiscovery } from "@/lib/term-discovery";

export function TermDiscoveryPanel({ termId, initial, guest }: {
  termId: number;
  initial: TermDiscovery;
  guest: boolean;
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
          <h2 id="perspectives-heading" className="text-xl font-semibold">
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
        {others.length > 0 ? (
          <PerspectiveList items={others} interestInterpreterIds={data.interestInterpreterIds} />
        ) : (
          <p className="text-sm text-muted-foreground">该词条暂无诠释者的视角。</p>
        )}
      </section>
      <RelatedTermsPanel items={data.relatedTerms} />
    </>
  );
}
