import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MarkNotificationRead } from "@/components/mark-notification-read";
import type { SubmissionStatus } from "@/db/schema";
import { getInterestOptions, getInterestTags } from "@/lib/interests";
import { hasAnyInterest } from "@/lib/interest-tags";
import { getNotificationInbox } from "@/lib/notifications";
import { getSessionUser } from "@/lib/session";
import { listMySubmissions } from "@/lib/submission-history";
import { formatWhen, kindLabels, RejectionReason, statusLabels } from "./_components";
import { hasAdminRole } from "@/lib/roles";
import { UserManagement } from "./_user-management";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "个人主页" };

type Props = { searchParams: Promise<{ status?: string | string[]; userQuery?: string; userPage?: string }> };

export default async function ProfilePage({ searchParams }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const requestedStatus = params.status;
  const status =
    requestedStatus === "pending" || requestedStatus === "approved" || requestedStatus === "rejected"
      ? requestedStatus
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
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">个人主页</h1>
      <p className="mt-2 text-sm text-muted-foreground">{user.name}，在这里查看你的提交进度与审核结果。</p>

      {hasAdminRole(user.role) && <nav aria-label="管理员工具" className="mt-6 flex flex-wrap gap-4 text-sm">
        <Link href="/review" className="underline">审核队列</Link>
        <Link href="/admin/deleted" className="underline">管理员回收站</Link>
        <Link href="/admin/access" className="underline">邀请与恢复</Link>
      </nav>}
      {user.role === "superadmin" && <UserManagement actorId={user.id} query={typeof params.userQuery === "string" ? params.userQuery : ""} page={typeof params.userPage === "string" ? params.userPage : "1"} />}

      <section aria-labelledby="submission-history-heading" className="mt-8">
        <h2 id="submission-history-heading" className="text-xl font-semibold">提交历史</h2>
        <nav aria-label="提交状态筛选" className="mt-4 flex flex-wrap gap-2 text-sm">
          {filters.map((filter) => (
            <Link
              key={filter.label}
              href={filter.status ? `/profile?status=${filter.status}` : "/profile"}
              aria-current={filter.status === status ? "page" : undefined}
              className={`rounded-md border border-border px-3 py-1.5 hover:bg-muted ${filter.status === status ? "bg-secondary font-medium" : "text-muted-foreground"}`}
            >
              {filter.label}
            </Link>
          ))}
        </nav>

        {submissions.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            {status ? "这个状态下还没有提交。" : "你还没有提交记录。"}
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {submissions.map((submission) => (
              <li key={submission.id} data-submission-id={submission.id} className="min-w-0 rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">{kindLabels[submission.kind]}</span>
                  <span className="min-w-0 break-words font-medium">{submission.targetTitle}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{statusLabels[submission.status]}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  提交于 <time dateTime={submission.createdAt.toISOString()}>{formatWhen(submission.createdAt)}</time>
                  {submission.decidedAt && (
                    <> · 审核于 <time dateTime={submission.decidedAt.toISOString()}>{formatWhen(submission.decidedAt)}</time></>
                  )}
                </p>
                {submission.status === "rejected" && <RejectionReason reason={submission.rejectionReason} />}
                <Link href={`/profile/submissions/${submission.id}`} className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline">
                  查看差异
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="interests-heading" className="mt-10">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="interests-heading" className="text-xl font-semibold">兴趣标签</h2>
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
              <li key={`interpreter-${id}`} className="rounded-full bg-secondary px-3 py-1.5 text-sm">
                {interpreterNames.get(id) ?? `诠释者 #${id}`}
              </li>
            ))}
            {interests.schools.map((id) => (
              <li key={`school-${id}`} className="rounded-full bg-secondary px-3 py-1.5 text-sm">
                {schoolNames.get(id) ?? `学派 #${id}`}
              </li>
            ))}
            {interests.categories.map((id) => (
              <li key={`category-${id}`} className="rounded-full bg-secondary px-3 py-1.5 text-sm">
                {categoryNames.get(id) ?? `主题 #${id}`}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground" data-testid="profile-no-interests">
            还没有设置兴趣——选择关注的诠释者、学派与主题，词条页会按你的兴趣重排。
          </p>
        )}
      </section>

      <section id="notifications" aria-labelledby="notifications-heading" className="mt-10 scroll-mt-36">
        <h2 id="notifications-heading" className="text-xl font-semibold">通知</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {inbox.unreadCount > 0 ? `${inbox.unreadCount} 条未读审核结果。` : "没有未读通知。"}
        </p>
        {inbox.notifications.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">审核完成后，结果会显示在这里。</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {inbox.notifications.map((notification) => (
              <li key={notification.submissionId} data-notification-id={notification.submissionId} className="min-w-0 rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">提交 #{notification.submissionId} {statusLabels[notification.status]}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{notification.readAt ? "已读" : "未读"}</span>
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
    </main>
  );
}
