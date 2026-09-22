import { hasAdminRole } from "@/lib/roles";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ContentDiff } from "@/components/content-diff";
import { PageContainer } from "@/components/page-container";
import { TermMetadataDiff } from "@/components/term-metadata-diff";
import { formatKeyTexts } from "@/lib/key-texts";
import { getSessionUser } from "@/lib/session";
import { getMySubmission } from "@/lib/submission-history";
import { formatWhen, kindLabels, RejectionReason, statusBadgeClass, statusLabels } from "../../_components";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "提交详情" };

type Props = { params: Promise<{ id: string }> };

export default async function SubmissionDetailPage({ params }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const rawId = (await params).id;
  if (!/^[1-9]\d*$/.test(rawId)) notFound();
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id > 2_147_483_647) notFound();
  const submission = await getMySubmission(user.id, id, hasAdminRole(user.role));
  if (!submission) notFound();

  const proposedText =
    submission.kind === "new_term" || submission.kind === "new_interpreter" || (submission.kind === "edit" && submission.title !== null)
      ? `标题：${submission.title ?? ""}\n简介：${submission.summary ?? ""}\n别名：${submission.aliases.join("、")}\n关键文本：${formatKeyTexts(submission.keyTexts ?? undefined)}\n\n${submission.content}`
      : submission.content;

  return (
    <PageContainer className="max-w-4xl">
      <nav aria-label="返回" className="text-sm text-muted-foreground">
        <Link href="/profile" className="underline-offset-4 hover:text-foreground hover:underline">
          返回提交历史
        </Link>
      </nav>
      <header className="mt-4 border-b border-border pb-8">
        <p className="text-xs font-medium tracking-widest text-muted-foreground">个人任务 · 提交</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">提交详情</h1>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">{submission.kind === "edit" && submission.title !== null ? "编辑词条信息" : kindLabels[submission.kind]}</span>
          <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{submission.targetTitle}</span>
          <span className={`rounded-sm px-1.5 py-0.5 text-xs ${statusBadgeClass[submission.status]}`}>{statusLabels[submission.status]}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          提交 #{submission.id} · <time dateTime={submission.createdAt.toISOString()}>{formatWhen(submission.createdAt)}</time>
          {submission.decidedAt && (
            <> · 审核于 <time dateTime={submission.decidedAt.toISOString()}>{formatWhen(submission.decidedAt)}</time></>
          )}
        </p>
      </header>
      {submission.status === "rejected" && submission.rejectionReason && <div className="mt-6"><RejectionReason reason={submission.rejectionReason} /></div>}
      {submission.status === "rejected" && <Link href={`/profile/submissions/${id}/resubmit`} className="mt-4 inline-block py-1 text-sm text-primary underline-offset-4 hover:underline">修改后重新提交</Link>}
      {submission.supersedesId && <p className="mt-3 text-sm">修改自 <Link className="underline-offset-4 hover:underline" href={`/profile/submissions/${submission.supersedesId}`}>原驳回提交 #{submission.supersedesId}</Link></p>}
      <section aria-label="审核记录" className="mt-6 border-y border-border py-5 text-sm">
        <p className="text-muted-foreground">本次提交需 {submission.quorum} 位管理员受理</p>
        <ul className="mt-2 flex flex-col gap-1">
          {submission.votes.map(vote => <li key={vote.id} className="break-words [overflow-wrap:anywhere]">{vote.name}：{vote.vote === "approve" ? "批准" : "驳回"}{vote.reason && ` · ${vote.reason}`}</li>)}
        </ul>
      </section>

      <section aria-labelledby="submission-diff-heading" className="mt-10">
        <h2 id="submission-diff-heading" className="text-2xl font-semibold">提交差异</h2>
        <p className="mt-2 mb-4 text-sm leading-7 text-muted-foreground">
          {submission.baseHidden ? "页面已不可见，历史正文不予展示；下方保留你提交的提案。" : submission.kind === "edit" ? "对比开始编辑时的修订与本次提案。" : "新建内容以空白为起点对比。"}
        </p>
        {submission.baseHidden
          ? <pre className="whitespace-pre-wrap break-words rounded-lg border border-border bg-muted p-3 text-sm [overflow-wrap:anywhere]">{proposedText}</pre>
          : submission.baseSnapshot
            ? <TermMetadataDiff from={submission.baseSnapshot} to={{ ...submission.baseSnapshot, title: submission.title!, summary: submission.summary ?? "", ...(submission.baseSnapshot.type === "term" ? { aliases: submission.aliases } : {}), keyTexts: submission.keyTexts ?? submission.baseSnapshot.keyTexts }} />
            : <ContentDiff oldText={submission.baseContent ?? ""} newText={proposedText} />}
      </section>
    </PageContainer>
  );
}
