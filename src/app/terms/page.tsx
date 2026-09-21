import { PageContainer } from "@/components/page-container";
import Link from "next/link";

import { listTerms } from "@/lib/content";
import { pagePath } from "@/lib/slug";

export const dynamic = "force-dynamic";
export const metadata = { title: "词条索引" };

export default async function TermsPage() {
  const terms = await listTerms();
  return (
    <PageContainer className="py-10">
      <h1 className="text-3xl font-bold tracking-tight">词条索引</h1>
      <p className="mt-3 text-muted-foreground">从一个概念出发，比较不同诠释者的视角。共 {terms.length} 个词条。</p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {terms.map((term) => (
          <li key={term.id} className="min-w-0 rounded-lg border p-5">
            <Link href={pagePath("term", term.slug, term.id)} className="break-words text-lg font-semibold underline-offset-4 hover:underline">{term.title}</Link>
            <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">{term.summary}</p>
            <p className="mt-4 text-xs text-muted-foreground">{term.perspectiveCount} 个视角</p>
          </li>
        ))}
      </ul>
      {terms.length === 0 && <p className="mt-8 text-muted-foreground">还没有词条，欢迎参与共建。</p>}
    </PageContainer>
  );
}
