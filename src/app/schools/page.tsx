import { PageContainer } from "@/components/page-container";
import type { Metadata } from "next";
import Link from "next/link";

import { listSchools } from "@/lib/content";
import { pagePath } from "@/lib/slug";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "学派 · PhoskyWiki" };

export default async function SchoolsPage() {
  const schools = await listSchools();

  return (
    <PageContainer>
      <h1 className="text-3xl font-bold tracking-tight">学派</h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">
        学派是诠释者的分组导航实体：它只组织人，不组织词条——学派的核心词条由成员的视角聚合而来。
      </p>

      <section aria-labelledby="schools-heading" className="mt-10">
        <h2 id="schools-heading" className="mb-6 text-xl font-semibold">
          全部学派（{schools.length}）
        </h2>
        {schools.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2">
            {schools.map((school) => (
              <li
                key={school.id}
                className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/30"
              >
                <Link
                  href={pagePath("school", school.slug, school.id)}
                  className="text-lg font-semibold underline-offset-4 hover:underline"
                >
                  {school.title}
                </Link>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {school.summary}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {school.memberCount} 位成员 · {school.coreTermCount} 个核心词条
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            暂无学派。本地开发可运行 <code>pnpm db:seed</code> 灌入演示内容。
          </p>
        )}
      </section>
    </PageContainer>
  );
}
