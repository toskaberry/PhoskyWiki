import { memo } from "react";
import type { GraphLayout } from "@/lib/graph-layout";
import { UNSCHOOLED_COLOR, type GraphNode, type SiteGraphData } from "@/lib/graph-types";
import type { GraphCamera } from "./graph-canvas";

interface Props {
  data: SiteGraphData; layout: GraphLayout; camera: GraphCamera; width: number; height: number;
  gradientId: string; activeId: number | null; neighbors: Set<number>;
  onHover: (id: number | null) => void; onSelect: (id: number) => void; onOpen: (node: GraphNode) => void;
}

/** Solid sectors (no donut hole). Count totals may include overlapping memberships. */
function sectors(node: GraphNode, radius: number) {
  const total = node.schoolAffinities.reduce((sum, a) => sum + a.count, 0);
  let angle = -Math.PI / 2;
  return node.schoolAffinities.map(a => {
    const end = angle + a.count / total * Math.PI * 2;
    const path = `M 0 0 L ${Math.cos(angle) * radius} ${Math.sin(angle) * radius} A ${radius} ${radius} 0 ${end - angle > Math.PI ? 1 : 0} 1 ${Math.cos(end) * radius} ${Math.sin(end) * radius} Z`;
    angle = end;
    return { schoolId: a.schoolId, path };
  });
}

