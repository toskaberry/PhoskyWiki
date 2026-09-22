"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { reorderPerspectivesByInterest } from "@/lib/interest-tags";

export interface PerspectiveListProps {
  items: {
    pageId: number;
    title: string;
    href: string;
    interpreterId: number;
    interpreterName: string;
    interpreterHref: string;
    linkCount: number;
  }[];
  /**
   * 服务端（登录态）兴趣重排用的诠释者 id 集：items 已按它排好，这里幂等地
   * 再排一次即可；游客和账号均由发现模块提供经过有效对象过滤与学派展开的集合。
   */
  interestInterpreterIds?: number[] | null;
}

// 词条页视角列表默认露出条数（spec：默认露 5~8 条 + 展开全部）
const DEFAULT_VISIBLE = 5;

export function PerspectiveList({ items, interestInterpreterIds = null }: PerspectiveListProps) {
  const [expanded, setExpanded] = useState(false);
  const interestedIds = interestInterpreterIds;

  // 兴趣诠释者 → 其余；组内保持传入序（服务端已按热度排好）
  const ordered = useMemo(() => {
    if (!interestedIds || interestedIds.length === 0) return items;
    return reorderPerspectivesByInterest(items, new Set(interestedIds));
  }, [items, interestedIds]);

  const visible = expanded ? ordered : ordered.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = Math.max(0, ordered.length - DEFAULT_VISIBLE);

  return (
    <div>
      {interestedIds !== null && interestedIds.length > 0 && (
        <p
          data-testid="interest-reorder-hint"
          className="mb-3 text-sm text-muted-foreground"
        >
          已按你的兴趣把相关诠释者的视角排前。
        </p>
      )}
      <ul aria-label="视角目录" className="divide-y divide-border border-y border-border">
        {visible.map((item) => (
          <li key={item.pageId} className="grid min-w-0 gap-2 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
            <div className="min-w-0">
              <Link href={item.href} className="break-words text-lg font-medium leading-relaxed hover:underline">
                {item.title}
              </Link>
              <span className="mt-1 block text-sm text-muted-foreground">
                诠释者 · {" "}
                <Link
                  href={item.interpreterHref}
                  className="hover:text-foreground hover:underline"
                >
                  {item.interpreterName}
                </Link>
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span
                className="text-xs text-muted-foreground"
                title="被站内双链引用的次数"
              >
                {item.linkCount} 次引用
              </span>
            </div>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-4 min-h-11 border border-input px-4 py-2 text-sm hover:bg-muted"
        >
          {expanded ? "收起" : `展开全部（还有 ${hiddenCount} 条）`}
        </button>
      )}
    </div>
  );
}
