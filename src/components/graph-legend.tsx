import { UNSCHOOLED_COLOR, UNSCHOOLED_LABEL, type GraphSchool } from "@/lib/graph-types";

/**
 * 图谱终端图例（#97）：学派配色 + 视觉编码 + 群落交叠说明。
 * 颜色只解释「站内已有视角的关联」，明确不表示概念的排他归属（CONTEXT.md 学派群落）。
 * 全站图例传全部学派；局部图谱只传当前邻域出现的学派，未出现时省略对应项。
 */
export function GraphLegend({ schools, showUnschooled = true, testId = "graph-legend" }: {
  schools: GraphSchool[];
  showUnschooled?: boolean;
  testId?: string;
}) {
  return (
    <div className="border-t border-border px-3 py-3 sm:px-4">
      <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
        编码：节点大小 = 双链热度；多学派词条以扇区呈现各学派成员视角数（可交叉计数）。
      </p>
      <ul
        className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground"
        aria-label="学派配色图例"
        data-testid={testId}
      >
        {schools.map((school) => (
          <li key={school.id} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: school.color }}
            />
            {school.title}
          </li>
        ))}
        {showUnschooled && (
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: UNSCHOOLED_COLOR }}
            />
            {UNSCHOOLED_LABEL}
          </li>
        )}
      </ul>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        学派群落可以交叠，同一词条可连接多个群落；颜色反映站内已有视角的关联，不表示概念的排他归属。
      </p>
    </div>
  );
}
