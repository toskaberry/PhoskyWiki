import { hasAdminRole } from "@/lib/roles";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ContentDiff } from "@/components/content-diff";
import { TermMetadataDiff } from "@/components/term-metadata-diff";
import { formatKeyTexts } from "@/lib/key-texts";
import { getSessionUser } from "@/lib/session";
import { getMySubmission } from "@/lib/submission-history";
import { formatWhen, kindLabels, RejectionReason, statusLabels } from "../../_components";

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
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <Link href="/profile" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        返回提交历史
      </Link>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">提交详情</h1>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">{submission.kind === "edit" && submission.title !== null ? "编辑词条信息" : kindLabels[submission.kind]}</span>
        <span className="min-w-0 break-words font-medium">{submission.targetTitle}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{statusLabels[submission.status]}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        提交 #{submission.id} · <time dateTime={submission.createdAt.toISOString()}>{formatWhen(submission.createdAt)}</time>
        {submission.decidedAt && (
          <> · 审核于 <time dateTime={submission.decidedAt.toISOString()}>{formatWhen(submission.decidedAt)}</time></>
        )}
      </p>
      {submission.status === "rejected" && <RejectionReason reason={submission.rejectionReason} />}
      {submission.status === "rejected" && <Link href={`/profile/submissions/${id}/resubmit`} className="mt-4 inline-block text-primary underline">修改后重新提交</Link>}
      {submission.supersedesId && <p className="mt-3 text-sm">修改自 <Link className="underline" href={`/profile/submissions/${submission.supersedesId}`}>原驳回提交 #{submission.supersedesId}</Link></p>}
      <section aria-label="审核记录" className="mt-4 text-sm">
        <p>本次提交需 {submission.quorum} 位管理员受理</p>
        {submission.votes.map(vote => <p key={vote.id}>{vote.name}：{vote.vote === "approve" ? "批准" : "驳回"}{vote.reason && ` · ${vote.reason}`}</p>)}
      </section>

      <section aria-labelledby="submission-diff-heading" className="mt-8">
        <h2 id="submission-diff-heading" className="text-xl font-semibold">提交差异</h2>
        <p className="mt-2 mb-4 text-sm text-muted-foreground">
          {submission.baseHidden ? "页面已不可见，历史正文不予展示；下方保留你提交的提案。" : submission.kind === "edit" ? "对比开始编辑时的修订与本次提案。" : "新建内容以空白为起点对比。"}
        </p>
        {submission.baseHidden
          ? <pre className="whitespace-pre-wrap break-words rounded bg-muted p-3 text-sm">{proposedText}</pre>
          : submission.baseSnapshot
            ? <TermMetadataDiff from={submission.baseSnapshot} to={{ ...submission.baseSnapshot, title: submission.title!, summary: submission.summary ?? "", ...(submission.baseSnapshot.type === "term" ? { aliases: submission.aliases } : {}), keyTexts: submission.keyTexts ?? submission.baseSnapshot.keyTexts }} />
            : <ContentDiff oldText={submission.baseContent ?? ""} newText={proposedText} />}
      </section>
    </main>
  );
}
