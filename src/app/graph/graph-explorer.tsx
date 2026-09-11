"use client";

// 全站图谱的交互层（T11）：搜索定位节点（定位 = 视口居中 + 放大 + 高亮聚焦邻居）。
// 搜索是纯客户端过滤（节点数据已在手，无需再打端点）；回车定位首个命中。

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { GraphCanvas, type GraphCanvasHandle } from "@/components/graph-canvas";
import {
  UNSCHOOLED_COLOR,
  UNSCHOOLED_LABEL,
  type SiteGraphData,
} from "@/lib/graph-types";

export function GraphExplorer({ data }: { data: SiteGraphData }) {
  const router = useRouter();
  const canvasRef = useRef<GraphCanvasHandle>(null);
  const [query, setQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [located, setLocated] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return data.nodes
      .filter((node) => node.title.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => b.heat - a.heat)
      .slice(0, 8);
  }, [data, query]);

  function locate(title: string) {
    const node = data.nodes.find((n) => n.title === title);
    if (!node) return;
    setLocated(node.title);
    setSuggestionsOpen(false);
    canvasRef.current?.locate(node.id);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <input
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSuggestionsOpen(true); }}
            onFocus={() => setSuggestionsOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && matches.length > 0) locate(matches[0]!.title);
              if (event.key === "Escape") setSuggestionsOpen(false);
            }}
            placeholder="搜索词条定位节点…"
            aria-label="图谱节点搜索"
            data-testid="graph-search"
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring"
          />
          {suggestionsOpen && matches.length > 0 && (
            <ul
              className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-background shadow-lg"
              role="listbox"
              aria-label="匹配词条"
            >
              {matches.map((node) => (
                <li key={node.id} role="option" aria-selected={node.title === located}>
                  <button
                    type="button"
                    onClick={() => locate(node.title)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="min-w-0 truncate">{node.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      热度 {node.heat}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <span className="text-sm text-muted-foreground" data-testid="graph-summary">
          {data.nodes.length} 个词条 · {data.edges.length} 条双链关系
        </span>
        {located && (
          <span className="text-sm" data-testid="graph-located" role="status">
            已定位：
            <Link
              href={data.nodes.find((n) => n.title === located)!.url}
              className="ml-1 underline underline-offset-4"
            >
              {located}
            </Link>
          </span>
        )}
      </div>

      {/* 学派配色图例（HTML 渲染：可读屏、可选中复制；交互式过滤属二期图谱高级过滤） */}
      <ul
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground"
        aria-label="学派配色图例"
        data-testid="graph-legend"
      >
        {data.schools.map((school) => (
          <li key={school.id} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: school.color }}
            />
            {school.title}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-full"
            style={{ backgroundColor: UNSCHOOLED_COLOR }}
          />
          {UNSCHOOLED_LABEL}
        </li>
      </ul>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <GraphCanvas
          ref={canvasRef}
          data={data}
          height={640}
          onNodeClick={(node) => router.push(node.url)}
          onClearSelection={() => setLocated(null)}
          ariaLabel="全站词条双链网络图，饼图显示多学派视角，可缩放拖拽，聚焦查看关联，点击或回车进入词条页"
        />
      </div>
    </div>
  );
}
