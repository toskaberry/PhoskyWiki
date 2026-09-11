// 全站图谱页（T11）：全部词条为节点，缩放/拖拽/搜索定位，按学派着色。
// 数据来自 links 聚合只读层（src/lib/graph.ts，与 /api/graph/site 同源）。

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
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight">全站图谱</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        每个节点是一个词条，连线是视角正文里的双链；节点大小代表双链热度，饼图颜色呈现各学派成员视角。
        群落可以交叠，不代表概念的排他归属。滚轮缩放、拖拽避让，悬停或键盘聚焦查看关联，点击进入词条。
      </p>
      <div className="mt-6">
        <GraphExplorer data={data} />
      </div>
    </main>
  );
}