export const GraphScene = memo(function GraphScene({ data, layout, camera, width, height, gradientId, activeId, neighbors, onHover, onSelect, onOpen }: Props) {
  const positions = new Map(layout.nodes.map(n => [n.id, n]));
  const schools = new Map(data.schools.map(s => [s.id, s]));
  const activeSchools = new Set(data.nodes.find(n => n.id === activeId)?.schoolAffinities.map(a => a.schoolId));
  const screen = (x: number, y: number) => ({ x: (x - camera.x) * camera.scale + width / 2, y: (y - camera.y) * camera.scale + height / 2 });
  const circles = layout.nodes.map(n => ({ ...screen(n.x, n.y), radius: n.radius * camera.scale }));
  const occupied: { x: number; y: number; width: number; height: number }[] = [];
  const labels = [...data.nodes].sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId) || b.heat - a.heat).flatMap(node => {
    const p = positions.get(node.id);
    if (!p || (activeId !== null && !neighbors.has(node.id))) return [];
    const center = screen(p.x, p.y), radius = p.radius * camera.scale;
    // 当前节点的标签是选中层级的一部分（#97）：始终显示，避让规则让位于轮廓层级。
    if (node.id === activeId) {
      const textWidth = Array.from(node.title).length * 15;
      const fits = [
        { x: center.x + radius + 8, y: center.y - 9 },
        { x: center.x - textWidth / 2, y: center.y + radius + 8 },
        { x: center.x - textWidth / 2, y: center.y - radius - 26 },
      ].find(point => point.x >= 8 && point.y >= 8 && point.x + textWidth <= width - 8 && point.y + 18 <= height - 8);
      const point = fits ?? { x: Math.min(Math.max(8, center.x - textWidth / 2), Math.max(8, width - textWidth - 8)), y: center.y + radius + 8 };
      return [<text key={node.id} x={point.x} y={point.y + 13} fontSize={12.5} fontWeight={600} fill="var(--foreground)" stroke="var(--card)" strokeWidth={5} paintOrder="stroke" pointerEvents="none">{node.title}</text>];
    }
    const textWidth = Array.from(node.title).length * 14;
    for (const box of [
      { x: center.x + radius + 6, y: center.y - 8, width: textWidth, height: 18 },
      { x: center.x - textWidth / 2, y: center.y + radius + 6, width: textWidth, height: 18 },
    ]) {
      if (box.x < 8 || box.y < 8 || box.x + box.width > width - 8 || box.y + box.height > height - 8) continue;
      if (occupied.some(b => box.x < b.x + b.width + 4 && box.x + box.width + 4 > b.x && box.y < b.y + b.height + 4 && box.y + box.height + 4 > b.y)) continue;
      if (circles.some(c => c.x + c.radius + 3 > box.x && c.x - c.radius - 3 < box.x + box.width && c.y + c.radius + 3 > box.y && c.y - c.radius - 3 < box.y + box.height)) continue;
      occupied.push(box);
      return [<text key={node.id} x={box.x} y={box.y + 13} fontSize={12} fill="var(--foreground)" stroke="var(--card)" strokeWidth={4} paintOrder="stroke" pointerEvents="none">{node.title}</text>];
    }
    return [];
  });
  return <>
    <defs>{data.schools.map(s => <radialGradient key={s.id} id={`${gradientId}-${s.id}`}><stop offset="0%" stopColor={s.color} stopOpacity={.12} /><stop offset="65%" stopColor={s.color} stopOpacity={.03} /><stop offset="100%" stopColor={s.color} stopOpacity={0} /></radialGradient>)}</defs>
    <g transform={`translate(${width / 2},${height / 2}) scale(${camera.scale}) translate(${-camera.x},${-camera.y})`}>
      <g pointerEvents="none">{layout.communities.map(c => <circle key={c.schoolId} cx={c.x} cy={c.y} r={c.radius} fill={`url(#${gradientId}-${c.schoolId})`} opacity={activeId === null || activeSchools.has(c.schoolId) ? 1 : .12} />)}</g>
      <g pointerEvents="none">{data.edges.map(edge => {
        const source = positions.get(edge.source), target = positions.get(edge.target);
        if (!source || !target) return null;
        const touches = edge.source === activeId || edge.target === activeId;
        // 关系层级（#97）：当前节点触边用前景色粗线，其余边退为底纹。
        return <line key={`${edge.source}-${edge.target}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y}
          stroke={touches ? "var(--foreground)" : "var(--muted-foreground)"} strokeWidth={touches ? 1.8 : 1} opacity={activeId === null ? .075 : touches ? .55 : .02} />;
      })}</g>
      {data.nodes.map(node => {
        const p = positions.get(node.id);
        if (!p) return null;
        return <g key={node.id} data-node-id={node.id} transform={`translate(${p.x},${p.y})`} role="link" tabIndex={0} aria-label={`${node.title}，${node.schoolAffinities.length} 个学派，进入词条`} className="cursor-pointer outline-none"
          opacity={activeId === null || neighbors.has(node.id) ? 1 : .2}
          onPointerEnter={() => onHover(node.id)} onPointerLeave={() => onHover(null)} onFocus={() => { onHover(null); onSelect(node.id); }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onOpen(node); } if (e.key === " ") { e.preventDefault(); onSelect(node.id); } }}>
          <circle data-node-boundary="true" r={p.radius} fill={node.schoolAffinities.length === 1 ? schools.get(node.schoolAffinities[0].schoolId)?.color : UNSCHOOLED_COLOR} stroke={node.id === activeId ? "var(--foreground)" : "var(--card)"} strokeWidth={node.id === activeId ? 2.5 : 1.5} />
          {node.schoolAffinities.length > 1 && sectors(node, p.radius - 1.5).map(sector => <path key={sector.schoolId} data-school-sector={sector.schoolId} d={sector.path} fill={schools.get(sector.schoolId)?.color ?? UNSCHOOLED_COLOR} />)}
          {/* 轮廓层级（#97）：选中节点加外圈虚线环，保留扇区可辨认的学派身份色。 */}
          {node.id === activeId && <circle aria-hidden="true" r={p.radius + 6} fill="none" stroke="var(--foreground)" strokeWidth={1.25} strokeDasharray="3 3" opacity={.7} pointerEvents="none" />}
        </g>;
      })}
    </g>
    <g aria-hidden="true">{labels}</g>
  </>;
});
