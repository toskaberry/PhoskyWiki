import Link from "next/link";
import styles from "./reading.module.css";
import { ReadingContents } from "@/components/reading-contents";
import { renderReadingMarkdown } from "@/lib/reading-markdown";
import { PageComments } from "@/components/page-comments";
import { AgentPanel } from "@/components/agent-panel";
import { HistoryLink } from "@/components/history-link";
import { PassageAnnotations } from "@/components/passage-annotations";
import { KeyTexts } from "@/components/key-texts";
import { ReadingPanelsArea, ReadingPanelsProvider, ReadingPanelTriggers } from "@/components/reading-panels";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { BacklinkPanel } from "@/components/backlink-panel";
import { Infobox } from "@/components/wiki-content";
import {
  getHeadContent,
  getHeadRevisionId,
  getPerspectiveDetail,
  getWikiLinkTargets,
  listBacklinks,
} from "@/lib/content";
import { formatYears } from "@/lib/format";
import { wikiLinkResolver } from "@/lib/markdown";
import { listPersonalMarks } from "@/lib/passage-marks";
import { listPageThoughts } from "@/lib/passage-thoughts";
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
  const { html, headings } = renderReadingMarkdown(content, wikiLinkResolver(targets));
  // 个人标记（划线）随账号云端保存；游客无标记状态但仍可拉起浮条（复制/引导登录），
  // 选区序列化需要正文 head 修订号。划线感想与标记同页同源：公开感想随页面对所有读者
  // 渲染句子虚线，本人私密感想只随本人登录返回（spec 0009 #74）。
  const [marks, thoughtState] = await Promise.all([
    sessionUser ? listPersonalMarks(page.id, sessionUser.id) : null,
    listPageThoughts(page.id, sessionUser?.id),
  ]);
  const revisionId = marks?.revisionId ?? (await getHeadRevisionId(page.id));

  const termHref = pagePath("term", detail.termSlug, detail.termId);
  const interpreterHref = pagePath(
    "interpreter",
    detail.interpreterSlug,
    detail.interpreterId,
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <nav aria-label="面包屑" className="mb-4 text-sm text-muted-foreground">
          <Link href="/" className="inline-block py-1 hover:text-foreground">首页</Link>
          <span className="mx-1.5">/</span>
          <Link href={termHref} className="inline-block py-1 hover:text-foreground">{detail.termTitle}</Link>
          <span className="mx-1.5">/</span>
          <span aria-current="page">{detail.title}</span>
        </nav>
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{detail.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          诠释者：<Link href={interpreterHref} className="underline-offset-4 hover:underline">
            {detail.interpreterName}
          </Link>
          <span className="mx-1.5">·</span>
          所属词条：<Link href={termHref} className="underline-offset-4 hover:underline">
            {detail.termTitle}
          </Link>
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-4 border-b border-border pb-5">
          <HistoryLink pageId={page.id} />
          {sessionUser && (
            <Link
              href={`/edit/${pageKey(detail.slug, detail.id)}`}
              className="rounded-md border border-border px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              编辑
            </Link>
          )}
        </div>
      </header>
      {/* F07（#95）：资料／感想／Agent 解读改为按需面板——初始收起，宽屏落正文列
          外的留白列、窄屏为可关闭覆盖层；面板内容常驻挂载，开关不丢本页状态。 */}
      <ReadingPanelsProvider initialThoughts={thoughtState.thoughts}>
      <div className={styles.layout}>
        {headings.length > 0 && (
          <aside className={styles.desktopContents}>
            <p className="mb-3 text-sm font-semibold text-muted-foreground">章节目录</p>
            <ReadingContents headings={headings} />
          </aside>
        )}
        <div className={styles.body}>
          <ReadingPanelTriggers />
          {headings.length > 0 && (
            <details className={styles.mobileContents}>
              <summary>章节目录</summary>
              <ReadingContents headings={headings} />
            </details>
          )}
          <article aria-label="视角正文">
            <PassageAnnotations
              html={html}
              pageId={page.id}
              revisionId={revisionId}
              initialMarks={marks?.marks ?? []}
              initialDefaultStyle={marks?.defaultStyle ?? "highlight"}
              initialThoughts={thoughtState.thoughts}
              loggedIn={sessionUser !== null}
              viewerId={sessionUser?.id ?? null}
              loginHref={`/login?redirect=${encodeURIComponent(pagePath("perspective", page.slug, page.id))}`}
            />
          </article>

          <p className="mt-6 rounded-lg border border-border bg-card px-4 py-3 text-sm">
            <a
              href="#comments"
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              就这个视角发表评论 →
            </a>
            <span className="ml-2 text-xs text-muted-foreground">
              （也可在正文里选中文字写想法，与「{detail.termTitle}」的其他读者讨论）
            </span>
          </p>

          <BacklinkPanel items={backlinks} />
        </div>

        <ReadingPanelsArea
          materials={
            <>
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
              {detail.interpreterKeyTexts.length > 0 && (
                <section className="mt-3">
                  <h3 className="mb-2 text-sm font-semibold">诠释者关键文本</h3>
                  <KeyTexts items={detail.interpreterKeyTexts} />
                </section>
              )}
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                红色虚线标记的词条尚未创建——那是留给编者的写作缺口。
              </p>
            </>
          }
          agent={<AgentPanel key={page.id} termId={detail.termId} heading={false} />}
        />
      </div>
      </ReadingPanelsProvider>
      <div className={styles.comments}>
        <PageComments pageId={page.id} href={pagePath("perspective", page.slug, page.id)} title="视角评论" user={sessionUser} />
      </div>
    </main>
  );
}
