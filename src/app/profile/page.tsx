import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MarkNotificationRead } from "@/components/mark-notification-read";
import { PageContainer } from "@/components/page-container";
import type { SubmissionStatus } from "@/db/schema";
import { getInterestOptions, getInterestTags } from "@/lib/interests";
import { hasAnyInterest } from "@/lib/interest-tags";
import { getNotificationInbox } from "@/lib/notifications";
import type { PersonalRecordKind } from "@/lib/personal-records";
import { roleLabels } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";
import { listMySubmissions } from "@/lib/submission-history";
import { formatWhen, kindLabels, RejectionReason, statusBadgeClass, statusLabels } from "./_components";
import { PersonalRecordsSection } from "./_records";
import { hasAdminRole } from "@/lib/roles";
import { UserManagement } from "./_user-management";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "个人主页" };

type Props = { searchParams: Promise<{ status?: string | string[]; records?: string | string[]; userQuery?: string; userPage?: string }> };

export default async function ProfilePage({ searchParams }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const requestedStatus = params.status;
  const status =
    requestedStatus === "pending" || requestedStatus === "approved" || requestedStatus === "rejected"
      ? requestedStatus
      : undefined;
  // 「评论与感想」区块的三类筛选（#76）：页面评论 / 感想（公开·私密）/ 回复
  const requestedRecords = params.records;
  const recordsKind: PersonalRecordKind | undefined =
    requestedRecords === "comment" || requestedRecords === "thought" || requestedRecords === "reply"
      ? requestedRecords
      : undefined;
  const [submissions, inbox, interests, options] = await Promise.all([
    listMySubmissions(user.id, status),
    getNotificationInbox(user.id),
    getInterestTags(user.id),
    getInterestOptions(),
  ]);
  // 兴趣 chip 展示名（id → 名称）；陈旧 id（目标已下线）在此自然缺席
  const interpreterNames = new Map(options.interpreters.map((row) => [row.id, row.name]));
  const schoolNames = new Map(options.schools.map((row) => [row.id, row.name]));
  const categoryNames = new Map(options.categories.map((row) => [row.id, row.name]));
  const filters: { status: SubmissionStatus | undefined; label: string }[] = [
    { status: undefined, label: "全部" },
    { status: "pending", label: "待审核" },
    { status: "approved", label: "已受理" },
    { status: "rejected", label: "已驳回" },
  ];

  return (
    <PageContainer className="max-w-4xl">
      <header className="border-b border-border pb-8">
        <p className="text-xs font-medium tracking-widest text-muted-foreground">个人任务</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">个人主页</h1>
        <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{user.name}</span>
          <span className="text-muted-foreground">{roleLabels[user.role]}</span>
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
          在这里查看提交进度与审核结果、管理兴趣标签，并回到你发表的评论与感想。
        </p>
        {hasAdminRole(user.role) && (
          <nav aria-label="管理员工具" className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-sm">
            <Link href="/review" className="underline-offset-4 hover:underline">审核队列</Link>
            <Link href="/admin/deleted" className="underline-offset-4 hover:underline">管理员回收站</Link>
            <Link href="/admin/access" className="underline-offset-4 hover:underline">邀请与恢复</Link>
          </nav>
        )}
        <nav aria-label="个人页内导航" className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4 text-sm">
          <a href="#submission-history-heading" className="py-2">提交历史</a>
          <a href="#interests-heading" className="py-2">兴趣标签</a>
          <a href="#records-heading" className="py-2">评论与感想</a>
          <a href="#notifications" className="py-2">通知</a>
          {user.role === "superadmin" && <a href="#user-management" className="py-2">用户管理</a>}
        </nav>
      </header>

      <section aria-labelledby="submission-history-heading" className="mt-12">
        <h2 id="submission-history-heading" className="text-2xl font-semibold">提交历史</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          你发起的每次提交及其审核状态；驳回理由原文保留在详情页。
        </p>
        <nav aria-label="提交状态筛选" className="mt-4 flex flex-wrap gap-2 text-sm">
          {filters.map((filter) => (
            <Link
              key={filter.label}
              href={filter.status ? `/profile?status=${filter.status}` : "/profile"}
              aria-current={filter.status === status ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 py-2 transition-colors ${
                filter.status === status
                  ? "border-foreground bg-foreground font-medium text-background"
                  : "border-border text-muted-foreground hover:border-input hover:text-foreground"
              }`}
            >
              {filter.label}
            </Link>
          ))}
        </nav>

        {submissions.length === 0 ? (
          <div className="border-y border-border py-8">
            <p className="break-words text-sm leading-7 text-muted-foreground">
              {status ? "这个状态下还没有提交。" : "你还没有提交记录。"}
            </p>
            <Link href="/new/term" className="mt-3 inline-block py-2 text-sm text-primary underline-offset-4 hover:underline">
              创建第一个词条
            </Link>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {submissions.map((submission) => (
              <li key={submission.id} data-submission-id={submission.id} className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">{kindLabels[submission.kind]}</span>
                  <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{submission.targetTitle}</span>
                  <span className={`rounded-sm px-1.5 py-0.5 text-xs ${statusBadgeClass[submission.status]}`}>{statusLabels[submission.status]}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  提交于 <time dateTime={submission.createdAt.toISOString()}>{formatWhen(submission.createdAt)}</time>
                  {submission.decidedAt && (
                    <> · 审核于 <time dateTime={submission.decidedAt.toISOString()}>{formatWhen(submission.decidedAt)}</time></>
                  )}
                </p>
                {submission.status === "rejected" && <RejectionReason reason={submission.rejectionReason} />}
                <Link href={`/profile/submissions/${submission.id}`} className="mt-3 inline-block py-1 text-sm text-primary underline-offset-4 hover:underline">
                  查看差异
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="interests-heading" className="mt-12 border-t border-border pt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="interests-heading" className="text-2xl font-semibold">兴趣标签</h2>
          <Link
            href="/interests"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            管理兴趣 →
          </Link>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          三类兴趣驱动词条页的视角重排与相关词条推荐。
        </p>
        {hasAnyInterest(interests) ? (
          <ul className="mt-4 flex flex-wrap gap-2" data-testid="profile-interest-chips">
            {interests.interpreters.map((id) => (
              <li key={`interpreter-${id}`} className="rounded-full border border-border bg-secondary px-3 py-1.5 text-sm">
                {interpreterNames.get(id) ?? `诠释者 #${id}`}
              </li>
            ))}
            {interests.schools.map((id) => (
              <li key={`school-${id}`} className="rounded-full border border-border bg-secondary px-3 py-1.5 text-sm">
                {schoolNames.get(id) ?? `学派 #${id}`}
              </li>
            ))}
            {interests.categories.map((id) => (
              <li key={`category-${id}`} className="rounded-full border border-border bg-secondary px-3 py-1.5 text-sm">
                {categoryNames.get(id) ?? `主题 #${id}`}
              </li>
            ))}
          </ul>
        ) : (
          <div className="border-y border-border py-8">
            <p className="break-words text-sm leading-7 text-muted-foreground" data-testid="profile-no-interests">
              还没有设置兴趣——选择关注的诠释者、学派与主题，词条页会按你的兴趣重排。
            </p>
            <Link href="/interests" className="mt-3 inline-block py-2 text-sm text-primary underline-offset-4 hover:underline">
              去设置兴趣
            </Link>
          </div>
        )}
      </section>

      <PersonalRecordsSection
        userId={user.id}
        kind={recordsKind}
        current={recordsKind ? `/profile?records=${recordsKind}` : "/profile"}
      />

      <section id="notifications" aria-labelledby="notifications-heading" className="mt-12 scroll-mt-36 border-t border-border pt-8">
        <h2 id="notifications-heading" className="text-2xl font-semibold">通知</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {inbox.unreadCount > 0 ? `${inbox.unreadCount} 条未读审核结果。` : "没有未读通知。"}
        </p>
        {inbox.notifications.length === 0 ? (
          <div className="border-y border-border py-8">
            <p className="break-words text-sm leading-7 text-muted-foreground">审核完成后，结果会显示在这里。</p>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {inbox.notifications.map((notification) => (
              <li key={notification.submissionId} data-notification-id={notification.submissionId} className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">提交 #{notification.submissionId} {statusLabels[notification.status]}</span>
                  <span className={`rounded-sm px-1.5 py-0.5 text-xs ${notification.readAt ? "bg-muted text-muted-foreground" : "bg-accent text-accent-foreground"}`}>
                    {notification.readAt ? "已读" : "未读"}
                  </span>
                  <time dateTime={notification.createdAt.toISOString()} className="text-xs text-muted-foreground">{formatWhen(notification.createdAt)}</time>
                </div>
                {notification.status === "rejected" && <RejectionReason reason={notification.rejectionReason} />}
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <Link href={`/profile/submissions/${notification.submissionId}`} className="text-sm text-primary underline-offset-4 hover:underline">
                    查看提交
                  </Link>
                  {!notification.readAt && <MarkNotificationRead submissionId={notification.submissionId} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {user.role === "superadmin" && <UserManagement actorId={user.id} query={typeof params.userQuery === "string" ? params.userQuery : ""} page={typeof params.userPage === "string" ? params.userPage : "1"} />}
    </PageContainer>
  );
}
