import { hasAdminRole } from "@/lib/roles";
import { PageContainer } from "@/components/page-container";
import { PageAction } from "@/components/page-action";
import { PageComments } from "@/components/page-comments";
import { KeyTexts } from "@/components/key-texts";
import Link from "next/link";
import { AgentPanel } from "@/components/agent-panel";
import { HistoryLink } from "@/components/history-link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { BacklinkPanel } from "@/components/backlink-panel";
import { Infobox, InfoboxLinks } from "@/components/wiki-content";
import { LocalGraph } from "@/components/local-graph";
import { TermDiscoveryPanel } from "@/components/term-discovery";
import {
  getTermDetail,
  listBacklinks,
  listCategoriesOfTerm,
  listPerspectivesOfTerm,
} from "@/lib/content";
import { categoryPath } from "@/lib/categories";

import { getLocalGraph } from "@/lib/graph";
import { getInterestTags } from "@/lib/interests";
import { getTermDiscovery } from "@/lib/term-discovery";
import { pageIdFromKey, pageKey } from "@/lib/slug";
import { resolveLivePage } from "@/lib/resolve-page";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pageKey: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const id = pageIdFromKey((await params).pageKey);
  if (!id) return {};
  const term = await getTermDetail(id);
  return term ? { title: term.title, description: term.summary } : {};
}

export default async function TermPage({ params }: Params) {
  const page = await resolveLivePage("term", (await params).pageKey);
  const term = await getTermDetail(page.id);
  if (!term) notFound();

  const [perspectives, categories, backlinks, sessionUser, localGraph] =
    await Promise.all([
      listPerspectivesOfTerm(page.id),
      listCategoriesOfTerm(page.id),
      listBacklinks(page.id),
      getSessionUser(),
      getLocalGraph(page.id, 1),
    ]);

  const interests = sessionUser ? await getInterestTags(sessionUser.id) : null;
  const discovery = await getTermDiscovery(page.id, interests);
  if (!discovery) notFound();

  // 继续探索索引（#97）：只链接真实存在的区块，编号为装饰性等宽索引。
  const exploreNav = (
    <nav aria-label="继续探索索引" className="flex flex-wrap gap-x-5 gap-y-1 pb-1 text-sm">
      {discovery.relatedTerms.length > 0 && (
        <a href="#related-terms-heading" className="py-1"><span aria-hidden="true" className="mr-1.5 font-mono text-xs text-muted-foreground">01</span>相关词条</a>
      )}
      <a href="#backlinks-heading" className="py-1"><span aria-hidden="true" className="mr-1.5 font-mono text-xs text-muted-foreground">02</span>反链</a>
      {localGraph && (
        <a href="#local-graph-heading" className="py-1"><span aria-hidden="true" className="mr-1.5 font-mono text-xs text-muted-foreground">03</span>局部图谱</a>
      )}
    </nav>
  );

  return (
    <PageContainer className="max-w-6xl [overflow-wrap:anywhere]">
      <header className="border-b border-border pb-8">
        <nav aria-label="面包屑" className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <Link href="/">首页</Link>
          <span aria-hidden="true">/</span>
          <Link href="/terms">词条索引</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{term.title}</span>
        </nav>
        <p className="mt-8 text-sm text-muted-foreground">词条 · 概念枢纽</p>
        <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight sm:text-6xl">{term.title}</h1>
        {term.summary && (
          <p className="mt-5 max-w-3xl text-lg leading-relaxed text-muted-foreground">{term.summary}</p>
        )}
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          从不同诠释者的视角进入阅读，沿概念之间的关联继续探索。
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <HistoryLink pageId={page.id} />
          {sessionUser && <Link href={`/edit/${pageKey(page.slug, page.id)}`}>编辑词条信息</Link>}
          {hasAdminRole(sessionUser?.role) && (
            <PageAction pageId={page.id} action="delete" deleteTerm={{ title: term.title, perspectiveCount: perspectives.length }} />
          )}
        </div>
        <nav aria-label="词条页内导航" className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4 text-sm">
          <a href="#perspectives-heading" className="py-2">诠释者视角</a>
          <a href="#term-resources-heading" className="py-2">词条资料</a>
          <a href="#term-explore-heading" className="py-2">继续探索</a>
          <a href="#term-agent" className="py-2">Agent 解读</a>
          <a href="#comments" className="py-2">词条总评论</a>
        </nav>
      </header>

      <TermDiscoveryPanel
        termId={page.id}
        initial={discovery}
        guest={!sessionUser}
        resources={
          <section aria-labelledby="term-resources-heading" className="mt-12 border-t border-border pt-8">
            <h2 id="term-resources-heading" className="text-2xl font-semibold">词条资料</h2>
            <p className="mt-2 text-sm text-muted-foreground">概念的别名、分类与已有参考作品。</p>
            <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-2">
              <Infobox
                title={term.title}
                rows={[
                  { label: "类型", content: "词条（聚合枢纽）" },
                  { label: "别名", content: term.aliases.length > 0 ? term.aliases.join("、") : "暂无别名" },
                  {
                    label: "分类",
                    content: (
                      <InfoboxLinks
                        empty="暂无分类"
                        items={categories.map((category) => ({
                          key: String(category.id), label: category.name, href: categoryPath(category.slug),
                        }))}
                      />
                    ),
                  },
                  { label: "视角", content: `${perspectives.length} 个` },
                  ...(term.keyTexts.length ? [{ label: "关键文本", content: <KeyTexts items={term.keyTexts} /> }] : []),
                ]}
              />
              <div id="term-agent" className="min-w-0">
                <AgentPanel key={page.id} termId={page.id} />
              </div>
            </div>
          </section>
        }
        exploreNav={exploreNav}
      >
        <BacklinkPanel items={backlinks} />
        {localGraph && <LocalGraph termId={page.id} termTitle={term.title} initialData={localGraph} />}
      </TermDiscoveryPanel>
      <PageComments pageId={page.id} href={`/term/${pageKey(page.slug, page.id)}`} title="词条总评论" user={sessionUser} />
    </PageContainer>
  );
}
