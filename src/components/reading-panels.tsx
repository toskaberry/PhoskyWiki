"use client";

// F07 按需面板（#95，spec 88 §6）：视角阅读页的「资料／感想／Agent 解读」按需入口。
//
// - 三块面板初始收起，由 ReadingPanelTriggers 的按钮开关（aria-expanded/aria-controls）。
// - 宽屏（≥1280px）面板渲染在 F06 阅读网格正文列之外的留白列；空间不足时是可关闭的
//   右侧覆盖层（Esc 关闭、Tab 在面板内循环、关闭后焦点回到触发入口）。开关只切显隐，
//   正文列宽度与阅读位置不变。
// - 面板内容常驻挂载（display:none 切换），关闭再打开不丢本页状态：Agent 回答与阅读
//   路径、资料展开状态都在原组件实例里，不新增跨页持久化。
// - 感想面板列出本页可读感想；「回到原句」由 PassageAnnotations 通过 context 注册定位
//   回调，复用既有句子面板（公开/私密、历史引用、回复语义不变）。

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { isLocatedThought, type ThoughtView } from "@/lib/thought-types";
import styles from "./reading-panels.module.css";

export type ReadingPanelKey = "materials" | "thoughts" | "agent";

interface ReadingPanelsValue {
  open: ReadingPanelKey | null;
  togglePanel: (key: ReadingPanelKey) => void;
  closePanel: (options?: { returnFocus?: boolean }) => void;
  registerTrigger: (key: ReadingPanelKey, element: HTMLElement | null) => void;
  /** PassageAnnotations 同步的最新感想列表（面板据此渲染）。 */
  thoughts: ThoughtView[];
  syncThoughts: (thoughts: ThoughtView[]) => void;
  /** 「回到原句」定位回调：由 PassageAnnotations 注册，面板内点击时调用。 */
  registerLocate: (locate: ((thought: ThoughtView) => void) | null) => void;
  locateThought: (thought: ThoughtView) => void;
}

const ReadingPanelsContext = createContext<ReadingPanelsValue | null>(null);

/** 无 Provider 时返回 null：PassageAnnotations 等宿主组件可独立使用。 */
export function useReadingPanels() {
  return useContext(ReadingPanelsContext);
}

export function ReadingPanelsProvider({
  initialThoughts,
  children,
}: {
  initialThoughts: ThoughtView[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState<ReadingPanelKey | null>(null);
  const [thoughts, setThoughts] = useState(initialThoughts);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);
  const triggersRef = useRef(new Map<ReadingPanelKey, HTMLElement>());
  const locateRef = useRef<((thought: ThoughtView) => void) | null>(null);

  const registerTrigger = useCallback((key: ReadingPanelKey, element: HTMLElement | null) => {
    if (element) triggersRef.current.set(key, element);
    else triggersRef.current.delete(key);
  }, []);

  /** 关闭当前面板；焦点在面板内（或已失焦到 body）时送回触发入口（不滚动，阅读位置不动）。
   *  焦点位于其他浮层（如写想法表单）时不打扰，避免打断输入。 */
  const closePanel = useCallback((options?: { returnFocus?: boolean }) => {
    const wasOpen = openRef.current;
    setOpen(null);
    if (!wasOpen || options?.returnFocus === false) return;
    const area = document.getElementById("reading-panels-area");
    const active = document.activeElement;
    const insidePanel = area !== null && active instanceof Node && area.contains(active);
    if (insidePanel || active === document.body || active === null) {
      triggersRef.current.get(wasOpen)?.focus({ preventScroll: true });
    }
  }, []);

  const togglePanel = useCallback((key: ReadingPanelKey) => {
    if (openRef.current === key) {
      closePanel();
      return;
    }
    setOpen(key);
  }, [closePanel]);

  // 打开后把焦点移入面板（不滚动）：Esc/Tab 等键盘行为从这里开始可用。
  useEffect(() => {
    if (!open) return;
    document.getElementById(`reading-panel-${open}`)?.focus({ preventScroll: true });
  }, [open]);

  // Esc 关闭挂在 document 上：面板内控件在 busy 期间被禁用时焦点会落到 body，
  // 面板容器自身收不到 keydown（句子想法/写想法等既有浮层不在此列，互不干扰）。
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closePanel]);

  const syncThoughts = useCallback((list: ThoughtView[]) => {
    setThoughts(previous => (previous === list ? previous : list));
  }, []);

  const registerLocate = useCallback((locate: ((thought: ThoughtView) => void) | null) => {
    locateRef.current = locate;
  }, []);

  const locateThought = useCallback((thought: ThoughtView) => {
    locateRef.current?.(thought);
    closePanel({ returnFocus: false });
  }, [closePanel]);

  const value = useMemo<ReadingPanelsValue>(() => ({
    open, togglePanel, closePanel, registerTrigger,
    thoughts, syncThoughts, registerLocate, locateThought,
  }), [open, togglePanel, closePanel, registerTrigger, thoughts, syncThoughts, registerLocate, locateThought]);

  return <ReadingPanelsContext.Provider value={value}>{children}</ReadingPanelsContext.Provider>;
}

