import { describe, expect, it } from "vitest";
import { layoutGraph, moveGraphNode } from "@/lib/graph-layout";
import type { SiteGraphData } from "@/lib/graph-types";

const data: SiteGraphData = {
  schools: [{ id: 1, title: "甲", slug: "a", color: "#e11d48" }, { id: 2, title: "乙", slug: "b", color: "#2563eb" }],
  nodes: Array.from({ length: 80 }, (_, id) => ({
    id, title: `词条${id}`, slug: `term-${id}`, url: `/term/term-${id}`, heat: 150, perspectiveCount: 2,
    schoolId: id % 2 + 1,
    schoolAffinities: id % 3 ? [{ schoolId: id % 2 + 1, count: 2 }] : [{ schoolId: 1, count: 1 }, { schoolId: 2, count: 1 }],
  })),
  edges: Array.from({ length: 79 }, (_, i) => ({ source: 0, target: i + 1, weight: 3 })),
};

function expectSeparated(nodes: { x: number; y: number; radius: number }[]) {
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    expect(Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)).toBeGreaterThan(nodes[i].radius + nodes[j].radius + 3);
  }
}

describe("词条图谱布局", () => {
  it("拖到另一个词条中心时自动避让，拖动目标跟手，原布局不变", () => {
    const before = layoutGraph(data);
    const target = before.nodes[1];
    const after = moveGraphNode(before, 0, target.x, target.y);
    expect(after.nodes[0]).toMatchObject({ x: target.x, y: target.y });
    expectSeparated(after.nodes);
    expect(before.nodes[1]).toBe(target);
    expect(after.nodes[1]).not.toMatchObject({ x: target.x, y: target.y });
  });
  it("密集网络保留唯一词条并留出圆点间距，局部根节点居中", () => {
    const result = layoutGraph(data, 0);
    expect(result.nodes).toHaveLength(80);
    expect(new Set(result.nodes.map(n => n.id)).size).toBe(80);
    expect(result.nodes.find(n => n.id === 0)).toMatchObject({ x: 0, y: 0 });
    expectSeparated(result.nodes);
    expect(data.nodes[0]).not.toHaveProperty("x");
  });
});
