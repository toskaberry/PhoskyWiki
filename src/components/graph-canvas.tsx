"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { moveGraphNode, type GraphLayout } from "@/lib/graph-layout";
import { UNSCHOOLED_COLOR, UNSCHOOLED_LABEL, type GraphNode, type SiteGraphData } from "@/lib/graph-types";
import { GraphScene } from "./graph-scene";

export interface GraphCanvasHandle { locate: (termId: number) => void }
export interface GraphCanvasProps {
  data: SiteGraphData;
  height: number;
  rootId?: number;
  onNodeClick?: (node: GraphNode) => void;
  onClearSelection?: () => void;
  ariaLabel: string;
  /** 工具栏前段：全站图谱的搜索定位、局部图谱的跳数切换等页面专属控件。 */
  toolbarLeading?: ReactNode;
  /** 画布下方的图例／索引层（学派配色与视觉编码说明）。 */
  footer?: ReactNode;
  ref?: React.Ref<GraphCanvasHandle>;
}
export interface GraphCamera { x: number; y: number; scale: number }
const EMPTY: GraphLayout = { nodes: [], communities: [] };
const MIN_ZOOM = .35;
const MAX_ZOOM = 4;
type HoverCorridor = { tipX: number; tipY: number; halfWidth: number; left: number; right: number; edgeY: number };

