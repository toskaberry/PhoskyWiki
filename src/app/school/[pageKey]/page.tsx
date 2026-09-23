import Link from "next/link";
import { HistoryLink } from "@/components/history-link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PageContainer } from "@/components/page-container";
import { DiscoveryHeader, DiscoveryList, DiscoveryRow, DiscoveryEmpty, DiscoveryFacts } from "@/components/discovery";
import {
  getSchoolDetail,
  listSchoolCoreTerms,
  listSchoolMembers,
} from "@/lib/content";
import { formatYears } from "@/lib/format";
import { pageIdFromKey, pagePath } from "@/lib/slug";
import { resolveLivePage } from "@/lib/resolve-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pageKey: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const id = pageIdFromKey((await params).pageKey);
  if (!id) return {};
  const school = await getSchoolDetail(id);
  return school ? { title: school.title, description: school.summary } : {};
}

export default async function SchoolPage({ params }: Params) {
  const page = await resolveLivePage("school", (await params).pageKey);
  const [school, members, coreTerms] = await Promise.all([
    getSchoolDetail(page.id),
    listSchoolMembers(page.id),
    listSchoolCoreTerms(page.id),
  ]);
  if (!school) notFound();

  return (
    <PageContainer>
      <nav aria-label="面包屑" className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2 break-words text-sm text-muted-foreground">
        <Link href="/" className="py-1 hover:text-foreground">首页</Link><span>/</span>
        <Link href="/schools" className="py-1 hover:text-foreground">学派</Link><span>/</span>
        <span aria-current="page" className="min-w-0 break-words">{school.title}</span>
      </nav>
      <DiscoveryHeader label="思想脉络 / 学派档案" title={school.title}>
        {school.summary && <p>{school.summary}</p>}
      </DiscoveryHeader>
      <div className="my-4"><HistoryLink pageId={page.id} /></div>
      <div className="grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 lg:order-2">
          <DiscoveryFacts title="学派资料" rows={[
            { label: "类型", content: "学派（诠释者分组）" },
            { label: "成员", content: `${members.length} 位诠释者` },
            { label: "核心词条", content: `${coreTerms.length} 个（成员视角派生）` },
          ]} />
        </div>
        <div className="min-w-0 lg:order-1">
          <section aria-labelledby="members-heading">
            <h2 id="members-heading" className="mb-4 text-xl font-semibold">成员诠释者（{members.length}）</h2>
            {members.length > 0 ? (
              <DiscoveryList>
                {members.map((member) => (
                  <DiscoveryRow key={member.interpreterId} href={pagePath("interpreter", member.slug, member.interpreterId)} title={member.name}
                    meta={`${member.perspectiveCount} 个视角`}
                    description={member.birthYear != null || member.deathYear != null ? formatYears(member.birthYear, member.deathYear) : undefined} />
                ))}
              </DiscoveryList>
            ) : (
              <DiscoveryEmpty href="/interpreters" label="浏览诠释者索引">该学派暂无成员诠释者。</DiscoveryEmpty>
            )}
          </section>
          <section aria-labelledby="core-terms-heading" className="mt-10">
            <h2 id="core-terms-heading" className="mb-2 text-xl font-semibold">学派核心词条（{coreTerms.length}）</h2>
            <p className="mb-4 text-sm leading-7 text-muted-foreground">核心词条由成员视角聚合派生，按成员视角数排序。同一词条可连接多个学派，不表示概念的排他归属。</p>
            {coreTerms.length > 0 ? (
              <DiscoveryList>
                {coreTerms.map((term) => (
                  <DiscoveryRow key={term.termId} href={pagePath("term", term.slug, term.termId)} title={term.title} meta={`成员视角 ${term.perspectiveCount} 篇`} />
                ))}
              </DiscoveryList>
            ) : (
              <DiscoveryEmpty href="/terms" label="浏览词条索引">成员还没有已收录的视角，暂无法派生核心词条。</DiscoveryEmpty>
            )}
          </section>
        </div>
      </div>
    </PageContainer>
  );
}
