// 当前版 vs 提案的行级 diff 展示（审核队列用）。diff 现算，不落库（ADR-0004 #1）。
// F11：统一差异配色（红删绿增），减号／加号标记保留以供快速扫描。

import { cn } from "@/lib/utils";
import { diffLines } from "@/lib/diff";

export function ContentDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const rows = diffLines(oldText, newText);
  return (
    <div data-testid="content-diff" className="overflow-hidden rounded-lg border border-border">
      <p className="border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span className="mr-3">− 删除的行</span>
        <span>+ 新增的行</span>
      </p>
      <pre className="overflow-x-auto bg-muted/20 p-3 font-mono text-xs leading-5">
        {rows.map((row, index) => (
          <div
            key={index}
            data-diff={row.type}
            className={cn(
              "whitespace-pre-wrap px-1 [overflow-wrap:anywhere]",
              row.type === "add" && "bg-green-500/10 text-green-700 dark:text-green-400",
              row.type === "del" && "bg-red-500/10 text-red-700 dark:text-red-400",
            )}
          >
            <span className="select-none pr-1 opacity-60">
              {row.type === "add" ? "+" : row.type === "del" ? "−" : " "}
            </span>
            {row.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
