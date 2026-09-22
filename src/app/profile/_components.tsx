import type { SubmissionKind, SubmissionStatus } from "@/db/schema";
import { Callout } from "@/components/task-page";

export const kindLabels: Record<SubmissionKind, string> = {
  edit: "编辑视角",
  new_term: "新建词条",
  new_perspective: "新建视角",
  new_interpreter: "新建诠释者",
};

export const statusLabels: Record<SubmissionStatus, string> = {
  pending: "待审核",
  approved: "已受理",
  rejected: "已驳回",
};

// 提交状态徽标的语义配色：待审核用品牌浅底，已受理用中性底，已驳回用错误色。
export const statusBadgeClass: Record<SubmissionStatus, string> = {
  pending: "bg-accent text-accent-foreground",
  approved: "bg-secondary text-secondary-foreground",
  rejected: "bg-destructive/10 text-destructive",
};

// 站内统一的时间戳格式化（lib/format）；在此转出口保持既有相对导入不变
export { formatWhen } from "@/lib/format";

export function RejectionReason({ reason }: { reason: string | null }) {
  if (reason === null) return null;

  return (
    <Callout tone="warning" title="驳回理由" className="mt-3 max-w-3xl">
      <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{reason}</span>
    </Callout>
  );
}
