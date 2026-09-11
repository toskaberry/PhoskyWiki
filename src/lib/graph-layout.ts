import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import type { SiteGraphData } from "./graph-types";

export interface PositionedNode { id: number; x: number; y: number; radius: number }
export interface GraphCommunity { schoolId: number; x: number; y: number; radius: number }
export interface GraphLayout { nodes: PositionedNode[]; communities: GraphCommunity[] }

const GAP = 14;

/** Exact geometry projection after soft forces, also used while dragging. */
function separate(nodes: PositionedNode[], pinned?: number) {
  for (let pass = 0; pass < 60; pass++) {
    let changed = false;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
      const minimum = a.radius + b.radius + GAP;
      if (distance >= minimum) continue;
      changed = true;
      if (distance < 1e-8) { dx = Math.cos(i + j); dy = Math.sin(i + j); distance = 1; }
      const shift = (minimum - distance + .01) / distance;
      dx *= shift; dy *= shift;
      if (a.id === pinned) { b.x += dx; b.y += dy; }
      else if (b.id === pinned) { a.x -= dx; a.y -= dy; }
      else { a.x -= dx / 2; a.y -= dy / 2; b.x += dx / 2; b.y += dy / 2; }
    }
    if (!changed) return;
  }
  // A finite projection budget alone cannot guarantee separation. Place remaining
  // conflicts against the already accepted circles; the final fallback is outside
  // their bounding box. The dragged circle is accepted first and never displaced.
  const placed: PositionedNode[] = [];
  for (const node of [...nodes].sort((a, b) => Number(b.id === pinned) - Number(a.id === pinned))) {
    const clear = () => placed.every(p => Math.hypot(p.x - node.x, p.y - node.y) >= p.radius + node.radius + GAP);
    const origin = { x: node.x, y: node.y };
    for (let attempt = 1; !clear() && attempt <= 200; attempt++) {
      node.x = origin.x + Math.cos(attempt * 2.39996) * Math.sqrt(attempt) * (node.radius + GAP);
      node.y = origin.y + Math.sin(attempt * 2.39996) * Math.sqrt(attempt) * (node.radius + GAP);
    }
    if (!clear()) node.x = Math.max(...placed.map(p => p.x + p.radius)) + node.radius + GAP + 1;
    placed.push(node);
  }
}

/** Deterministic, serializable layout. Does not mutate the graph payload. */
export function layoutGraph(data: SiteGraphData, rootId?: number): GraphLayout {
  if (!data.nodes.length) return { nodes: [], communities: [] };
  const present = data.schools.filter(s => data.nodes.some(n => n.schoolAffinities.some(a => a.schoolId === s.id)));
  const spread = Math.max(260, Math.sqrt(data.nodes.length) * 47);
  const centers = new Map(present.map((school, i) => [school.id, {
    x: Math.cos(i * Math.PI * 2 / present.length - Math.PI / 2) * spread,
    y: Math.sin(i * Math.PI * 2 / present.length - Math.PI / 2) * spread,
  }]));
  const nodes = data.nodes.map((node, i) => {
    const affinities = node.schoolAffinities.filter(a => centers.has(a.schoolId));
    const total = affinities.reduce((sum, a) => sum + a.count, 0);
    const anchorX = total ? affinities.reduce((sum, a) => sum + centers.get(a.schoolId)!.x * a.count, 0) / total : 0;
    const anchorY = total ? affinities.reduce((sum, a) => sum + centers.get(a.schoolId)!.y * a.count, 0) / total : 0;
    return {
      id: node.id, radius: Math.min(22, 4 + Math.sqrt(node.heat) * 2.5),
      x: anchorX + Math.cos(i * 2.39996) * Math.sqrt(i) * 16,
      y: anchorY + Math.sin(i * 2.39996) * Math.sqrt(i) * 16,
      anchorX, anchorY, strength: affinities.length === 0 ? .002 : affinities.length === 1 ? .13 : .06,
    };
  });
  const simulation = forceSimulation(nodes).stop()
    .force("charge", forceManyBody().strength(-170))
    .force("links", forceLink(data.edges.map(e => ({ ...e }))).id(n => nodes[n.index!].id).distance(130).strength(e => .009 * Math.min(2, Math.sqrt(e.weight))))
    .force("x", forceX<(typeof nodes)[number]>(n => n.anchorX).strength(n => n.strength))
    .force("y", forceY<(typeof nodes)[number]>(n => n.anchorY).strength(n => n.strength))
    .force("collision", forceCollide<(typeof nodes)[number]>(n => n.radius + GAP / 2 + 3).iterations(4));
  simulation.tick(300);
  simulation.stop();
  separate(nodes);
  const root = nodes.find(n => n.id === rootId);
  const dx = root?.x ?? 0, dy = root?.y ?? 0;
  for (const node of nodes) { node.x -= dx; node.y -= dy; }
  const communities = present.map(school => {
    const members = data.nodes.flatMap((n, i) => {
      const affinity = n.schoolAffinities.find(a => a.schoolId === school.id);
      return affinity ? [{ position: nodes[i], weight: affinity.count / n.schoolAffinities.reduce((sum, a) => sum + a.count, 0) }] : [];
    });
    const total = members.reduce((sum, m) => sum + m.weight, 0);
    const x = members.reduce((sum, m) => sum + m.position.x * m.weight, 0) / total;
    const y = members.reduce((sum, m) => sum + m.position.y * m.weight, 0) / total;
    const variance = members.reduce((sum, m) => sum + ((m.position.x - x) ** 2 + (m.position.y - y) ** 2) * m.weight, 0) / total;
    return { schoolId: school.id, x, y, radius: Math.max(170, Math.sqrt(variance) * 1.25) };
  });
  return { nodes: nodes.map(({ id, x, y, radius }) => ({ id, x, y, radius })), communities };
}

export function moveGraphNode(layout: GraphLayout, id: number, x: number, y: number): GraphLayout {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return layout;
  const nodes = layout.nodes.map(n => n.id === id ? { ...n, x, y } : { ...n });
  separate(nodes, id);
  return { ...layout, nodes };
}
