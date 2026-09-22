"use client";

import Link from "next/link";
import { PageContainer } from "@/components/page-container";

export function DiscoveryError({ retry }: { retry: () => void }) {
  return (
    <PageContainer>
      <h1 className="text-3xl font-bold">内容读取失败</h1>
      <p role="alert" className="mt-4 text-muted-foreground">暂时无法读取内容，请稍后重试。这不表示当前索引没有内容。</p>
      <div className="mt-6 flex flex-wrap items-center gap-6 text-sm">
        <button type="button" onClick={() => retry()} className="border border-input px-4 py-2 hover:bg-muted">重新读取</button>
        <Link href="/" className="py-2 text-primary hover:underline">返回首页</Link>
      </div>
    </PageContainer>
  );
}
