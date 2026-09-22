import { compareTermMetadata, type MetadataSnapshot } from "@/lib/revision-snapshot";

// F11：词条信息逐字段对照。修改行以暖色底标出，字段名标注（已修改）。
export function TermMetadataDiff({ from, to, fromLabel = "当前版", toLabel = "提案" }: { from: MetadataSnapshot; to: MetadataSnapshot; fromLabel?: string; toLabel?: string }) {
  const rows = compareTermMetadata(from, to);
  const changedCount = rows.filter((row) => row.changed).length;
  return <div data-testid="term-metadata-diff" className="overflow-x-auto rounded-lg border border-border">
    <table className="w-full border-collapse text-sm">
      <thead><tr className="border-b border-border bg-muted/40">
        <th className="p-2 text-left font-medium">字段</th>
        <th className="p-2 text-left font-medium">{fromLabel}</th>
        <th className="p-2 text-left font-medium">{toLabel}</th>
      </tr></thead>
      <tbody>{rows.map((row) => <tr key={row.field} data-changed={row.changed} className={row.changed ? "border-t border-border bg-amber-500/10" : "border-t border-border"}>
        <th scope="row" className="p-2 text-left align-top font-normal">{row.label}{row.changed && <span className="ml-1 rounded bg-amber-500/20 px-1 text-xs text-amber-700 dark:text-amber-400">已修改</span>}</th>
        <td className="min-w-32 p-2 align-top whitespace-pre-wrap [overflow-wrap:anywhere]">{row.before || <span className="text-muted-foreground">（空）</span>}</td>
        <td className="min-w-32 p-2 align-top whitespace-pre-wrap [overflow-wrap:anywhere]">{row.after || <span className="text-muted-foreground">（空）</span>}</td>
      </tr>)}
      {changedCount > 0 && <tr className="border-t border-border bg-muted/30 text-xs text-muted-foreground"><td colSpan={3} className="p-2">{changedCount} 个字段有修改</td></tr>}
      </tbody>
    </table>
  </div>;
}
