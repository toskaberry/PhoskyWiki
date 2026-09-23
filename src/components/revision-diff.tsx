import { diffInline, diffLines, type DiffRow } from "@/lib/diff";
import { cn } from "@/lib/utils";

interface Cell {
  line: number;
  type: DiffRow["type"];
  parts: DiffRow[];
}

/** MediaWiki 式左右对照：变更块内按行配对，再对每对行作字符级高亮。 */
export function RevisionDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const diff = diffLines(oldText, newText);
  const rows: { left?: Cell; right?: Cell }[] = [];
  let leftLine = 1;
  let rightLine = 1;
  let index = 0;
  while (index < diff.length) {
    const row = diff[index];
    if (row.type === "same") {
      rows.push({
        left: { line: leftLine++, type: "same", parts: [row] },
        right: { line: rightLine++, type: "same", parts: [row] },
      });
      index++;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (index < diff.length && diff[index].type !== "same") {
      const changed = diff[index++];
      (changed.type === "del" ? removed : added).push(changed.text);
    }
    for (let n = 0; n < Math.max(removed.length, added.length); n++) {
      const parts = diffInline(removed[n] ?? "", added[n] ?? "");
      rows.push({
        left: n < removed.length ? { line: leftLine++, type: "del", parts: parts.filter((part) => part.type !== "add") } : undefined,
        right: n < added.length ? { line: rightLine++, type: "add", parts: parts.filter((part) => part.type !== "del") } : undefined,
      });
    }
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border" data-testid="revision-diff">
      <table className="w-full min-w-96 table-fixed text-left font-mono text-sm">
        <caption className="sr-only">修订差异：左侧起始修订，右侧目标修订。减号表示删除，加号表示新增。</caption>
        <thead className="border-b border-border bg-muted/40 text-xs tracking-wide"><tr>
          <th scope="col" className="p-3 font-medium">起始修订</th>
          <th scope="col" className="p-3 font-medium">目标修订</th>
        </tr></thead>
        <tbody>
          {rows.map((row, i) => <tr key={i} className="border-b border-border/60 last:border-b-0"><DiffCell cell={row.left} /><DiffCell cell={row.right} /></tr>)}
          {!rows.length && <tr><td colSpan={2} className="p-3 text-muted-foreground">两侧正文均为空。</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function DiffCell({ cell }: { cell?: Cell }) {
  return (
    <td data-diff={cell?.type} className={cn("w-1/2 border-r border-border/60 p-2 align-top whitespace-pre-wrap break-words [overflow-wrap:anywhere] last:border-r-0",
      cell?.type === "del" && "bg-red-500/10",
      cell?.type === "add" && "bg-green-500/10",
    )}>
      {cell && <>
        <span className="mr-2 select-none text-xs text-muted-foreground">{cell.line} {cell.type === "del" ? "−" : cell.type === "add" ? "+" : " "}</span>
        {cell.parts.map((part, i) => part.type === "del"
          ? <del key={i} className="bg-red-500/25 font-semibold no-underline">{part.text}</del>
          : part.type === "add"
            ? <ins key={i} className="bg-green-500/25 font-semibold no-underline">{part.text}</ins>
            : <span key={i}>{part.text}</span>)}
      </>}
    </td>
  );
}
