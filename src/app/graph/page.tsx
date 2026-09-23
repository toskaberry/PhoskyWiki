// 全站图谱页（T11 / #97 研究终端）：全部词条为节点，缩放/拖拽/搜索定位，按学派着色。
// 数据来自 links 聚合只读层（src/lib/graph.ts，与 /api/graph/site 同源）。
// 信息层级：工具栏（搜索定位 + 视口控件 + 概要计数）→ 画布 → 学派图例 → 节点详情。

import type { Metadata } from "next";

import { GraphExplorer } from "@/app/graph/graph-explorer";
import { getSiteGraph } from "@/lib/graph";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "全站图谱",
  description: "词条双链网络的可视化：缩放、拖拽、搜索定位节点，按学派着色。",
};

export default async function GraphPage() {
  const data = await getSiteGraph();

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">全站图谱</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        每个节点是一个词条，连线是视角正文里的双链。用工具栏搜索定位、缩放与适应画布；
        悬停、键盘聚焦或点按节点查看关联详情，再进入词条。图例说明配色与编码。
      </p>
      <div className="mt-6">
        <GraphExplorer data={data} />
      </div>
    </main>
  );
}
