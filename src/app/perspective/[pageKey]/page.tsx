import Link from "next/link";
import { AgentPanel } from "@/components/agent-panel";
import { HistoryLink } from "@/components/history-link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { BacklinkPanel } from "@/components/backlink-panel";
import { Infobox, WikiContent } from "@/components/wiki-content";
import {
  getHeadContent,
  getPerspectiveDetail,
  getWikiLinkTargets,
  listBacklinks,
} from "@/lib/content";
import { formatYears } from "@/lib/format";
import { renderMarkdown, wikiLinkResolver } from "@/lib/markdown";
import { pageIdFromKey, pageKey, pagePath } from "@/lib/slug";
import { resolveLivePage } from "@/lib/resolve-page";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pageKey: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const id = pageIdFromKey((await params).pageKey);
  if (!id) return {};
  const detail = await getPerspectiveDetail(id);
  return detail
    ? {
        title: detail.title,
        description: `${detail.interpreterName}对「${detail.termTitle}」的诠释视角 · PhoskyWiki`,
      }
    : {};
}

export default async function PerspectivePage({ params }: Params) {
  const page = await resolveLivePage("perspective", (await params).pageKey);
  const detail = await getPerspectiveDetail(page.id);
  if (!detail) notFound();

  const content = await getHeadContent(page.id);
  if (content === null) notFound();

  const [targets, backlinks, sessionUser] = await Promise.all([
    getWikiLinkTargets(page.id),
    listBacklinks(page.id),
    getSessionUser(),
  ]);
  const html = renderMarkdown(content, wikiLinkResolver(targets));

  const termHref = pagePath("term", detail.termSlug, detail.termId);
  const interpreterHref = pagePath(
    "interpreter",
    detail.interpreterSlug,
    detail.interpreterId,
  );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <nav aria-label="面包屑" className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={termHref} className="hover:text-foreground">
          {detail.termTitle}
        </Link>
        <span className="mx-1.5">/</span>
        <span aria-current="page">{detail.title}</span>
      </nav>
      <HistoryLink pageId={page.id} />

      <div className="flex flex-col gap-10 lg:flex-row lg:gap-10">
        <div className="min-w-0 flex-1">
          <article>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{detail.title}</h1>
              {sessionUser && (
                <Link
                  href={`/edit/${pageKey(detail.slug, detail.id)}`}
                  className="rounded-md border border-border px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  编辑
                </Link>
              )}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              <Link href={interpreterHref} className="underline-offset-4 hover:underline">
                {detail.interpreterName}
              </Link>
              <span className="mx-1.5">·</span>
              属于词条{" "}
              <Link href={termHref} className="underline-offset-4 hover:underline">
                {detail.termTitle}
              </Link>
            </p>

            <div className="mt-8">
              <WikiContent html={html} />
            </div>
          </article>

          <p className="mt-6 rounded-lg border border-border bg-card px-4 py-3 text-sm">
            <Link
              href={`/term/${pageKey(detail.termSlug, detail.termId)}/discussion?perspective=${detail.id}`}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              就这个视角发起讨论 →
            </Link>
            <span className="ml-2 text-xs text-muted-foreground">
              （在「{detail.termTitle}」的讨论区带视角锚点开楼）
            </span>
          </p>

          <BacklinkPanel items={backlinks} />
        </div>

        <div className="shrink-0 lg:w-64">
          <AgentPanel key={page.id} termId={detail.termId} />
          <Infobox
            title={detail.title}
            rows={[
              {
                label: "类型",
                content: "视角（原子知识单位）",
              },
              {
                label: "所属词条",
                content: <Link href={termHref}>{detail.termTitle}</Link>,
              },
              {
                label: "诠释者",
                content: <Link href={interpreterHref}>{detail.interpreterName}</Link>,
              },
              {
                label: "生卒",
                content: formatYears(detail.interpreterBirthYear, detail.interpreterDeathYear),
              },
              { label: "正文双链", content: `${targets.size} 条（指向其他词条）` },
            ]}
          />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            红色虚线标记的词条尚未创建——那是留给编者的写作缺口。
          </p>
        </div>
      </div>
    </main>
  );
}
