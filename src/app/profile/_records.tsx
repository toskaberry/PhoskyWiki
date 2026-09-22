// 个人界面「评论与感想」区块（spec 0009 #76）：三类筛选（页面评论 / 感想 / 回复），
// 每条显示目标页面、引用片段、摘要与时间；可定位时跳回原句或评论区锚点，
// 不可访问（页面软删、原文已变更、原内容已删除、感想转私密）时保留记录并标注原因。
// 就地管理：删除任意一类自己的记录，感想可切换公开性。

import Link from "next/link";

import { listMyRecords, type PersonalRecordKind, type PersonalRecordStatus } from "@/lib/personal-records";
import { formatWhen } from "./_components";
import { PersonalRecordActions } from "./_record-actions";

const kindLabels: Record<PersonalRecordKind, string> = {
  comment: "页面评论",
  thought: "划线感想",
  reply: "回复",
};

const statusLabels: Record<PersonalRecordStatus, string> = {
  available: "可定位",
  "page-deleted": "页面已删除",
  "original-changed": "原文已变更",
  "thought-private": "原感想已转私密",
  "target-deleted": "原内容已删除",
};

const filters: { kind: PersonalRecordKind | undefined; label: string }[] = [
  { kind: undefined, label: "全部记录" },
  { kind: "comment", label: "页面评论" },
  { kind: "thought", label: "感想" },
  { kind: "reply", label: "回复" },
];

export async function PersonalRecordsSection({ userId, kind, current }: {
  userId: string;
  kind: PersonalRecordKind | undefined;
  /** 当前查询串：写操作的 returnTo 用它回到同一筛选视图。 */
  current: string;
}) {
  const records = await listMyRecords(userId, kind);
  return (
    <section aria-labelledby="records-heading" className="mt-8 border-t border-border pt-6">
      <h2 id="records-heading" className="text-2xl font-semibold">评论与感想</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        你发表的页面评论、划线感想与回复都在这里；感想可标注公开或仅自己可见，公开感想会进入正文虚线入口。
      </p>
      <nav aria-label="记录类型筛选" className="mt-4 flex flex-wrap gap-2 text-sm">
        {filters.map(filter => (
          <Link
            key={filter.label}
            href={filter.kind ? `/profile?records=${filter.kind}` : "/profile"}
            aria-current={filter.kind === kind ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 py-2 transition-colors ${
              filter.kind === kind
                ? "border-foreground bg-foreground font-medium text-background"
                : "border-border text-muted-foreground hover:border-input hover:text-foreground"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>
      {records.length === 0 ? (
        <div className="border-y border-border py-5">
          <p className="break-words text-sm leading-7 text-muted-foreground" data-testid="profile-no-records">
            {kind ? `「${filters.find(filter => filter.kind === kind)!.label}」还没有记录。` : "还没有记录。"}
          </p>
          <p className="mt-1 break-words text-sm leading-7 text-muted-foreground">
            在词条或视角页发表的评论、划下的感想会保存在这里，并能跳回原句或评论区。
          </p>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-4" data-testid="profile-records">
          {records.map(record => (
            <li key={`${record.kind}-${record.id}`} data-record-kind={record.kind} data-record-id={record.id}
              className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">{kindLabels[record.kind]}</span>
                <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{record.targetTitle}</span>
                {record.kind === "thought" && record.visibility && (
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {record.visibility === "public" ? "公开" : "仅自己可见"}
                  </span>
                )}
                <span className={`rounded-sm px-1.5 py-0.5 text-xs ${record.status === "available" ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive"}`}>
                  {statusLabels[record.status]}
                </span>
                <time dateTime={record.createdAt} className="text-xs text-muted-foreground">{formatWhen(new Date(record.createdAt))}</time>
              </div>
              {record.quote && <blockquote className="mt-3 border-l-2 border-border pl-3 text-sm leading-7 text-muted-foreground [overflow-wrap:anywhere]">引用：{record.quote}</blockquote>}
              <p className="mt-3 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-7">{record.content}</p>
              {record.note && <p className="mt-2 text-xs text-muted-foreground">{record.note}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                {record.href
                  ? <Link href={record.href} className="text-sm text-primary underline-offset-4 hover:underline">
                      {record.kind === "comment" ? "回到评论区" : "回到原句"}
                    </Link>
                  : <span className="text-sm text-muted-foreground">无法跳转（记录仍保留）</span>}
                {record.baseRevisionId !== null && record.pageId !== null && <Link
                  href={`/history/${record.pageId}?from=${record.baseRevisionId}&to=${record.baseRevisionId}`}
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  查看原修订
                </Link>
                }
                <PersonalRecordActions record={record} returnTo={current} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
