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
      <g pointerEvents="none" stroke="var(--muted-foreground)">{data.edges.map(edge => {
        const source = positions.get(edge.source), target = positions.get(edge.target);
        if (!source || !target) return null;
        const touches = edge.source === activeId || edge.target === activeId;
        return <line key={`${edge.source}-${edge.target}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} strokeWidth={touches ? 1.8 : 1} opacity={activeId === null ? .075 : touches ? .65 : .015} />;
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
        </g>;
      })}
    </g>
    <g aria-hidden="true">{labels}</g>
  </>;
});