/** 按需面板入口（正文列外、文章上方；开关均带 aria-expanded）。 */
export function ReadingPanelTriggers() {
  const panels = useReadingPanels();
  if (!panels) return null;
  const thoughtCount = panels.thoughts.filter(thought => !thought.deleted).length;
  const items: { key: ReadingPanelKey; label: string; count?: number }[] = [
    { key: "materials", label: "资料" },
    { key: "thoughts", label: "感想", count: thoughtCount },
    { key: "agent", label: "Agent 解读" },
  ];
  return (
    <div className={styles.triggers} role="group" aria-label="阅读面板入口">
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          ref={element => { panels.registerTrigger(item.key, element); }}
          className={styles.trigger}
          aria-expanded={panels.open === item.key}
          aria-controls={`reading-panel-${item.key}`}
          onClick={() => panels.togglePanel(item.key)}
        >
          {item.label}
          {item.count !== undefined && item.count > 0 && (
            <span aria-hidden="true" className={styles.triggerCount}>{item.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

/** 感想面板正文：本页可读感想列表，点「回到原句」交给 PassageAnnotations 定位。 */
function ThoughtsPanelBody() {
  const panels = useReadingPanels();
  if (!panels) return null;
  const active = panels.thoughts.filter(thought => !thought.deleted);
  const located = active.filter(isLocatedThought).sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || a.id - b.id);
  const changed = active.filter(thought => thought.status === "original-changed");
  if (active.length === 0) {
    return (
      <p className={styles.thoughtEmpty}>
        这个视角还没有可阅读的感想。在桌面端选中正文文字即可写下想法；手机端可阅读已有感想。
      </p>
    );
  }
  return (
    <>
      {located.length > 0 && (
        <ul aria-label="按原句排列的感想" className={styles.thoughtList}>
          {located.map(thought => <ThoughtRow key={thought.id} thought={thought} locateLabel="回到原句" />)}
        </ul>
      )}
      {changed.length > 0 && (
        <>
          <h3 className={styles.changedHeading}>原文已变化的感想</h3>
          <ul aria-label="原文已变化的感想" className={styles.thoughtList}>
            {changed.map(thought => <ThoughtRow key={thought.id} thought={thought} locateLabel="查看想法" />)}
          </ul>
        </>
      )}
    </>
  );
}

function ThoughtRow({ thought, locateLabel }: { thought: ThoughtView; locateLabel: string }) {
  const panels = useReadingPanels();
  return (
    <li className={styles.thoughtItem}>
      <p className={styles.thoughtMeta}>
        <span className={styles.thoughtAuthor}>{thought.authorName}</span>
        <time dateTime={thought.createdAt}>{formatTime(thought.createdAt)}</time>
        {thought.visibility === "private" && <span className={styles.thoughtBadge}>仅自己可见</span>}
        {thought.status === "original-changed" && <span className={styles.thoughtBadge}>原文已变化</span>}
      </p>
      <p className={styles.thoughtContent}>{thought.content}</p>
      <p className={styles.thoughtQuote}>
        <button type="button" className={styles.thoughtLocate} onClick={() => panels?.locateThought(thought)}>
          {locateLabel}
        </button>
        「{thought.quote}」
      </p>
    </li>
  );
}

/**
 * 面板容器：作为阅读网格的直接子元素渲染（宽屏落第 3 列留白，窄屏覆盖层）。
 * materials／agent 由视角页以服务端渲染内容传入；感想面板读取 context 数据。
 */
export function ReadingPanelsArea({ materials, agent }: { materials: ReactNode; agent: ReactNode }) {
  const panels = useReadingPanels();
  const areaRef = useRef<HTMLDivElement>(null);
  const [isOverlay, setIsOverlay] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1279.98px)");
    const update = () => setIsOverlay(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!panels) return;
    // 覆盖层模式下把 Tab 保持在面板内循环（宽屏留白面板是非模态的，不拦截；
    // Esc 关闭由 Provider 挂在 document 上统一处理）。
    if (event.key !== "Tab" || !isOverlay) return;
    const section = areaRef.current?.querySelector<HTMLElement>('section[data-open="true"]');
    if (!section) return;
    // 其他面板和收起的 details 仍挂载在 DOM 中，不能参与当前面板的焦点循环。
    const focusables = Array.from(section.querySelectorAll<HTMLElement>(
      "a[href], button, input, select, textarea, summary, [tabindex]",
    )).filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.checkVisibility({ visibilityProperty: true }));
    if (focusables.length === 0) {
      event.preventDefault();
      section.focus({ preventScroll: true });
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === section)) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (active === last || active === section)) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }, [isOverlay, panels]);

  if (!panels) return null;
  const open = panels.open;
  const sections: { key: ReadingPanelKey; title: string | null; label: string; children: ReactNode }[] = [
    { key: "materials", title: "资料", label: "资料", children: materials },
    { key: "thoughts", title: "感想", label: "感想", children: <ThoughtsPanelBody /> },
    // Agent 面板标题由 AgentPanel 自身提供（heading=false 时由外层 h2 承担），
    { key: "agent", title: "Agent 解读", label: "Agent 解读", children: agent },
  ];
  return (
    <div ref={areaRef} id="reading-panels-area" className={styles.area} data-open={open ?? undefined} onKeyDown={onKeyDown}>
      {sections.map(section => (
        <section
          key={section.key}
          id={`reading-panel-${section.key}`}
          role="region"
          aria-label={section.label}
          tabIndex={-1}
          data-open={open === section.key ? "true" : undefined}
          className={styles.section}
        >
          <header className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>{section.title}</h2>
            <button type="button" className={styles.sectionClose} aria-label={`关闭${section.label}面板`} onClick={() => panels.closePanel()}>
              关闭
            </button>
          </header>
          <div className={styles.sectionBody}>{section.children}</div>
        </section>
      ))}
    </div>
  );
}
