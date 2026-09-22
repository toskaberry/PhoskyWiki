import { hasAdminRole } from "@/lib/roles";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageContainer } from "@/components/page-container";
import { StatusChip, TaskPageHeader } from "@/components/task-page";
import { ContentDiff } from "@/components/content-diff";
import { TermMetadataDiff } from "@/components/term-metadata-diff";
import { formatKeyTexts } from "@/lib/key-texts";
import { getSessionUser } from "@/lib/session";
import { getMySubmission } from "@/lib/submission-history";
import { formatWhen, kindLabels, RejectionReason, statusLabels } from "../../_components";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "提交详情" };

type Props = { params: Promise<{ id: string }> };

const statusTones: Record<string, "accent" | "neutral" | "warning"> = {
  pending: "neutral",
  approved: "accent",
  rejected: "warning",
};

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
      <TaskPageHeader
        breadcrumb={[
          { label: "首页", href: "/" },
          { label: "个人主页", href: "/profile" },
          { label: "提交详情" },
        ]}
        kicker="编者任务 · 提交"
        title="提交详情"
      />

      <div className="mt-8 border-b border-border pb-6">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusChip>{submission.kind === "edit" && submission.title !== null ? "编辑词条信息" : kindLabels[submission.kind]}</StatusChip>
          <span className="min-w-0 break-words text-base font-medium">{submission.targetTitle}</span>
          <StatusChip tone={statusTones[submission.status] ?? "neutral"}>{statusLabels[submission.status]}</StatusChip>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          提交 #{submission.id} · <time dateTime={submission.createdAt.toISOString()}>{formatWhen(submission.createdAt)}</time>
          {submission.decidedAt && (
            <> · 审核于 <time dateTime={submission.decidedAt.toISOString()}>{formatWhen(submission.decidedAt)}</time></>
          )}
        </p>
        {submission.status === "rejected" && (
          <div className="mt-4 flex flex-col gap-3">
            <RejectionReason reason={submission.rejectionReason} />
            <p>
              <Link href={`/profile/submissions/${id}/resubmit`} className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">修改后重新提交</Link>
            </p>
          </div>
        )}
        {submission.supersedesId && <p className="mt-3 text-sm">修改自 <Link className="underline underline-offset-4" href={`/profile/submissions/${submission.supersedesId}`}>原驳回提交 #{submission.supersedesId}</Link></p>}
        <section aria-label="审核记录" className="mt-4 rounded-lg border border-border bg-card p-4 text-sm">
          <p className="font-medium">审核记录</p>
          <p className="mt-2 text-muted-foreground">本次提交需 {submission.quorum} 位管理员受理</p>
          <ul className="mt-2 flex flex-col gap-1">
            {submission.votes.map(vote => <li key={vote.id} className="flex flex-wrap gap-x-2 [overflow-wrap:anywhere]">
              <span>{vote.name}</span>
              <span className={vote.vote === "approve" ? "text-primary" : "text-destructive"}>{vote.vote === "approve" ? "批准" : "驳回"}</span>
              {vote.reason && <span className="text-muted-foreground">· {vote.reason}</span>}
            </li>)}
          </ul>
          {submission.votes.length === 0 && <p className="mt-2 text-muted-foreground">还没有管理员处理这条提交。</p>}
        </section>
      </div>

      <section aria-labelledby="submission-diff-heading" className="mt-8">
        <h2 id="submission-diff-heading" className="border-t border-border pt-6 text-xl font-semibold tracking-tight">提交差异</h2>
        <p className="mt-2 mb-4 text-sm text-muted-foreground">
          {submission.baseHidden ? "页面已不可见，历史正文不予展示；下方保留你提交的提案。" : submission.kind === "edit" ? "对比开始编辑时的修订与本次提案。" : "新建内容以空白为起点对比。"}
        </p>
        {submission.baseHidden
          ? <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 text-sm">{proposedText}</pre>
          : submission.baseSnapshot
            ? <TermMetadataDiff from={submission.baseSnapshot} to={{ ...submission.baseSnapshot, title: submission.title!, summary: submission.summary ?? "", ...(submission.baseSnapshot.type === "term" ? { aliases: submission.aliases } : {}), keyTexts: submission.keyTexts ?? submission.baseSnapshot.keyTexts }} />
            : <ContentDiff oldText={submission.baseContent ?? ""} newText={proposedText} />}
      </section>
      <p className="mt-8 text-sm">
        <Link href="/profile" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          返回提交历史
        </Link>
      </p>
    </PageContainer>
  );
}