function isInsideCorridor(point: { x: number; y: number }, corridor: HoverCorridor) {
  const polygon = [
    { x: corridor.tipX - corridor.halfWidth, y: corridor.tipY },
    { x: corridor.tipX + corridor.halfWidth, y: corridor.tipY },
    { x: corridor.right, y: corridor.edgeY },
    { x: corridor.left, y: corridor.edgeY },
  ];
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function fitCamera(layout: GraphLayout, width: number, height: number, rootId?: number): GraphCamera {
  if (!layout.nodes.length) return { x: 0, y: 0, scale: 1 };
  const left = Math.min(...layout.nodes.map(n => n.x - n.radius)) - 50;
  const right = Math.max(...layout.nodes.map(n => n.x + n.radius)) + 50;
  const top = Math.min(...layout.nodes.map(n => n.y - n.radius)) - 60;
  const bottom = Math.max(...layout.nodes.map(n => n.y + n.radius)) + 50;
  const root = layout.nodes.find(n => n.id === rootId);
  const x = root?.x ?? (left + right) / 2, y = root?.y ?? (top + bottom) / 2;
  return { x, y, scale: Math.max(MIN_ZOOM, Math.min(1.2, width / (2 * Math.max(x - left, right - x)), height / (2 * Math.max(y - top, bottom - y)))) };
}

export function GraphCanvas({ data, height, rootId, onNodeClick, onClearSelection, ariaLabel, toolbarLeading, footer, ref }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const pendingLocate = useRef<number | null>(null);
  const onClearSelectionRef = useRef(onClearSelection);
  const gradientId = useId().replaceAll(":", "");
  const [result, setResult] = useState<{ source: SiteGraphData; layout: GraphLayout } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [width, setWidth] = useState(600);
  const [camera, setCamera] = useState<GraphCamera>({ x: 0, y: 0, scale: 1 });
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [located, setLocated] = useState<number | null>(null);
  const hoverCorridor = useRef<HoverCorridor | null>(null);
  const hoverDeparture = useRef<ReturnType<typeof setTimeout> | null>(null);
  const travellingToDetail = useRef(false);
  const gesture = useRef<{ pointerId: number; x: number; y: number; camera: GraphCamera; nodeId?: number; nodeX: number; nodeY: number; moved: boolean } | null>(null);
  const layout = result?.source === data ? result.layout : EMPTY;
  const activeId = hovered ?? selected;
  const active = data.nodes.find(n => n.id === activeId);
  const activePosition = layout.nodes.find(n => n.id === activeId);
  const detailAtTop = activePosition ? (activePosition.y - camera.y) * camera.scale > 0 : true;
  const schools = useMemo(() => new Map(data.schools.map(s => [s.id, s])), [data]);
  const neighbors = useMemo(() => {
    const ids = new Set<number>();
    if (activeId !== null) {
      ids.add(activeId);
      for (const edge of data.edges) {
        if (edge.source === activeId) ids.add(edge.target);
        if (edge.target === activeId) ids.add(edge.source);
      }
    }
    return ids;
  }, [data, activeId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => setWidth(container.clientWidth));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const cancelHoverDeparture = useCallback(() => {
    if (hoverDeparture.current !== null) clearTimeout(hoverDeparture.current);
    hoverDeparture.current = null;
  }, []);

  const clearSelection = useCallback(() => {
    cancelHoverDeparture();
    pendingLocate.current = null;
    hoverCorridor.current = null;
    travellingToDetail.current = false;
    setHovered(null);
    setSelected(null);
    setLocated(null);
    onClearSelectionRef.current?.();
  }, [cancelHoverDeparture]);

  useEffect(() => {
    onClearSelectionRef.current = onClearSelection;
  }, [onClearSelection]);

  const scheduleHoverDeparture = useCallback(() => {
    cancelHoverDeparture();
    hoverDeparture.current = setTimeout(() => {
      hoverCorridor.current = null;
      setHovered(null);
      hoverDeparture.current = null;
    }, 100);
  }, [cancelHoverDeparture]);

  const handleHover = useCallback((id: number | null) => {
    cancelHoverDeparture();
    if (travellingToDetail.current) return;
    if (id !== null) {
      setHovered(id);
      return;
    }
    scheduleHoverDeparture();
  }, [cancelHoverDeparture, scheduleHoverDeparture]);

  useLayoutEffect(() => {
    if (hovered === null || !activePosition) {
      hoverCorridor.current = null;
      return;
    }
    const container = containerRef.current?.getBoundingClientRect();
    const detail = detailRef.current?.getBoundingClientRect();
    if (!container || !detail) return;
    const x = (activePosition.x - camera.x) * camera.scale + width / 2;
    const y = (activePosition.y - camera.y) * camera.scale + height / 2;
    const edgeY = detail.bottom <= container.top + y ? detail.top - container.top : detail.bottom - container.top;
    const padding = 16;
    const left = detail.left - container.left - padding;
    const right = detail.right - container.left + padding;
    hoverCorridor.current = { tipX: x, tipY: y, halfWidth: activePosition.radius * camera.scale + padding, left, right, edgeY };
  }, [activePosition, camera, height, hovered, width]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      cancelHoverDeparture();
    };
  }, [cancelHoverDeparture, clearSelection]);

  useEffect(() => {
    let disposed = false;
    let worker: Worker | undefined;
    const accept = (next: GraphLayout) => {
      if (disposed) return;
      setResult({ source: data, layout: next });
      setFailed(false);
      const pending = next.nodes.find(n => n.id === pendingLocate.current);
      setCamera(pending ? { x: pending.x, y: pending.y, scale: 1.8 } : fitCamera(next, containerRef.current?.clientWidth ?? 600, height, rootId));
      setLocated(pending?.id ?? null);
      setSelected(pending?.id ?? null);
      setHovered(null);
      pendingLocate.current = null;
    };
    try {
      worker = new Worker(new URL("./graph-layout.worker.ts", import.meta.url));
      worker.onmessage = (event: MessageEvent<GraphLayout>) => { accept(event.data); worker?.terminate(); };
      worker.onerror = () => { worker?.terminate(); if (!disposed) setFailed(true); };
      worker.postMessage({ data, rootId });
    } catch { queueMicrotask(() => { if (!disposed) setFailed(true); }); }
    return () => { disposed = true; worker?.terminate(); };
  }, [data, rootId, height, retry]);

  useImperativeHandle(ref, () => ({ locate(termId) {
    const node = layout.nodes.find(n => n.id === termId);
    if (!node) { pendingLocate.current = termId; return; }
    setCamera({ x: node.x, y: node.y, scale: 1.8 });
    setSelected(termId); setHovered(null); setLocated(termId);
  } }), [layout]);

  // Native listener is explicitly non-passive, so zoom doesn't scroll the page.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = svg.getBoundingClientRect();
      const px = event.clientX - box.left - box.width / 2, py = event.clientY - box.top - box.height / 2;
      setCamera(c => {
        const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.scale * Math.exp(-event.deltaY * .0015)));
        return { x: c.x + px / c.scale - px / scale, y: c.y + py / c.scale - py / scale, scale };
      });
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, []);

  function zoom(factor: number) { setCamera(c => ({ ...c, scale: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.scale * factor)) })); }

  return (
    // 研究终端外框（#97）：工具栏 → 画布 → 图例，纸面／石墨配色来自 F01 主题令牌。
    <div className="w-full overflow-hidden rounded-lg border border-border bg-card text-card-foreground">
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2"
        role="group"
        aria-label="图谱工具栏"
        data-testid="graph-toolbar"
      >
        {toolbarLeading}
        <div className="ml-auto flex shrink-0 items-center gap-1" role="group" aria-label="图谱视口">
          <button type="button" onClick={() => zoom(1 / 1.3)} aria-label="缩小图谱" className="inline-flex size-11 items-center justify-center rounded border border-border bg-background text-foreground transition-colors hover:bg-muted"><ZoomOut aria-hidden="true" className="size-4" /></button>
          <button type="button" onClick={() => zoom(1.3)} aria-label="放大图谱" className="inline-flex size-11 items-center justify-center rounded border border-border bg-background text-foreground transition-colors hover:bg-muted"><ZoomIn aria-hidden="true" className="size-4" /></button>
          <button type="button" onClick={() => { clearSelection(); setCamera(fitCamera(layout, width, height, rootId)); }} className="inline-flex min-h-11 items-center gap-1.5 rounded border border-border bg-background px-2.5 text-sm text-foreground transition-colors hover:bg-muted"><Maximize aria-hidden="true" className="size-4" />适应画布</button>
        </div>
      </div>
      <div ref={containerRef} data-testid="graph-canvas" data-located={located ?? undefined} className="relative w-full overflow-hidden" style={{ height }} onPointerLeave={() => {
        travellingToDetail.current = false;
        if (hovered !== null) scheduleHoverDeparture();
      }} onPointerMoveCapture={event => {
        const box = event.currentTarget.getBoundingClientRect();
        const inside = hoverCorridor.current !== null && isInsideCorridor({ x: event.clientX - box.left, y: event.clientY - box.top }, hoverCorridor.current);
        const wasTravelling = travellingToDetail.current;
        travellingToDetail.current = inside;
        if (inside) cancelHoverDeparture();
        else if (wasTravelling && hovered !== null) scheduleHoverDeparture();
      }}>
        <svg ref={svgRef} data-graph-surface="true" role="group" aria-label={ariaLabel} viewBox={`0 0 ${width} ${height}`} className="h-full w-full touch-none select-none"
          onPointerDown={event => {
            if (event.button !== 0) return;
            const id = (event.target as Element).closest("[data-node-id]")?.getAttribute("data-node-id");
            const node = id === undefined || id === null ? undefined : layout.nodes.find(n => n.id === Number(id));
            if (!node) clearSelection();
            gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera, nodeId: node?.id, nodeX: node?.x ?? 0, nodeY: node?.y ?? 0, moved: false };
            if (node) setSelected(node.id);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            const g = gesture.current;
            if (!g || g.pointerId !== event.pointerId) return;
            const dx = event.clientX - g.x, dy = event.clientY - g.y;
            if (!g.moved && Math.hypot(dx, dy) < 4) return;
            g.moved = true;
            if (g.nodeId !== undefined) {
              setResult(current => current?.source === data ? { ...current, layout: moveGraphNode(current.layout, g.nodeId!, g.nodeX + dx / g.camera.scale, g.nodeY + dy / g.camera.scale) } : current);
            } else setCamera({ ...g.camera, x: g.camera.x - dx / g.camera.scale, y: g.camera.y - dy / g.camera.scale });
          }}
          onPointerUp={event => {
            const g = gesture.current;
            if (!g || g.pointerId !== event.pointerId) return;
            gesture.current = null;
            // Pointer capture retargets click to the SVG; use the original gesture
            // target, and never navigate after a drag.
            if (!g.moved && event.pointerType !== "touch") {
              const node = data.nodes.find(n => n.id === g.nodeId);
              if (node) onNodeClick?.(node);
            }
          }}
          onPointerCancel={() => { gesture.current = null; }}
        >
          <GraphScene data={data} layout={layout} camera={camera} width={width} height={height} gradientId={gradientId} activeId={activeId} neighbors={neighbors}
            onHover={handleHover} onSelect={setSelected} onOpen={node => onNodeClick?.(node)} />
        </svg>
        {result?.source !== data && !failed && <span role="status" className="absolute inset-0 grid place-content-center text-sm text-muted-foreground">正在排列词条…</span>}
        {failed && <div role="status" className="absolute inset-0 grid place-content-center gap-2 bg-card text-sm"><p>图谱布局载入失败。</p><button onClick={() => { setFailed(false); setRetry(n => n + 1); }} className="rounded border px-3 py-1">重试布局</button></div>}
        {active && <div ref={detailRef} role="region" aria-label="词条关联详情" tabIndex={0} onPointerEnter={() => { travellingToDetail.current = false; hoverCorridor.current = null; cancelHoverDeparture(); }} onPointerLeave={scheduleHoverDeparture} style={{ top: detailAtTop ? 12 : undefined, bottom: detailAtTop ? undefined : 48, maxHeight: height / 2 - 64 }} className="absolute left-3 w-[min(20rem,calc(100%-1.5rem))] overflow-y-auto rounded-md border border-border bg-popover/95 text-popover-foreground shadow-md backdrop-blur-sm">
          <div className="border-b border-border px-3 py-2">
            <strong className="block break-words text-sm leading-snug">{active.title}</strong>
          </div>
          <div className="px-3 py-2 text-xs leading-relaxed">
            <div className="flex max-w-lg flex-wrap gap-x-3 gap-y-1">
              {active.schoolAffinities.length ? active.schoolAffinities.map(a => <span key={a.schoolId} className="whitespace-nowrap"><span className="mr-1 inline-block size-2 rounded-full align-middle" style={{ backgroundColor: schools.get(a.schoolId)?.color ?? UNSCHOOLED_COLOR }} />{schools.get(a.schoolId)?.title} · {a.count} 个视角</span>) : <span>{UNSCHOOLED_LABEL}</span>}
            </div>
            <p className="mt-1.5 font-mono">双链热度 {active.heat} · {active.perspectiveCount} 个视角</p>
            {active.schoolAffinities.length > 1 && <p className="mt-1 text-muted-foreground">学派成员视角可交叉计数，不表示概念归属比例。</p>}
            <button type="button" onClick={() => onNodeClick?.(active)} className="mt-2.5 inline-flex min-h-9 items-center rounded border border-primary/45 bg-background px-2.5 text-primary underline-offset-4 transition-colors hover:bg-accent hover:underline">进入词条</button>
          </div>
        </div>}
      </div>
      {footer}
    </div>
  );
}
