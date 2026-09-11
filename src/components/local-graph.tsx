"use client";

// 词条页局部图谱（T11）：1~2 跳邻居网络，节点点击跳转词条页。
// 初始数据（1 跳）由服务端组件注入；切跳数时经只读端点 /api/graph/local 取数。
// 画布之外附「邻居词条」链接列表——无 JS/读屏器可用的等价导航。

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { GraphCanvas } from "@/components/graph-canvas";
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

  const neighbors = data.nodes
    .filter((n) => n.id !== data.rootId)
    .sort((a, b) => b.heat - a.heat || a.id - b.id);
  const schoolNameById = new Map(data.schools.map((s) => [s.id, s.title]));

  return (
    <section aria-labelledby="local-graph-heading" className="mt-12 scroll-mt-20">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="local-graph-heading" className="text-xl font-semibold">
          局部图谱
        </h2>
        <div className="flex items-center gap-2 text-sm" role="group" aria-label="邻居跳数">
          {([1, 2] as const).map((hops) => (
            <button
              key={hops}
              type="button"
              onClick={() => void switchHops(hops)}
              disabled={loading}
              aria-pressed={data.hops === hops}
              className={`rounded-md border px-2.5 py-1 transition-colors ${
                data.hops === hops
                  ? "border-foreground bg-muted text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {hops} 跳
            </button>
          ))}
          {loading && <span className="text-muted-foreground">载入中…</span>}
          {failed && (
            <span role="status" className="text-destructive">
              图谱载入失败，已保留当前视图，可重试切换。
            </span>
          )}
        </div>
      </div>

      {neighbors.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          「{termTitle}」还没有站内双链邻居——它尚未被其他词条引用，也没有指向其他词条的双链。
        </p>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <GraphCanvas
              data={data}
              height={360}
              rootId={data.rootId}
              onNodeClick={(node) => router.push(node.url)}
              ariaLabel={`「${termTitle}」的 ${data.hops} 跳邻居网络图，节点可点击进入词条`}
            />
          </div>
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
                  <span className="ml-1.5 text-xs text-muted-foreground">{node.heat}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
