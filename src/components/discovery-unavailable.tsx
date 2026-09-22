import Link from "next/link";
import { PageContainer } from "@/components/page-container";

export function DiscoveryUnavailable() {
  return (
    <PageContainer>
      <h1 className="text-3xl font-bold">页面暂不可用</h1>
      <p className="mt-4 text-muted-foreground">该页面不存在或当前无法公开访问。可以返回索引继续浏览。</p>
      <nav aria-label="返回索引" className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-primary">
        <Link href="/terms" className="py-2 hover:underline">词条索引</Link>
        <Link href="/interpreters" className="py-2 hover:underline">诠释者索引</Link>
        <Link href="/schools" className="py-2 hover:underline">学派索引</Link>
        <Link href="/categories" className="py-2 hover:underline">分类索引</Link>
      </nav>
    </PageContainer>
  );
}
