import { PageContainer } from "@/components/page-container";
import { DiscoveryHeader, DiscoveryList, DiscoveryRow, DiscoveryEmpty, DiscoveryFacts } from "@/components/discovery";
import { KeyTexts } from "@/components/key-texts";
import Link from "next/link";
import { HistoryLink } from "@/components/history-link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  getInterpreterDetail,
  listPerspectivesOfInterpreter,
  listSchoolsOfInterpreter,
} from "@/lib/content";
import { formatYears } from "@/lib/format";
import { pageIdFromKey, pagePath } from "@/lib/slug";
import { resolveLivePage } from "@/lib/resolve-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pageKey: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const id = pageIdFromKey((await params).pageKey);
  if (!id) return {};
  const interpreter = await getInterpreterDetail(id);
  return interpreter
    ? { title: interpreter.title, description: interpreter.summary }
    : {};
}

export default async function InterpreterPage({ params }: Params) {
  const page = await resolveLivePage("interpreter", (await params).pageKey);
  const [interpreter, perspectives, schools] = await Promise.all([
    getInterpreterDetail(page.id),
    listPerspectivesOfInterpreter(page.id),
    listSchoolsOfInterpreter(page.id),
  ]);
  if (!interpreter) notFound();

  return (
    <PageContainer>
      <nav aria-label="面包屑" className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2 break-words text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">首页</Link><span>/</span>
        <Link href="/interpreters" className="hover:text-foreground">诠释者索引</Link><span>/</span>
        <span aria-current="page" className="min-w-0 break-words">{interpreter.title}</span>
      </nav>
      <DiscoveryHeader label="人物档案 / 诠释者" title={interpreter.title}>
        {interpreter.summary && <p>{interpreter.summary}</p>}
        <p className="mt-2 text-sm">诠释者是思想来源；页面由编者整理与提交。</p>
      </DiscoveryHeader>
      <div className="my-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <HistoryLink pageId={page.id} />
        <Link href={`/edit/${page.id}`} className="inline-block py-2 text-sm text-primary underline-offset-4 hover:underline">编辑诠释者信息</Link>
      </div>
      <div className="grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 lg:order-2">
          <DiscoveryFacts title="人物资料" rows={[
            { label: "类型", content: "诠释者" },
            { label: "生卒", content: interpreter.birthYear == null && interpreter.deathYear == null ? "暂未收录" : formatYears(interpreter.birthYear, interpreter.deathYear) },
            { label: "所属学派", content: schools.length ? (
              <ul className="space-y-2">
                {schools.map((school) => <li key={school.id}><Link href={pagePath("school", school.slug, school.id)} className="break-words text-primary underline-offset-4 hover:underline">{school.title}</Link></li>)}
              </ul>
            ) : "暂未收录" },
            { label: "视角", content: `${perspectives.length} 个` },
            ...(interpreter.keyTexts.length ? [{ label: "关键文本", content: <KeyTexts items={interpreter.keyTexts} /> }] : []),
          ]} />
        </div>
        <section aria-labelledby="index-heading" className="min-w-0 lg:order-1">
          <h2 id="index-heading" className="mb-4 text-xl font-semibold">视角索引（{perspectives.length}）</h2>
          {perspectives.length > 0 ? (
            <DiscoveryList>
              {perspectives.map((p) => (
                <DiscoveryRow key={p.pageId} href={pagePath("perspective", p.slug, p.pageId)} title={p.title} meta="视角"
                  description={<>词条 <Link href={pagePath("term", p.termSlug, p.termId)} className="text-primary underline-offset-4 hover:underline">{p.termTitle}</Link></>} />
              ))}
            </DiscoveryList>
          ) : (
            <DiscoveryEmpty href="/interpreters" label="返回诠释者索引">该诠释者还没有已收录的视角。</DiscoveryEmpty>
          )}
        </section>
      </div>
    </PageContainer>
  );
}
