"use client";

// 词条页局部图谱（T11 / #97 研究终端）：1~2 跳邻居网络，节点点击跳转词条页。
// 初始数据（1 跳）由服务端组件注入；切跳数时经只读端点 /api/graph/local 取数。
// 终端层级：工具栏（跳数切换 + 视口控件）→ 画布 → 学派图例；
// 画布之外附「邻居词条」链接列表——无 JS/读屏器可用的等价导航。

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { GraphCanvas } from "@/components/graph-canvas";
import { GraphLegend } from "@/components/graph-legend";
import type { LocalGraphData } from "@/lib/graph-types";

export function LocalGraph({
  termId,
  termTitle,
  initialData,
}: {
  termId: number;
  termTitle: string;
  /** hops=1 的服务端预取数据 */
  initialData: LocalGraphData;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function switchHops(hops: 1 | 2) {
    if (hops === data.hops || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/graph/local?termId=${termId}&hops=${hops}`);
      if (res.ok) {
        setData((await res.json()) as LocalGraphData);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  const neighbors = useMemo(
    () =>
      data.nodes
        .filter((n) => n.id !== data.rootId)
        .sort((a, b) => b.heat - a.heat || a.id - b.id),
    [data],
  );
  const schoolNameById = useMemo(() => new Map(data.schools.map((s) => [s.id, s.title])), [data]);
  // 图例只列当前邻域里实际出现的学派（索引层级跟随数据，不列无关项）。
  const presentSchools = useMemo(
    () =>
      data.schools.filter((school) =>
        data.nodes.some((n) => n.schoolAffinities.some((a) => a.schoolId === school.id)),
      ),
    [data],
  );
  const hasUnschooled = useMemo(
    () => data.nodes.some((n) => n.schoolAffinities.length === 0),
    [data],
  );

  return (
    <section aria-labelledby="local-graph-heading" className="mt-10 scroll-mt-20">
      <div className="mb-4">
        <h2 id="local-graph-heading" className="text-xl font-semibold">
          局部图谱
        </h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          以「{termTitle}」为中心的双链邻居网络。在工具栏切换一／二跳、缩放与适应画布，或用下方邻居链接直接进入词条。
        </p>
      </div>

      {neighbors.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          「{termTitle}」还没有站内双链邻居——它尚未被其他词条引用，也没有指向其他词条的双链。
        </p>
      ) : (
        <>
          <GraphCanvas
            data={data}
            height={360}
            rootId={data.rootId}
            onNodeClick={(node) => router.push(node.url)}
            ariaLabel={`「${termTitle}」的 ${data.hops} 跳邻居网络图，节点可点击进入词条`}
            toolbarLeading={
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="邻居跳数">
                {([1, 2] as const).map((hops) => (
                  <button
                    key={hops}
                    type="button"
                    onClick={() => void switchHops(hops)}
                    disabled={loading}
                    aria-pressed={data.hops === hops}
                    className={`inline-flex min-h-11 items-center rounded-md border px-3 font-mono text-sm transition-colors ${
                      data.hops === hops
                        ? "border-foreground bg-muted font-semibold text-foreground"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {hops} 跳
                  </button>
                ))}
                {loading && <span className="min-h-11 text-sm text-muted-foreground">载入中…</span>}
                {failed && (
                  <span role="status" className="min-h-11 py-2 text-sm leading-snug text-destructive">
                    图谱载入失败，已保留当前视图，可重试切换。
                  </span>
                )}
              </div>
            }
            legend={
              <GraphLegend
                schools={presentSchools}
                showUnschooled={hasUnschooled}
                testId="local-graph-legend"
              />
            }
          />
          <ul
            className="mt-3 flex flex-wrap items-center gap-2"
            aria-label="邻居词条"
            data-testid="graph-neighbors"
          >
            {neighbors.map((node) => (
              <li key={node.id}>
                <Link
                  href={node.url}
                  aria-label={`${node.title}（双链热度 ${node.heat}）`}
                  className="inline-block rounded-full border border-border bg-card px-3 py-1 text-sm transition-colors hover:border-foreground/40"
                >
                  {node.title}
                  {node.schoolId && schoolNameById.get(node.schoolId) && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {schoolNameById.get(node.schoolId)}
                    </span>
                  )}
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground">{node.heat}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
